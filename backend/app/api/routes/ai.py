"""Endpoints de la frontera de IA (Fases 3B.1 y 3B.2).

Solo `authorize` puede llegar a OpenAI, y únicamente después de una
autorización de uso único, con la IA habilitada, clave configurada y
presupuesto disponible. El resto de los endpoints no hace llamadas externas.
Todos exigen sesión y operan solo sobre recursos del propio visitante.
"""

from fastapi import APIRouter, Depends, HTTPException, Request, status

from app.api.deps import require_user
from app.core.config import Settings, get_settings
from app.schemas.ai_context import AIContext, AIStatus, AuthorizeRequest, PreparedRequest
from app.services.ai_budget import AIBudget
from app.services.ai_gateway import (
    AIConversationStore,
    AIGatewayError,
    AIPlanStore,
    AIProvider,
    AIRequestStore,
    authorize_and_send,
    estimate_request,
    send_in_conversation,
)
from app.services.auth import User

router = APIRouter(prefix="/ai", tags=["ia"], dependencies=[Depends(require_user)])


def get_ai_store(request: Request) -> AIRequestStore:
    return request.app.state.ai_store


def get_ai_provider(request: Request) -> AIProvider:
    return request.app.state.ai_provider


def get_ai_budget(request: Request) -> AIBudget:
    return request.app.state.ai_budget


def get_ai_plans(request: Request) -> AIPlanStore:
    return request.app.state.ai_plans


def get_ai_conversations(request: Request) -> AIConversationStore:
    return request.app.state.ai_conversations


@router.get("/status", response_model=AIStatus)
def ai_status(
    settings: Settings = Depends(get_settings),
    provider: AIProvider = Depends(get_ai_provider),
    budget: AIBudget = Depends(get_ai_budget),
    user: User = Depends(require_user),
) -> AIStatus:
    # Informa si hay clave configurada, nunca su valor. El presupuesto y las
    # solicitudes son los de la cuota del visitante (acotada por el presupuesto global).
    usage = budget.status(user.id)
    return AIStatus(
        ai_enabled=settings.ai_enabled,
        provider_configured=bool(settings.openai_api_key),
        external_calls_implemented=provider.implemented,
        model=settings.openai_model,
        budget_usd=usage.user_budget_usd,
        spent_usd=usage.user_spent_usd,
        remaining_usd=usage.remaining_usd,
        requests_used=usage.requests_today,
        max_requests=usage.max_requests_per_day,
        max_output_tokens=settings.ai_max_output_tokens,
        conversation_ttl_minutes=settings.ai_conversation_ttl_minutes,
        conversation_max_messages=settings.ai_conversation_max_messages,
    )


@router.post("/requests", response_model=PreparedRequest, status_code=status.HTTP_201_CREATED)
def prepare_request(
    context: AIContext,
    settings: Settings = Depends(get_settings),
    store: AIRequestStore = Depends(get_ai_store),
    provider: AIProvider = Depends(get_ai_provider),
    user: User = Depends(require_user),
) -> PreparedRequest:
    """Valida el contexto contra la lista blanca y lo devuelve para revisión. No envía nada."""
    estimated_tokens, max_cost = estimate_request(context, settings)
    if estimated_tokens > settings.ai_max_input_tokens:
        raise HTTPException(status_code=413, detail="El contexto supera el tamaño máximo permitido para la IA.")
    try:
        request_id, sha = store.prepare(context, user.id)
    except AIGatewayError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
    return PreparedRequest(
        request_id=request_id,
        payload=context,
        payload_sha256=sha,
        expires_in_seconds=store.ttl_seconds,
        ai_enabled=settings.ai_enabled,
        external_calls_implemented=provider.implemented,
        estimated_input_tokens=estimated_tokens,
        estimated_max_cost_usd=round(max_cost, 6) if max_cost is not None else None,
    )


@router.post("/requests/{request_id}/authorize")
def authorize_request(
    request_id: str,
    body: AuthorizeRequest,
    settings: Settings = Depends(get_settings),
    store: AIRequestStore = Depends(get_ai_store),
    provider: AIProvider = Depends(get_ai_provider),
    budget: AIBudget = Depends(get_ai_budget),
    plans: AIPlanStore = Depends(get_ai_plans),
    conversations: AIConversationStore = Depends(get_ai_conversations),
    user: User = Depends(require_user),
) -> dict:
    try:
        return authorize_and_send(
            store,
            provider,
            budget,
            plans,
            settings=settings,
            request_id=request_id,
            approved_sha256=body.payload_sha256,
            owner=user.id,
            scope=body.scope,
            conversations=conversations,
        )
    except AIGatewayError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


@router.post("/conversations/{conversation_id}/messages")
def send_conversation_message(
    conversation_id: str,
    context: AIContext,
    settings: Settings = Depends(get_settings),
    provider: AIProvider = Depends(get_ai_provider),
    budget: AIBudget = Depends(get_ai_budget),
    plans: AIPlanStore = Depends(get_ai_plans),
    conversations: AIConversationStore = Depends(get_ai_conversations),
    user: User = Depends(require_user),
) -> dict:
    """Mensaje de una conversación autorizada. Mismos límites; la frontera de privacidad no puede cambiar."""
    try:
        return send_in_conversation(
            conversations, provider, budget, plans, settings=settings, conversation_id=conversation_id, context=context,
            owner=user.id,
        )
    except AIGatewayError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


@router.delete("/conversations/{conversation_id}", status_code=status.HTTP_204_NO_CONTENT)
def revoke_conversation(
    conversation_id: str,
    conversations: AIConversationStore = Depends(get_ai_conversations),
    user: User = Depends(require_user),
) -> None:
    conversations.revoke(conversation_id, user.id)


@router.delete("/requests/{request_id}", status_code=status.HTTP_204_NO_CONTENT)
def cancel_request(request_id: str, store: AIRequestStore = Depends(get_ai_store), user: User = Depends(require_user)) -> None:
    store.cancel(request_id, user.id)


@router.post("/plans/{plan_id}/approve")
def approve_plan(plan_id: str, plans: AIPlanStore = Depends(get_ai_plans), user: User = Depends(require_user)) -> dict:
    """Registra la aprobación del visitante (solo de sus propios planes). No ejecuta cálculos."""
    try:
        return plans.approve(plan_id, user.id)
    except AIGatewayError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
