"""Protección de las rutas de carga ANTES de leer el cuerpo de la solicitud.

Middleware ASGI puro (no BaseHTTPMiddleware) porque necesita envolver `receive`:

- B6 · Origen: si la solicitud trae `Origin` y no está autorizado (incluido
  "null"), se rechaza con 403 sin leer el cuerpo. CORS solo impide que otro
  sitio *lea* la respuesta; este control impide que el backend *procese* la
  carga. Las herramientas locales sin `Origin` (curl, pruebas) siguen
  funcionando. No es autenticación.
- B4 · Tamaño: si `Content-Length` supera el límite, 413 inmediato. Además se
  cuentan los bytes realmente recibidos: si el encabezado falta o miente, la
  lectura se corta al superar el límite (Starlette cierra y borra el archivo
  temporal parcial) y se responde 413.
"""

from __future__ import annotations

from collections.abc import Iterable

from starlette.datastructures import Headers
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send


class UploadTooLarge(Exception):
    """Se superó el límite de bytes recibidos."""


class UploadGuardMiddleware:
    def __init__(
        self,
        app: ASGIApp,
        *,
        paths: Iterable[str],
        max_body_bytes: int,
        allowed_origins: Iterable[str],
    ) -> None:
        self.app = app
        self.paths = frozenset(paths)
        self.max_body_bytes = max_body_bytes
        self.allowed_origins = frozenset(allowed_origins)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope["method"] != "POST" or scope["path"] not in self.paths:
            await self.app(scope, receive, send)
            return

        headers = Headers(scope=scope)
        origin = headers.get("origin")
        if origin is not None and origin not in self.allowed_origins:
            await JSONResponse({"detail": "Origen no autorizado para cargar archivos."}, status_code=403)(scope, receive, send)
            return

        declared = headers.get("content-length")
        if declared is not None:
            if not declared.isdigit():
                await JSONResponse({"detail": "Encabezado Content-Length inválido."}, status_code=400)(scope, receive, send)
                return
            if int(declared) > self.max_body_bytes:
                await self._too_large(scope, receive, send)
                return

        received = 0
        exceeded = False

        async def limited_receive() -> Message:
            nonlocal received, exceeded
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > self.max_body_bytes:
                    exceeded = True
                    raise UploadTooLarge
            return message

        async def guarded_send(message: Message) -> None:
            # Si se cortó la lectura, la respuesta de error la envía este middleware.
            if not exceeded:
                await send(message)

        try:
            await self.app(scope, limited_receive, guarded_send)
        except UploadTooLarge:
            pass
        if exceeded:
            await self._too_large(scope, receive, send)

    async def _too_large(self, scope: Scope, receive: Receive, send: Send) -> None:
        limit_mb = self.max_body_bytes // (1024 * 1024)
        await JSONResponse(
            {"detail": f"La solicitud supera el tamaño máximo permitido ({limit_mb} MB)."},
            status_code=413,
        )(scope, receive, send)
