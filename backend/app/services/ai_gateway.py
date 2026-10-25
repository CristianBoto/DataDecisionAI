"""Frontera de transmisión hacia la IA externa (Fases 3B.1 y 3B.2).

Flujo: preparar → mostrar → autorizar UNA vez → reservar presupuesto → enviar
→ validar la respuesta contra el contexto autorizado → guardar los planes.

- Denegado por defecto: sin `AI_ENABLED=true` no se envía nada.
- Cada autorización vale para una única solicitud, por pocos minutos, y solo
  para el contenido exacto que se mostró (huella SHA-256 del JSON canónico).
- El proveedor se inyecta (en las pruebas, uno falso sin red). La clave de
  OpenAI vive solo en el backend y nunca se devuelve ni se registra.
- No se registra el contenido de las solicitudes (ni objetivo ni columnas).
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
from app.schemas.ai_plan import AIPlan, validate_reply
from app.services.ai_budget import AIBudget, cost_usd, estimate_tokens, model_prices
from app.services.ai_errors import AIGatewayError
from app.services.openai_provider import INSTRUCTIONS, ProviderCallError, ProviderResult, build_input

__all__ = ["AIGatewayError"]

REQUEST_TTL_SECONDS = 300
MAX_PENDING_REQUESTS = 20
MAX_STORED_PLANS = 100
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


class AIRequestStore:
    """Solicitudes preparadas en memoria del proceso (sin base de datos)."""

    def __init__(self, ttl_seconds: int = REQUEST_TTL_SECONDS, clock=time.monotonic) -> None:
        self.ttl_seconds = ttl_seconds
        self._clock = clock
        self._pending: dict[str, _Pending] = {}

    def _purge(self) -> None:
        now = self._clock()
        for request_id in [k for k, v in self._pending.items() if v.expires_at <= now]:
            del self._pending[request_id]

    def prepare(self, context: AIContext) -> tuple[str, str]:
        self._purge()
        if len(self._pending) >= MAX_PENDING_REQUESTS:
            raise AIGatewayError(429, "Hay demasiadas solicitudes pendientes de revisión.")
        request_id = secrets.token_urlsafe(16)
        sha = payload_hash(context)
        self._pending[request_id] = _Pending(context, sha, self._clock() + self.ttl_seconds)
        return request_id, sha

    def cancel(self, request_id: str) -> bool:
        return self._pending.pop(request_id, None) is not None

    def consume(self, request_id: str, approved_sha256: str) -> AIContext:
        """Valida y CONSUME la autorización (uso único)."""
        pending = self._pending.get(request_id)
        if pending is None:
            raise AIGatewayError(404, "La solicitud no existe, ya se usó o fue cancelada.")
        if pending.expires_at <= self._clock():
            del self._pending[request_id]
            raise AIGatewayError(410, "La solicitud venció. Prepará y revisá el contenido nuevamente.")
        if not secrets.compare_digest(pending.sha256, approved_sha256):
            raise AIGatewayError(409, "El contenido aprobado no coincide con el preparado.")
        del self._pending[request_id]
        return pending.context


class AIPlanStore:
    """Planes validados, en memoria del proceso. Se aprueban aquí; no se ejecutan todavía."""

    def __init__(self) -> None:
        self._plans: OrderedDict[str, dict] = OrderedDict()

    def save(self, plan: AIPlan) -> str:
        plan_id = secrets.token_urlsafe(12)
        self._plans[plan_id] = {"plan": plan, "status": "proposed", "approved_at": None}
        while len(self._plans) > MAX_STORED_PLANS:
            self._plans.popitem(last=False)
        return plan_id

    def get(self, plan_id: str) -> dict | None:
        return self._plans.get(plan_id)

    def approve(self, plan_id: str) -> dict:
        entry = self._plans.get(plan_id)
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

    def create(self, boundary: str, ttl_seconds: int) -> str:
        with self._lock:
            now = self._clock()
            for gid in [k for k, g in self._grants.items() if g.expires_at <= now]:
                del self._grants[gid]
            conversation_id = secrets.token_urlsafe(16)
            self._grants[conversation_id] = _Grant(boundary, now + ttl_seconds)
            return conversation_id

    def revoke(self, conversation_id: str) -> bool:
        with self._lock:
            return self._grants.pop(conversation_id, None) is not None

    @contextmanager
    def use(self, conversation_id: str, boundary: str, max_messages: int):
        with self._lock:
            grant = self._grants.get(conversation_id)
            if grant is None:
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


def _check_sendable(provider: AIProvider, settings: Settings) -> tuple[float, float]:
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


def _send(context: AIContext, provider: AIProvider, budget: AIBudget, plans: AIPlanStore, settings: Settings) -> dict:
    """Envío con todos los límites (tamaño, presupuesto, solicitudes) y validación de la respuesta."""
    prices = _check_sendable(provider, settings)
    input_estimate, max_cost = estimate_request(context, settings)
    if input_estimate > settings.ai_max_input_tokens:
        raise AIGatewayError(413, "El contexto supera el tamaño máximo permitido para la IA. No se envió nada.")

    reservation = budget.reserve(max_cost or 0.0)
    try:
        result = provider.send(context, settings)
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
    if result.reply is None:
        raise AIGatewayError(502, f"{result.problem} Se registró el consumo; no se guardó ningún plan.")
    problems = validate_reply(result.reply, context)
    if problems:
        raise AIGatewayError(502, "La respuesta de la IA no superó la validación y se descartó. " + " ".join(problems[:3]))

    reply = result.reply.model_dump(mode="json")
    if result.reply.source_relationship in ("relate", "concatenate"):
        reply["warnings"].append("Unir o relacionar fuentes no está disponible en esta etapa: cada plan usa una sola fuente.")
    return {
        "reply": reply,
        "plan_ids": [plans.save(plan) for plan in result.reply.plans],
        "usage": {
            "model": settings.openai_model,
            "input_tokens": result.input_tokens,
            "output_tokens": result.output_tokens,
            "cost_usd": round(cost, 6),
            "remaining_usd": round(budget.remaining_usd, 6),
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
    scope: str = "message",
    conversations: AIConversationStore | None = None,
) -> dict:
    """Envío revisado y autorizado. Con `scope="conversation"`, además, el usuario
    autoriza los próximos mensajes de esta conversación (permiso acotado)."""
    if not settings.ai_enabled:
        # Se descarta la solicitud: una autorización no queda guardada para más tarde.
        store.cancel(request_id)
        raise AIGatewayError(403, "La IA externa está deshabilitada (AI_ENABLED=false). No se envió nada.")
    context = store.consume(request_id, approved_sha256)  # uso único desde aquí
    response = _send(context, provider, budget, plans, settings)
    if scope == "conversation" and conversations is not None:
        ttl = settings.ai_conversation_ttl_minutes * 60
        response["conversation"] = {
            "conversation_id": conversations.create(boundary_hash(context), ttl),
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
) -> dict:
    """Mensaje dentro de una conversación autorizada: sin nueva revisión visual, con los mismos límites."""
    if not settings.ai_enabled:
        conversations.revoke(conversation_id)
        raise AIGatewayError(403, "La IA externa está deshabilitada (AI_ENABLED=false). No se envió nada.")
    if context.message is None:
        raise AIGatewayError(422, "Falta el mensaje que el usuario quiere enviar.")
    with conversations.use(conversation_id, boundary_hash(context), settings.ai_conversation_max_messages):
        return _send(context, provider, budget, plans, settings)
