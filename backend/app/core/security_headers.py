"""Encabezados de seguridad de la API y registros sin identificadores sensibles."""

from __future__ import annotations

import logging
import re

from starlette.datastructures import Headers, MutableHeaders
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

# La API solo devuelve JSON: no carga recursos ni se muestra en marcos.
API_HEADERS = {
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
    "Cross-Origin-Opener-Policy": "same-origin",
    # Respuestas con datos del visitante: ningún intermediario ni el navegador las guarda.
    "Cache-Control": "no-store",
}
HSTS = "max-age=31536000; includeSubDomains"


class SecurityHeadersMiddleware:
    def __init__(self, app: ASGIApp, *, hsts: bool) -> None:
        self.app = app
        self.hsts = hsts

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        async def send_with_headers(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = MutableHeaders(scope=message)
                for name, value in API_HEADERS.items():
                    headers.setdefault(name, value)
                if self.hsts:
                    headers["Strict-Transport-Security"] = HSTS
            await send(message)

        await self.app(scope, receive, send_with_headers)


class HTTPSOnlyMiddleware:
    """Producción: rechaza pedidos que no llegaron por HTTPS (antes de leer el cuerpo).

    Detrás del proxy de la plataforma (que termina TLS) el esquema original está en
    `X-Forwarded-Proto`; sin proxy, en la conexión. `/api/health` queda exceptuado
    para los controles internos de salud de la plataforma (no expone datos).
    """

    def __init__(self, app: ASGIApp, *, behind_proxy: bool, exempt: tuple[str, ...] = ("/api/health",)) -> None:
        self.app = app
        self.behind_proxy = behind_proxy
        self.exempt = exempt

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http" and scope["path"] not in self.exempt and self._scheme(scope) != "https":
            response = JSONResponse({"detail": "Se requiere HTTPS."}, status_code=403)
            await response(scope, receive, send)
            return
        await self.app(scope, receive, send)

    def _scheme(self, scope: Scope) -> str:
        if self.behind_proxy:
            proto = Headers(scope=scope).get("x-forwarded-proto", "")
            return proto.split(",")[-1].strip().lower()
        return scope.get("scheme", "http")


# Segmentos de ruta con aspecto de identificador (solicitudes, conversaciones, planes).
_ID_SEGMENT = re.compile(r"/[A-Za-z0-9_-]{12,}(?=/|$|\?| )")


class RedactIdentifiersFilter(logging.Filter):
    """Reemplaza identificadores de las rutas en los registros de acceso de uvicorn.

    Uvicorn no registra encabezados (el token viaja en `Authorization`), pero sí
    la ruta. Las consultas (`?…`) también se ocultan.
    """

    def filter(self, record: logging.LogRecord) -> bool:
        if isinstance(record.args, tuple) and record.args:
            record.args = tuple(redact(a) if isinstance(a, str) else a for a in record.args)
        elif isinstance(record.msg, str):
            record.msg = redact(record.msg)
        return True


def redact(text: str) -> str:
    text = re.sub(r"\?\S*", "?…", text)
    return _ID_SEGMENT.sub("/…", text)


def install_log_redaction() -> None:
    access = logging.getLogger("uvicorn.access")
    if not any(isinstance(f, RedactIdentifiersFilter) for f in access.filters):
        access.addFilter(RedactIdentifiersFilter())
