"""Acceso por invitación: códigos individuales que se canjean por un token de sesión.

- Cada invitación identifica a UN visitante (su `id` es el dueño de solicitudes,
  conversaciones, planes y cuotas). No hay registro público, pagos ni roles.
- Códigos y tokens tienen alta entropía (`secrets`) y en la base solo se guarda
  su huella SHA-256: una copia de la base no permite entrar.
- Vencimiento y revocación de invitaciones y sesiones. Revocar una invitación
  cierra todas sus sesiones.
- El canje exige Cloudflare Turnstile validado en el backend (obligatorio en
  producción; ver `config.validate_for_startup`).
- Nunca se registran códigos ni tokens.
"""

from __future__ import annotations

import hashlib
import logging
import secrets
import time
from collections.abc import Callable
from dataclasses import dataclass
from typing import Protocol

from app.services.database import Database

logger = logging.getLogger(__name__)

CODE_PREFIX = "ddai-"
INVALID_CODE = "El código de invitación no es válido, venció o fue revocado."


def hash_secret(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


@dataclass(frozen=True)
class User:
    """Visitante autenticado: `id` es el de su invitación."""

    id: str
    label: str
    token_hash: str
    session_expires_at: float


class AuthError(Exception):
    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


class AuthService:
    def __init__(self, db: Database, *, session_ttl_seconds: int, max_sessions: int, clock: Callable[[], float] = time.time):
        self.db = db
        self.session_ttl_seconds = session_ttl_seconds
        self.max_sessions = max_sessions
        self._clock = clock

    # --- Administración (CLI) -------------------------------------------------

    def create_invitation(self, label: str, days: float) -> tuple[str, str]:
        """Crea una invitación y devuelve (id, código). El código se muestra UNA vez."""
        invitation_id = secrets.token_hex(4)
        code = CODE_PREFIX + secrets.token_urlsafe(18)  # 144 bits
        now = self._clock()
        with self.db.transaction() as conn:
            conn.execute(
                "INSERT INTO invitations (id, code_hash, label, created_at, expires_at) VALUES (?, ?, ?, ?, ?)",
                (invitation_id, hash_secret(code), label.strip()[:80] or "sin etiqueta", now, now + days * 86400),
            )
        return invitation_id, code

    def revoke_invitation(self, invitation_id: str) -> bool:
        now = self._clock()
        with self.db.transaction() as conn:
            updated = conn.execute(
                "UPDATE invitations SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL", (now, invitation_id)
            ).rowcount
            conn.execute("UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL", (now, invitation_id))
        return updated > 0

    def list_invitations(self) -> list[dict]:
        rows = self.db.query(
            "SELECT i.id, i.label, i.created_at, i.expires_at, i.revoked_at, "
            "(SELECT COUNT(*) FROM sessions s WHERE s.user_id = i.id AND s.revoked_at IS NULL AND s.expires_at > ?) "
            "AS active_sessions FROM invitations i ORDER BY i.created_at",
            (self._clock(),),
        )
        return [dict(row) for row in rows]

    # --- Canje y verificación ---------------------------------------------------

    def redeem(self, code: str) -> tuple[str, User]:
        """Canjea un código vigente por un token de sesión nuevo. Error genérico si no vale."""
        now = self._clock()
        with self.db.transaction() as conn:
            row = conn.execute(
                "SELECT id, label FROM invitations WHERE code_hash = ? AND revoked_at IS NULL AND expires_at > ?",
                (hash_secret(code), now),
            ).fetchone()
            if row is None:
                raise AuthError(401, INVALID_CODE)
            # Máximo de sesiones simultáneas por invitación: se cierra la más antigua.
            active = conn.execute(
                "SELECT token_hash FROM sessions WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ? "
                "ORDER BY created_at",
                (row["id"], now),
            ).fetchall()
            for old in active[: max(0, len(active) - self.max_sessions + 1)]:
                conn.execute("UPDATE sessions SET revoked_at = ? WHERE token_hash = ?", (now, old["token_hash"]))
            token = secrets.token_urlsafe(32)  # 256 bits
            token_hash = hash_secret(token)
            expires_at = now + self.session_ttl_seconds
            conn.execute(
                "INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
                (token_hash, row["id"], now, expires_at),
            )
        logger.info("Invitación canjeada (visitante %s).", row["id"])
        return token, User(row["id"], row["label"], token_hash, expires_at)

    def authenticate(self, token: str) -> User | None:
        """Sesión vigente y no revocada, de una invitación vigente y no revocada."""
        rows = self.db.query(
            "SELECT s.token_hash, s.expires_at, i.id, i.label FROM sessions s JOIN invitations i ON i.id = s.user_id "
            "WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ? "
            "AND i.revoked_at IS NULL AND i.expires_at > ?",
            (hash_secret(token), self._clock(), self._clock()),
        )
        if not rows:
            return None
        row = rows[0]
        return User(row["id"], row["label"], row["token_hash"], row["expires_at"])

    def logout(self, user: User) -> None:
        with self.db.transaction() as conn:
            conn.execute("UPDATE sessions SET revoked_at = ? WHERE token_hash = ?", (self._clock(), user.token_hash))


# --- Cloudflare Turnstile ---------------------------------------------------------

TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"
TURNSTILE_ACTION = "redeem"


class TurnstileVerifier(Protocol):
    required: bool

    def verify(self, token: str | None, remote_ip: str | None) -> bool: ...


class CloudflareTurnstile:
    """Valida el token del widget con Cloudflare. Ante cualquier error, rechaza (falla cerrada)."""

    required = True

    def __init__(self, secret: str, *, expected_hostname: str | None = None, post: Callable | None = None, timeout: float = 5):
        self._secret = secret
        self._expected_hostname = expected_hostname
        self._timeout = timeout
        if post is None:
            import httpx

            post = httpx.post
        self._post = post

    def verify(self, token: str | None, remote_ip: str | None) -> bool:
        if not token or len(token) > 2048:
            return False
        data = {"secret": self._secret, "response": token}
        if remote_ip:
            data["remoteip"] = remote_ip
        try:
            response = self._post(TURNSTILE_VERIFY_URL, data=data, timeout=self._timeout)
            result = response.json()
        except Exception:  # red, tiempo agotado o respuesta inválida
            logger.warning("No se pudo verificar Turnstile; se rechaza el canje.")
            return False
        if result.get("success") is not True:
            return False
        if result.get("action") != TURNSTILE_ACTION:  # el widget se crea con action="redeem"
            return False
        if self._expected_hostname and result.get("hostname") != self._expected_hostname:
            return False
        return True


class DevelopmentTurnstile:
    """Solo desarrollo y pruebas, sin clave de Turnstile: `validate_for_startup` lo impide en producción."""

    required = False

    def verify(self, token: str | None, remote_ip: str | None) -> bool:
        return True
