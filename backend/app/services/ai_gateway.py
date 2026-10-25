"""Frontera de transmisión hacia la IA externa (Fase 3B.1).

Flujo: preparar → mostrar → autorizar UNA vez → (en la Fase 3B.2) enviar.

- Denegado por defecto: sin `AI_ENABLED=true` no se envía nada.
- Cada autorización vale para una única solicitud, por pocos minutos, y solo
  para el contenido exacto que se mostró (huella SHA-256 del JSON canónico).
- El proveedor se inyecta: en esta fase el proveedor por defecto NO hace
  llamadas de red. La clave de OpenAI vive solo en el backend y nunca se
  devuelve ni se registra.
- No se registra el contenido de las solicitudes (ni objetivo ni columnas).
"""

from __future__ import annotations

import hashlib
import json
import secrets
import time
from dataclasses import dataclass
from typing import Protocol

from app.schemas.ai_context import AIContext

REQUEST_TTL_SECONDS = 300
MAX_PENDING_REQUESTS = 20


class AIGatewayError(Exception):
    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


class AIProvider(Protocol):
    """Interfaz que implementará el cliente de OpenAI en la Fase 3B.2."""

    implemented: bool

    def send(self, payload: dict) -> dict: ...


class NotImplementedProvider:
    """Proveedor de la Fase 3B.1: no realiza ninguna llamada externa."""

    implemented = False

    def send(self, payload: dict) -> dict:  # pragma: no cover - nunca se invoca
        raise AIGatewayError(501, "La conexión con OpenAI todavía no está implementada.")


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


def authorize_and_send(
    store: AIRequestStore,
    provider: AIProvider,
    *,
    ai_enabled: bool,
    request_id: str,
    approved_sha256: str,
) -> dict:
    """Única puerta de salida hacia la IA externa."""
    if not ai_enabled:
        # Se descarta la solicitud: una autorización no queda guardada para más tarde.
        store.cancel(request_id)
        raise AIGatewayError(403, "La IA externa está deshabilitada (AI_ENABLED=false). No se envió nada.")
    context = store.consume(request_id, approved_sha256)
    if not provider.implemented:
        raise AIGatewayError(
            501,
            "Contenido autorizado, pero la conexión con OpenAI se implementará en la Fase 3B.2. No se envió nada.",
        )
    return provider.send(context.model_dump(mode="json"))
