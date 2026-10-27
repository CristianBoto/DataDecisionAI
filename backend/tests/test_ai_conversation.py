"""Autorización por conversación (Fase 3B.2).

El permiso se aplica en el backend: está atado a la frontera de privacidad
aprobada, vence, tiene un máximo de mensajes, se puede revocar y no saltea
ningún límite de consumo. Todo con proveedores falsos y la red bloqueada.
"""

import threading

import pytest

from app.services.ai_gateway import AIConversationStore, AIGatewayError, boundary_hash
from app.schemas.ai_context import AIContext
from tests.ai_helpers import (  # noqa: F401 - no_network se activa en todo el módulo
    ORIGIN,
    FakeProvider,
    context,
    make_client,
    no_network,
    prepare,
    source,
)


def authorize(client, prepared, scope="message"):
    return client.post(
        f"/api/ai/requests/{prepared['request_id']}/authorize",
        json={"payload_sha256": prepared["payload_sha256"], "confirm": True, "scope": scope},
        headers=ORIGIN,
    )


def send(client, conversation_id, body):
    return client.post(f"/api/ai/conversations/{conversation_id}/messages", json=body, headers=ORIGIN)


def start_conversation(client, body=None):
    body = body or context()
    response = authorize(client, prepare(client, body).json(), scope="conversation")
    assert response.status_code == 200, response.text
    return response.json()["conversation"]


def test_message_scope_does_not_create_a_conversation_permission():
    client, _ = make_client(ai_enabled=True, provider=FakeProvider())
    response = authorize(client, prepare(client, context()).json())
    assert response.status_code == 200
    assert "conversation" not in response.json()


def test_conversation_scope_allows_next_messages_without_a_new_review():
    provider = FakeProvider()
    client, _ = make_client(ai_enabled=True, provider=provider, ai_conversation_ttl_minutes=15)
    conversation = start_conversation(client)
    assert conversation["expires_in_seconds"] == 15 * 60 and conversation["max_messages"] == 20

    turns = [{"role": "user", "content": "Ver ventas"}, {"role": "assistant", "content": "¿Por mes o por sector?"}]
    response = send(client, conversation["conversation_id"], {**context(), "message": "Por mes", "history": turns})
    assert response.status_code == 200, response.text
    assert response.json()["reply"]["plans"]
    assert len(provider.received) == 2
    assert provider.received[1]["message"] == "Por mes" and provider.received[1]["history"] == turns


def test_sending_without_a_valid_permission_is_rejected():
    provider = FakeProvider()
    client, _ = make_client(ai_enabled=True, provider=provider)
    response = send(client, "inexistente", {**context(), "message": "Hola"})
    assert response.status_code == 404 and "No se envió nada" in response.json()["detail"]
    assert provider.received == []


@pytest.mark.parametrize("change", [
    {"objective": "Otro objetivo distinto"},
    {"sources": [source("A", {"name": "ANYO", "format": "numeric", "semantic_type": "quantitative"})]},  # otra interpretación
    {"sources": [source("A"), source("B")]},                                                               # otra fuente
    {"sources": [source("A", {"name": "MES", "format": "numeric"})]},                                      # otra columna
])
def test_changing_the_privacy_boundary_invalidates_the_permission(change):
    provider = FakeProvider()
    client, _ = make_client(ai_enabled=True, provider=provider)
    conversation = start_conversation(client)
    response = send(client, conversation["conversation_id"], {**context(), **change, "message": "Sigamos"})
    assert response.status_code == 409 and "nueva autorización" in response.json()["detail"]
    # El permiso se revocó: tampoco sirve volviendo a la configuración original.
    assert send(client, conversation["conversation_id"], {**context(), "message": "Sigamos"}).status_code == 404
    assert len(provider.received) == 1


def test_new_messages_and_history_do_not_invalidate_the_permission():
    client, _ = make_client(ai_enabled=True, provider=FakeProvider())
    cid = start_conversation(client)["conversation_id"]
    for i in range(3):
        history = [{"role": "user", "content": f"Mensaje {j}"} for j in range(i)]
        assert send(client, cid, {**context(), "message": f"Pregunta {i}", "history": history}).status_code == 200


def test_revocation_blocks_new_calls():
    provider = FakeProvider()
    client, _ = make_client(ai_enabled=True, provider=provider)
    cid = start_conversation(client)["conversation_id"]
    assert client.delete(f"/api/ai/conversations/{cid}", headers=ORIGIN).status_code == 204
    assert send(client, cid, {**context(), "message": "¿Seguimos?"}).status_code == 404
    assert len(provider.received) == 1


def test_permission_expires(monkeypatch):
    client, app = make_client(ai_enabled=True, provider=FakeProvider())
    now = [1000.0]
    app.state.ai_conversations = AIConversationStore(clock=lambda: now[0])
    cid = start_conversation(client)["conversation_id"]
    now[0] += 30 * 60 + 1
    response = send(client, cid, {**context(), "message": "Hola"})
    assert response.status_code == 410 and "venció" in response.json()["detail"]


def test_permission_has_a_maximum_number_of_messages():
    client, _ = make_client(ai_enabled=True, provider=FakeProvider(), ai_conversation_max_messages=2)
    cid = start_conversation(client)["conversation_id"]
    assert send(client, cid, {**context(), "message": "uno"}).status_code == 200
    assert send(client, cid, {**context(), "message": "dos"}).status_code == 200
    assert send(client, cid, {**context(), "message": "tres"}).status_code == 429


def test_budget_and_request_limits_still_apply_with_a_permission():
    provider = FakeProvider()
    client, app = make_client(ai_enabled=True, provider=provider, max_requests=2)
    cid = start_conversation(client)["conversation_id"]
    assert send(client, cid, {**context(), "message": "uno"}).status_code == 200
    assert send(client, cid, {**context(), "message": "dos"}).status_code == 429  # límite diario del visitante

    client, app = make_client(ai_enabled=True, provider=FakeProvider(), budget_usd=0.0016)  # alcanza para un envío (máx. ≈ USD 0,0014) y no para dos
    cid = start_conversation(client)["conversation_id"]
    response = send(client, cid, {**context(), "message": "otra"})
    assert response.status_code == 402 and "Presupuesto insuficiente en tu cuota" in response.json()["detail"]


def test_context_size_limit_applies_with_a_permission():
    client, _ = make_client(ai_enabled=True, provider=FakeProvider(), ai_max_input_tokens=3500)
    cid = start_conversation(client)["conversation_id"]
    long_history = [{"role": "user", "content": "x" * 2000}] * 8
    response = send(client, cid, {**context(), "message": "Hola", "history": long_history})
    assert response.status_code == 413


def test_disabling_ai_revokes_the_permission():
    provider = FakeProvider()
    client, app = make_client(ai_enabled=True, provider=provider)
    cid = start_conversation(client)["conversation_id"]
    disabled, _ = make_client(ai_enabled=False, provider=provider)
    # Mismo visitante y mismas conversaciones, con la IA deshabilitada.
    disabled.app.state.ai_conversations = app.state.ai_conversations
    disabled.app.state.auth = app.state.auth
    disabled.headers["Authorization"] = client.headers["Authorization"]
    assert send(disabled, cid, {**context(), "message": "Hola"}).status_code == 403
    assert send(client, cid, {**context(), "message": "Hola"}).status_code == 404


def test_message_is_required_and_whitelist_still_applies():
    client, _ = make_client(ai_enabled=True, provider=FakeProvider())
    cid = start_conversation(client)["conversation_id"]
    assert send(client, cid, context()).status_code == 422                             # sin mensaje
    assert send(client, cid, {**context(), "message": "x", "fileName": "a.csv"}).status_code == 422
    assert send(client, cid, {**context(), "message": "x"}).status_code == 200


def test_invalid_replies_are_still_discarded_in_a_conversation():
    from tests.ai_helpers import reply_for

    provider = FakeProvider()
    client, _ = make_client(ai_enabled=True, provider=provider)
    cid = start_conversation(client)["conversation_id"]
    provider.reply = lambda payload: reply_for(payload, plans=[{
        "source_alias": "A", "title": "Inventado", "rationale": "r", "columns_needed": ["SALARIO"],
        "operations": [], "charts": [], "limitations": [],
    }])
    response = send(client, cid, {**context(), "message": "Hola"})
    assert response.status_code == 502 and "SALARIO" in response.json()["detail"]


def test_unauthorized_origins_cannot_use_or_revoke_conversations():
    client, _ = make_client(ai_enabled=True, provider=FakeProvider())
    cid = start_conversation(client)["conversation_id"]
    bad = {"Origin": "https://sitio-externo.example"}
    assert client.post(f"/api/ai/conversations/{cid}/messages", json={**context(), "message": "x"}, headers=bad).status_code == 403
    assert client.delete(f"/api/ai/conversations/{cid}", headers=bad).status_code == 403


def test_simultaneous_messages_in_the_same_conversation_are_not_allowed():
    store = AIConversationStore()
    boundary = boundary_hash(AIContext.model_validate(context()))
    cid = store.create(boundary, 60, "u1")
    with store.use(cid, boundary, 10, "u1"):
        with pytest.raises(AIGatewayError) as caught:
            with store.use(cid, boundary, 10, "u1"):
                pass
        assert caught.value.status_code == 409
    with store.use(cid, boundary, 10, "u1"):  # al terminar, se libera
        pass


def test_concurrent_requests_cannot_overspend_the_budget(tmp_path):
    """Seis visitantes a la vez: la reserva previa impide superar el presupuesto global."""
    import time

    from app.core.config import Settings
    from app.services.ai_budget import AIBudget
    from app.services.ai_gateway import AIPlanStore, estimate_request, send_in_conversation
    from app.services.database import Database

    class SlowProvider(FakeProvider):
        def send(self, ctx, settings):
            time.sleep(0.2)  # mientras tanto llegan las demás solicitudes
            return super().send(ctx, settings)

    settings = Settings(_env_file=None, ai_enabled=True, openai_api_key="sk-prueba-falsa")
    body = AIContext.model_validate({**context(), "message": "x"})
    _, max_cost = estimate_request(body, settings)
    budget = AIBudget(  # el global alcanza para 4 a costo máximo; cada cuota, de sobra
        Database(tmp_path / "uso.db"), budget_usd=max_cost * 4.5, user_budget_usd=1.0, user_daily_requests=25,
        global_daily_requests=100,
    )
    store, plans, provider = AIConversationStore(), AIPlanStore(), SlowProvider()
    boundary = boundary_hash(body)
    results = []

    def worker(owner):
        cid = store.create(boundary, 600, owner)
        try:
            send_in_conversation(
                store, provider, budget, plans, settings=settings, conversation_id=cid, context=body, owner=owner
            )
            results.append(200)
        except AIGatewayError as exc:
            results.append(exc.status_code)

    threads = [threading.Thread(target=worker, args=(f"visitante-{i}",)) for i in range(6)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=10)
    assert sorted(results) == [200, 200, 200, 200, 402, 402]
    assert len(provider.received) == 4
    assert budget.global_spent_usd() <= budget.budget_usd
