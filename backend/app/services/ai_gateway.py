"""Frontera de transmisión hacia la IA externa (Fases 3B.1 y 3B.2).

Flujo: preparar → mostrar → autorizar UNA vez → reservar presupuesto → enviar
→ validar la respuesta contra el contexto autorizado → guardar los planes.

- Denegado por defecto: sin `AI_ENABLED=true` no se envía nada.
- Cada autorización vale para una única solicitud, por pocos minutos, y solo
  para el contenido exacto que se mostró (huella SHA-256 del JSON canónico).
- El proveedor se inyecta (en las pruebas, uno falso sin red). La clave de
  OpenAI vive solo en el backend y nunca se devuelve ni se registra.
- No se registra el contenido de las solicitudes (ni objetivo ni columnas).
- Cada solicitud, conversación y plan tiene DUEÑO (el visitante que lo creó).
  Para cualquier otro visitante no existe: se responde 404, igual que si el
  identificador fuera inventado (no se revela que pertenece a otro).
"""

from __future__ import annotations

import hashlib
import json
import secrets
import threading
import time
from collections import OrderedDict
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Protocol

from app.core.config import Settings
from app.schemas.ai_context import AIContext
from app.schemas.ai_plan import AIPlan, prune_reply, validate_reply
from app.services.ai_budget import AIBudget, cost_usd, estimate_tokens, model_prices
from app.services.ai_errors import AIGatewayError
from app.services.openai_provider import INSTRUCTIONS, ProviderCallError, ProviderResult, build_input

__all__ = ["AIGatewayError"]

REQUEST_TTL_SECONDS = 300
# Por visitante (un visitante no puede llenar el cupo de los demás) y en total (memoria acotada).
MAX_PENDING_REQUESTS = 5
MAX_PENDING_REQUESTS_TOTAL = 1000
MAX_PLANS_PER_OWNER = 50
MAX_STORED_PLANS = 2000
PLAN_TTL_SECONDS = 6 * 3600
MAX_CONVERSATIONS_PER_OWNER = 5
# Tamaño aproximado del esquema de respuesta, que también cuenta como entrada.
SCHEMA_CHARS = 3200


class AIProvider(Protocol):
    """Interfaz del proveedor: `OpenAIProvider` en producción, uno falso en las pruebas."""

    implemented: bool

    def send(self, context: AIContext, settings: Settings) -> ProviderResult: ...


class NotImplementedProvider:
    """Proveedor sin red (se conserva para pruebas y para desactivar el envío)."""

    implemented = False

    def send(self, context: AIContext, settings: Settings) -> ProviderResult:  # pragma: no cover - nunca se invoca
        raise AIGatewayError(501, "La conexión con OpenAI no está disponible.")


def canonical_json(context: AIContext) -> str:
    """JSON canónico (claves ordenadas, sin espacios): base de la huella aprobada."""
    return json.dumps(context.model_dump(mode="json"), ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def payload_hash(context: AIContext) -> str:
    return hashlib.sha256(canonical_json(context).encode("utf-8")).hexdigest()


@dataclass
class _Pending:
    context: AIContext
    sha256: str
    expires_at: float
    owner: str


class AIRequestStore:
    """Solicitudes preparadas en memoria del proceso (no se persisten: contienen metadatos del dataset)."""

    def __init__(self, ttl_seconds: int = REQUEST_TTL_SECONDS, clock=time.monotonic) -> None:
        self.ttl_seconds = ttl_seconds
        self._clock = clock
        self._pending: dict[str, _Pending] = {}
        # Los endpoints corren en hilos: consumir y borrar debe ser atómico (uso único sin errores 500).
        self._lock = threading.Lock()

    def _purge(self) -> None:
        now = self._clock()
        for request_id in [k for k, v in self._pending.items() if v.expires_at <= now]:
            del self._pending[request_id]

    def prepare(self, context: AIContext, owner: str) -> tuple[str, str]:
        with self._lock:
            return self._prepare(context, owner)

    def _prepare(self, context: AIContext, owner: str) -> tuple[str, str]:
        self._purge()
        if sum(1 for p in self._pending.values() if p.owner == owner) >= MAX_PENDING_REQUESTS:
            raise AIGatewayError(429, "Tenés demasiadas solicitudes pendientes de revisión. Cancelá o esperá a que venzan.")
        if len(self._pending) >= MAX_PENDING_REQUESTS_TOTAL:
            raise AIGatewayError(429, "El servicio tiene demasiadas solicitudes pendientes. Intentá en unos minutos.")
        request_id = secrets.token_urlsafe(16)
        sha = payload_hash(context)
        self._pending[request_id] = _Pending(context, sha, self._clock() + self.ttl_seconds, owner)
        return request_id, sha

    def cancel(self, request_id: str, owner: str) -> bool:
        with self._lock:
            return self._cancel(request_id, owner)

    def _cancel(self, request_id: str, owner: str) -> bool:
        pending = self._pending.get(request_id)
        if pending is None or pending.owner != owner:
            return False
        del self._pending[request_id]
        return True

    def consume(self, request_id: str, approved_sha256: str, owner: str) -> AIContext:
        """Valida y CONSUME la autorización (uso único, solo para su dueño)."""
        with self._lock:
            return self._consume(request_id, approved_sha256, owner)

    def _consume(self, request_id: str, approved_sha256: str, owner: str) -> AIContext:
        pending = self._pending.get(request_id)
        if pending is None or not secrets.compare_digest(pending.owner, owner):
            raise AIGatewayError(404, "La solicitud no existe, ya se usó o fue cancelada.")
        if pending.expires_at <= self._clock():
            del self._pending[request_id]
            raise AIGatewayError(410, "La solicitud venció. Prepará y revisá el contenido nuevamente.")
        if not secrets.compare_digest(pending.sha256, approved_sha256):
            raise AIGatewayError(409, "El contenido aprobado no coincide con el preparado.")
        del self._pending[request_id]
        return pending.context


class AIPlanStore:
    """Planes validados, en memoria del proceso, con dueño y vencimiento. Se aprueban aquí."""

    def __init__(self, clock=time.monotonic) -> None:
        self._clock = clock
        self._plans: OrderedDict[str, dict] = OrderedDict()
        self._lock = threading.Lock()

    def save(self, plan: AIPlan, owner: str) -> str:
        with self._lock:
            now = self._clock()
            for pid in [k for k, v in self._plans.items() if v["expires_at"] <= now]:
                del self._plans[pid]
            mine = [k for k, v in self._plans.items() if v["owner"] == owner]
            for pid in mine[: max(0, len(mine) - MAX_PLANS_PER_OWNER + 1)]:
                del self._plans[pid]
            plan_id = secrets.token_urlsafe(16)
            self._plans[plan_id] = {
                "plan": plan, "status": "proposed", "approved_at": None, "owner": owner, "expires_at": now + PLAN_TTL_SECONDS,
            }
            while len(self._plans) > MAX_STORED_PLANS:
                self._plans.popitem(last=False)
            return plan_id

    def get(self, plan_id: str, owner: str) -> dict | None:
        entry = self._plans.get(plan_id)
        if entry is None or entry["owner"] != owner or entry["expires_at"] <= self._clock():
            return None
        return entry

    def approve(self, plan_id: str, owner: str) -> dict:
        entry = self.get(plan_id, owner)
        if entry is None:
            raise AIGatewayError(404, "El plan no existe o ya no está disponible.")
        if entry["status"] != "approved":
            entry["status"] = "approved"
            entry["approved_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
        return {"plan_id": plan_id, "status": entry["status"], "approved_at": entry["approved_at"], "executed": False}


def estimate_request(context: AIContext, settings: Settings) -> tuple[int, float | None]:
    """Tokens de entrada estimados y costo máximo (con la salida máxima permitida)."""
    tokens = estimate_tokens(INSTRUCTIONS, build_input(context)) + SCHEMA_CHARS // 3
    prices = model_prices(settings.openai_model, settings.openai_price_input_per_1m, settings.openai_price_output_per_1m)
    if prices is None:
        return tokens, None
    return tokens, cost_usd(prices, tokens, settings.ai_max_output_tokens)


def boundary_hash(context: AIContext) -> str:
    """Huella de la frontera de privacidad: objetivo y metadatos autorizados (sin mensaje ni historial)."""
    boundary = {k: v for k, v in context.model_dump(mode="json").items() if k not in ("message", "history")}
    canonical = json.dumps(boundary, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


@dataclass
class _Grant:
    boundary: str
    expires_at: float
    owner: str
    messages: int = 0
    busy: bool = False


class AIConversationStore:
    """Autorizaciones por conversación, en memoria del proceso.

    Cada permiso queda atado a la frontera de privacidad aprobada (objetivo y
    metadatos), vence a los pocos minutos, admite un máximo de mensajes, se puede
    revocar y no permite dos envíos simultáneos en la misma conversación.
    """

    def __init__(self, clock=time.monotonic) -> None:
        self._clock = clock
        self._grants: dict[str, _Grant] = {}
        self._lock = threading.Lock()

    def create(self, boundary: str, ttl_seconds: int, owner: str) -> str:
        with self._lock:
            now = self._clock()
            for gid in [k for k, g in self._grants.items() if g.expires_at <= now]:
                del self._grants[gid]
            # Pocas conversaciones autorizadas por visitante: la más antigua se revoca.
            mine = [k for k, g in self._grants.items() if g.owner == owner and not g.busy]
            for gid in mine[: max(0, len(mine) - MAX_CONVERSATIONS_PER_OWNER + 1)]:
                del self._grants[gid]
            conversation_id = secrets.token_urlsafe(16)
            self._grants[conversation_id] = _Grant(boundary, now + ttl_seconds, owner)
            return conversation_id

    def revoke(self, conversation_id: str, owner: str) -> bool:
        with self._lock:
            grant = self._grants.get(conversation_id)
            if grant is None or grant.owner != owner:
                return False
            del self._grants[conversation_id]
            return True

    @contextmanager
    def use(self, conversation_id: str, boundary: str, max_messages: int, owner: str):
        with self._lock:
            grant = self._grants.get(conversation_id)
            if grant is None or not secrets.compare_digest(grant.owner, owner):
                raise AIGatewayError(404, "La conversación no tiene una autorización vigente (se revocó o no existe). No se envió nada.")
            if grant.expires_at <= self._clock():
                del self._grants[conversation_id]
                raise AIGatewayError(410, "La autorización de la conversación venció. Se requiere una nueva autorización. No se envió nada.")
            if not secrets.compare_digest(grant.boundary, boundary):
                # Cambió lo que se comparte (objetivo, fuentes, columnas o interpretaciones): el permiso deja de valer.
                del self._grants[conversation_id]
                raise AIGatewayError(
                    409, "Cambió la configuración de privacidad: se requiere una nueva autorización. No se envió nada."
                )
            if grant.messages >= max_messages:
                del self._grants[conversation_id]
                raise AIGatewayError(
                    429, f"Se alcanzó el máximo de {max_messages} mensajes de esta autorización. Autorizá de nuevo para seguir."
                )
            if grant.busy:
                raise AIGatewayError(409, "Ya hay una solicitud en curso en esta conversación. Esperá la respuesta.")
            grant.busy = True
            grant.messages += 1
        try:
            yield
        finally:
            with self._lock:
                if conversation_id in self._grants:
                    self._grants[conversation_id].busy = False


def check_sendable(provider: AIProvider, settings: Settings) -> tuple[float, float]:
    if not provider.implemented:
        raise AIGatewayError(501, "La conexión con OpenAI no está disponible. No se envió nada.")
    if not settings.openai_api_key:
        raise AIGatewayError(503, "Falta configurar OPENAI_API_KEY en backend/.env. No se envió nada.")
    prices = model_prices(settings.openai_model, settings.openai_price_input_per_1m, settings.openai_price_output_per_1m)
    if prices is None:
        raise AIGatewayError(
            503,
            f"No hay precio configurado para el modelo «{settings.openai_model}»: definí OPENAI_PRICE_INPUT_PER_1M "
            "y OPENAI_PRICE_OUTPUT_PER_1M. No se envió nada.",
        )
    return prices


def metered_call(call, *, budget: AIBudget, settings: Settings, owner: str, max_cost: float | None,
                 prices: tuple[float, float]) -> tuple[ProviderResult, float]:
    """Reserva el costo máximo, llama al proveedor y registra el consumo real (o el máximo si pudo cobrarse)."""
    reservation = budget.reserve(owner, max_cost or 0.0)
    try:
        result = call()
    except BaseException as exc:
        # Si la solicitud pudo haberse cobrado (p. ej., tiempo agotado), se registra el máximo estimado.
        may_have_cost = exc.may_have_cost if isinstance(exc, ProviderCallError) else True
        budget.settle(
            reservation,
            model=settings.openai_model,
            input_tokens=0,
            output_tokens=0,
            cost=(max_cost or 0.0) if may_have_cost else 0.0,
            estimated=True,
        )
        raise

    cost = cost_usd(prices, result.input_tokens, result.output_tokens)
    budget.settle(
        reservation,
        model=settings.openai_model,
        input_tokens=result.input_tokens,
        output_tokens=result.output_tokens,
        cost=cost,
        estimated=False,
    )
    return result, cost


def _send(context: AIContext, provider: AIProvider, budget: AIBudget, plans: AIPlanStore, settings: Settings, owner: str) -> dict:
    """Envío con todos los límites (tamaño, presupuesto, solicitudes) y validación de la respuesta."""
    prices = check_sendable(provider, settings)
    input_estimate, max_cost = estimate_request(context, settings)
    if input_estimate > settings.ai_max_input_tokens:
        raise AIGatewayError(413, "El contexto supera el tamaño máximo permitido para la IA. No se envió nada.")

    result, cost = metered_call(
        lambda: provider.send(context, settings), budget=budget, settings=settings, owner=owner, max_cost=max_cost, prices=prices
    )
    if result.reply is None:
        raise AIGatewayError(502, f"{result.problem} Se registró el consumo; no se guardó ningún plan.")
    problems = validate_reply(result.reply, context)
    if problems:
        raise AIGatewayError(502, "La respuesta de la IA no superó la validación y se descartó. " + " ".join(problems[:3]))
    # Operaciones sin sentido estadístico para los datos revisados: se quitan y se informa por qué.
    pruned, notes = prune_reply(result.reply, context)
    if not pruned.plans and not pruned.questions:
        raise AIGatewayError(502, "La respuesta de la IA no superó la validación y se descartó. " + " ".join(notes[:3]))

    reply = pruned.model_dump(mode="json")
    if pruned.source_relationship in ("relate", "concatenate"):
        reply["warnings"].append("Unir o relacionar fuentes no está disponible en esta etapa: cada plan usa una sola fuente.")
    return {
        "reply": reply,
        "plan_ids": [plans.save(plan, owner) for plan in pruned.plans],
        "usage": {
            "model": settings.openai_model,
            "input_tokens": result.input_tokens,
            "output_tokens": result.output_tokens,
            "cost_usd": round(cost, 6),
            "remaining_usd": budget.status(owner).remaining_usd,
        },
    }


def authorize_and_send(
    store: AIRequestStore,
    provider: AIProvider,
    budget: AIBudget,
    plans: AIPlanStore,
    *,
    settings: Settings,
    request_id: str,
    approved_sha256: str,
    owner: str,
    scope: str = "message",
    conversations: AIConversationStore | None = None,
) -> dict:
    """Envío revisado y autorizado. Con `scope="conversation"`, además, el usuario
    autoriza los próximos mensajes de esta conversación (permiso acotado)."""
    if not settings.ai_enabled:
        # Se descarta la solicitud: una autorización no queda guardada para más tarde.
        store.cancel(request_id, owner)
        raise AIGatewayError(403, "La IA externa está deshabilitada (AI_ENABLED=false). No se envió nada.")
    context = store.consume(request_id, approved_sha256, owner)  # uso único desde aquí
    response = _send(context, provider, budget, plans, settings, owner)
    if scope == "conversation" and conversations is not None:
        ttl = settings.ai_conversation_ttl_minutes * 60
        response["conversation"] = {
            "conversation_id": conversations.create(boundary_hash(context), ttl, owner),
            "expires_in_seconds": ttl,
            "max_messages": settings.ai_conversation_max_messages,
        }
    return response


def send_in_conversation(
    conversations: AIConversationStore,
    provider: AIProvider,
    budget: AIBudget,
    plans: AIPlanStore,
    *,
    settings: Settings,
    conversation_id: str,
    context: AIContext,
    owner: str,
) -> dict:
    """Mensaje dentro de una conversación autorizada: sin nueva revisión visual, con los mismos límites."""
    if not settings.ai_enabled:
        conversations.revoke(conversation_id, owner)
        raise AIGatewayError(403, "La IA externa está deshabilitada (AI_ENABLED=false). No se envió nada.")
    if context.message is None:
        raise AIGatewayError(422, "Falta el mensaje que el usuario quiere enviar.")
    with conversations.use(conversation_id, boundary_hash(context), settings.ai_conversation_max_messages, owner):
        return _send(context, provider, budget, plans, settings, owner)
