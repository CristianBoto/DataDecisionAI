"""Endpoints de la frontera de IA (Fase 3B.1). No realizan llamadas externas."""

from fastapi import APIRouter, Depends, HTTPException, Request, status

from app.core.config import Settings, get_settings
from app.schemas.ai_context import AIContext, AIStatus, AuthorizeRequest, PreparedRequest
from app.services.ai_gateway import AIGatewayError, AIProvider, AIRequestStore, authorize_and_send

router = APIRouter(prefix="/ai", tags=["ia"])


def get_ai_store(request: Request) -> AIRequestStore:
    return request.app.state.ai_store


def get_ai_provider(request: Request) -> AIProvider:
    return request.app.state.ai_provider


@router.get("/status", response_model=AIStatus)
def ai_status(settings: Settings = Depends(get_settings), provider: AIProvider = Depends(get_ai_provider)) -> AIStatus:
    # Informa si hay clave configurada, nunca su valor.
    return AIStatus(
        ai_enabled=settings.ai_enabled,
        provider_configured=bool(settings.openai_api_key),
        external_calls_implemented=provider.implemented,
    )


@router.post("/requests", response_model=PreparedRequest, status_code=status.HTTP_201_CREATED)
def prepare_request(
    context: AIContext,
    settings: Settings = Depends(get_settings),
    store: AIRequestStore = Depends(get_ai_store),
    provider: AIProvider = Depends(get_ai_provider),
) -> PreparedRequest:
    """Valida el contexto contra la lista blanca y lo devuelve para revisión. No envía nada."""
    try:
        request_id, sha = store.prepare(context)
    except AIGatewayError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
    return PreparedRequest(
        request_id=request_id,
        payload=context,
        payload_sha256=sha,
        expires_in_seconds=store.ttl_seconds,
        ai_enabled=settings.ai_enabled,
        external_calls_implemented=provider.implemented,
    )


@router.post("/requests/{request_id}/authorize")
def authorize_request(
    request_id: str,
    body: AuthorizeRequest,
    settings: Settings = Depends(get_settings),
    store: AIRequestStore = Depends(get_ai_store),
    provider: AIProvider = Depends(get_ai_provider),
) -> dict:
    try:
        return authorize_and_send(
            store,
            provider,
            ai_enabled=settings.ai_enabled,
            request_id=request_id,
            approved_sha256=body.payload_sha256,
        )
    except AIGatewayError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


@router.delete("/requests/{request_id}", status_code=status.HTTP_204_NO_CONTENT)
def cancel_request(request_id: str, store: AIRequestStore = Depends(get_ai_store)) -> None:
    store.cancel(request_id)
