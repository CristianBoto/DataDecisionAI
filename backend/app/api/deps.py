"""Dependencias comunes: sesión obligatoria y límites de concurrencia por visitante."""

from __future__ import annotations

import threading
from collections import Counter
from collections.abc import Iterator
from contextlib import contextmanager

from fastapi import Depends, HTTPException, Request

from app.services.auth import AuthService, User

MAX_TOKEN_LENGTH = 200
UNAUTHENTICATED = {"WWW-Authenticate": "Bearer"}
# Cupo ocupado: se rechaza al instante (no hay cola ni espera indefinida) y se sugiere reintentar.
RETRY_SOON = {"Retry-After": "30"}


def get_auth(request: Request) -> AuthService:
    return request.app.state.auth


def require_user(request: Request, auth: AuthService = Depends(get_auth)) -> User:
    """Exige `Authorization: Bearer <token>` de una sesión vigente. Sin excepciones ni modo de omitirla."""
    header = request.headers.get("authorization", "")
    scheme, _, token = header.partition(" ")
    token = token.strip()
    if scheme.lower() != "bearer" or not token:
        raise HTTPException(401, "Ingresá con tu código de invitación para usar DataDecision AI.", headers=UNAUTHENTICATED)
    if len(token) > MAX_TOKEN_LENGTH:
        raise HTTPException(401, "La sesión no es válida o venció. Ingresá de nuevo.", headers=UNAUTHENTICATED)
    user = auth.authenticate(token)
    if user is None:
        raise HTTPException(401, "La sesión no es válida o venció. Ingresá de nuevo.", headers=UNAUTHENTICATED)
    return user


class ConcurrencyGate:
    """Tareas pesadas simultáneas: un máximo global y uno por visitante. El exceso se rechaza (429)."""

    def __init__(self, *, total: int, per_user: int, busy_message: str) -> None:
        self.total = total
        self.per_user = per_user
        self.busy_message = busy_message
        self._active: Counter[str] = Counter()
        self._lock = threading.Lock()

    @property
    def active(self) -> int:
        return sum(self._active.values())

    @contextmanager
    def slot(self, user_id: str) -> Iterator[None]:
        with self._lock:
            if self._active[user_id] >= self.per_user:
                raise HTTPException(429, "Ya tenés una tarea igual en curso. Esperá a que termine.", headers=RETRY_SOON)
            if self.active >= self.total:
                raise HTTPException(429, self.busy_message, headers=RETRY_SOON)
            self._active[user_id] += 1
        try:
            yield
        finally:
            with self._lock:
                self._active[user_id] -= 1
                if self._active[user_id] <= 0:
                    del self._active[user_id]
