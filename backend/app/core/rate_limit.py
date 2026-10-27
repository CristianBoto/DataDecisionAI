"""Límite de frecuencia por IP (ventana deslizante, en memoria del proceso).

Pensado para UNA instancia del backend.

IP del visitante detrás de proxies: NO se confía en todo `X-Forwarded-For`,
porque el visitante puede escribir ahí cualquier valor (y esquivar el límite
cambiándolo en cada pedido). Cada proxy de confianza AGREGA a la derecha la IP
que vio; con `FORWARDED_IP_HOPS = n` se toma la entrada n-ésima desde la
derecha, que escribió el proxy más externo de los nuestros. Con 0 (sin proxy)
se usa la conexión directa.
"""

from __future__ import annotations

import threading
import time
from collections import deque

from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send

MAX_TRACKED_KEYS = 20_000


class RateLimiter:
    def __init__(self, clock=time.monotonic) -> None:
        self._clock = clock
        self._hits: dict[str, deque[float]] = {}
        self._lock = threading.Lock()

    def hit(self, key: str, limit: int, window_seconds: float) -> bool:
        """Registra un intento; devuelve False si ya se alcanzó el límite de la ventana."""
        now = self._clock()
        with self._lock:
            if len(self._hits) > MAX_TRACKED_KEYS:
                self._purge(now, window_seconds)
            hits = self._hits.setdefault(key, deque())
            while hits and hits[0] <= now - window_seconds:
                hits.popleft()
            if len(hits) >= limit:
                return False
            hits.append(now)
            return True

    def _purge(self, now: float, window_seconds: float) -> None:
        for key in [k for k, v in self._hits.items() if not v or v[-1] <= now - window_seconds]:
            del self._hits[key]


def client_ip(scope: Scope, trusted_hops: int = 0) -> str:
    client = scope.get("client")
    direct = client[0] if client else "desconocida"
    if trusted_hops <= 0:
        return direct
    forwarded = [
        value.strip()
        for name, raw in scope.get("headers", [])
        if name == b"x-forwarded-for"
        for value in raw.decode("latin-1").split(",")
        if value.strip()
    ]
    # Menos entradas que proxies esperados: el pedido no pasó por ellos; se usa la conexión.
    return forwarded[-trusted_hops] if len(forwarded) >= trusted_hops else direct


class RateLimitMiddleware:
    """Rechaza con 429 a una IP que supera `per_minute` solicitudes a /api/."""

    def __init__(
        self, app: ASGIApp, *, limiter: RateLimiter, per_minute: int, trusted_hops: int = 0, prefix: str = "/api/"
    ) -> None:
        self.app = app
        self.limiter = limiter
        self.per_minute = per_minute
        self.trusted_hops = trusted_hops
        self.prefix = prefix

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http" and scope["path"].startswith(self.prefix) and scope["method"] != "OPTIONS":
            if not self.limiter.hit(f"api:{client_ip(scope, self.trusted_hops)}", self.per_minute, 60):
                response = JSONResponse(
                    {"detail": "Demasiadas solicitudes desde esta conexión. Esperá un minuto e intentá de nuevo."},
                    status_code=429,
                    headers={"Retry-After": "60"},
                )
                await response(scope, receive, send)
                return
        await self.app(scope, receive, send)
