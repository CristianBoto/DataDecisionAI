"""Acceso por invitación: canje del código (con Turnstile), sesión actual y cierre de sesión."""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, ConfigDict, Field

from app.api.deps import get_auth, require_user
from app.core.config import Settings, get_settings
from app.core.rate_limit import RateLimiter, client_ip
from app.services.auth import AuthError, AuthService, TurnstileVerifier, User

router = APIRouter(prefix="/auth", tags=["acceso"])


class RedeemRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: str = Field(min_length=8, max_length=80, pattern=r"^[A-Za-z0-9_-]+$")
    turnstile_token: str | None = Field(default=None, max_length=2048)


class SessionInfo(BaseModel):
    label: str
    expires_at: str


class RedeemResponse(SessionInfo):
    token: str


def _iso(timestamp: float) -> str:
    return datetime.fromtimestamp(timestamp, timezone.utc).isoformat(timespec="seconds")


def get_turnstile(request: Request) -> TurnstileVerifier:
    return request.app.state.turnstile


def get_limiter(request: Request) -> RateLimiter:
    return request.app.state.rate_limiter


@router.get("/config")
def access_config(turnstile: TurnstileVerifier = Depends(get_turnstile)) -> dict:
    """Lo único público: si el canje exige Turnstile (la clave del sitio la tiene el frontend)."""
    return {"turnstile_required": turnstile.required}


@router.post("/redeem", response_model=RedeemResponse)
def redeem(
    body: RedeemRequest,
    request: Request,
    settings: Settings = Depends(get_settings),
    auth: AuthService = Depends(get_auth),
    turnstile: TurnstileVerifier = Depends(get_turnstile),
    limiter: RateLimiter = Depends(get_limiter),
) -> RedeemResponse:
    ip = client_ip(request.scope, settings.forwarded_ip_hops)
    # Límite estricto por IP para impedir probar códigos por fuerza bruta.
    if not limiter.hit(f"redeem:{ip}", settings.redeem_attempts_per_15_minutes, 15 * 60):
        raise HTTPException(429, "Demasiados intentos de ingreso. Esperá 15 minutos.", headers={"Retry-After": "900"})
    if not turnstile.verify(body.turnstile_token, ip):
        raise HTTPException(403, "No se pudo verificar que sos una persona. Completá la verificación e intentá de nuevo.")
    try:
        token, user = auth.redeem(body.code)
    except AuthError as exc:
        raise HTTPException(exc.status_code, exc.detail) from exc
    return RedeemResponse(token=token, label=user.label, expires_at=_iso(user.session_expires_at))


@router.get("/session", response_model=SessionInfo)
def current_session(user: User = Depends(require_user)) -> SessionInfo:
    return SessionInfo(label=user.label, expires_at=_iso(user.session_expires_at))


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(user: User = Depends(require_user), auth: AuthService = Depends(get_auth)) -> None:
    auth.logout(user)
