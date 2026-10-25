"""Frontera de privacidad para la IA (Fase 3B.1).

Todas las pruebas corren con la red bloqueada: cualquier intento de conexión
externa haría fallar la prueba.
"""

import logging
import socket

import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings, get_settings
from app.main import create_app
from app.services.ai_gateway import AIRequestStore, payload_hash
from app.schemas.ai_context import AIContext


LOOPBACK = {"127.0.0.1", "::1", "localhost"}
external_attempts: list = []


@pytest.fixture(autouse=True)
def no_network(monkeypatch):
    """Bloquea toda conexión fuera del propio equipo.

    Se permite el loopback porque, en Windows, asyncio crea su canal interno
    con un par de sockets conectados a 127.0.0.1 (no es una llamada externa).
    """
    original_connect = socket.socket.connect
    external_attempts.clear()

    def guarded_connect(sock, address):
        host = address[0] if isinstance(address, tuple) else address
        if host not in LOOPBACK:
            external_attempts.append(address)
            raise AssertionError(f"Intento de conexión externa durante las pruebas: {address}")
        return original_connect(sock, address)

    def blocked_create_connection(address, *args, **kwargs):
        external_attempts.append(address)
        raise AssertionError(f"Intento de conexión externa durante las pruebas: {address}")

    monkeypatch.setattr(socket.socket, "connect", guarded_connect)
    monkeypatch.setattr(socket, "create_connection", blocked_create_connection)
    yield
    assert external_attempts == []


def test_network_guard_detects_external_connections():
    with pytest.raises(AssertionError, match="conexión externa"):
        socket.create_connection(("api.openai.com", 443))
    external_attempts.clear()


class FakeProvider:
    """Proveedor de prueba: registra lo que recibiría la IA, sin red."""

    implemented = True

    def __init__(self):
        self.received = []

    def send(self, payload):
        self.received.append(payload)
        return {"status": "sent"}


def make_client(*, ai_enabled=False, api_key=None, provider=None):
    app = create_app()
    app.dependency_overrides[get_settings] = lambda: Settings(_env_file=None, ai_enabled=ai_enabled, openai_api_key=api_key)
    if provider is not None:
        app.state.ai_provider = provider
    return TestClient(app), app


def source(alias="A", *columns):
    cols = columns or ({"name": "ANYO", "format": "numeric", "semantic_type": "temporal", "semantic_confidence": "high"},)
    return {"alias": alias, "columns": list(cols)}


def context(*sources, objective="Evolución anual de las importaciones"):
    return {"objective": objective, "sources": list(sources) or [source()]}


ORIGIN = {"Origin": "http://localhost:5173"}


def prepare(client, body):
    return client.post("/api/ai/requests", json=body, headers=ORIGIN)


def authorize(client, prepared):
    return client.post(
        f"/api/ai/requests/{prepared['request_id']}/authorize",
        json={"payload_sha256": prepared["payload_sha256"], "confirm": True},
        headers=ORIGIN,
    )


# --- Contenido permitido (lista blanca) ---------------------------------------

@pytest.mark.parametrize("extra", [
    {"fileName": "clientes_confidencial.csv"},
    {"file": "cliente,dni\nACME,30111222\n"},
    {"previewRows": [{"cliente": "ACME"}]},
    {"rows": [["ACME", "30111222"]]},
    {"rowCount": 102254},
])
def test_context_rejects_files_rows_previews_and_unrequested_fields(extra):
    client, _ = make_client()
    assert prepare(client, {**context(), **extra}).status_code == 422
    src = {**source(), **extra}
    assert prepare(client, context(src)).status_code == 422


@pytest.mark.parametrize("extra", [{"sampleValues": ["ACME"]}, {"examples": ["30111222"]}, {"distinct": 7}])
def test_columns_cannot_carry_values_or_statistics(extra):
    client, _ = make_client()
    col = {"name": "cliente", "format": "text", **extra}
    assert prepare(client, context(source("A", col))).status_code == 422


@pytest.mark.parametrize("count", [1, 2, 3])
def test_one_two_or_three_independent_sources(count):
    client, _ = make_client()
    body = context(*[source(alias) for alias in "ABC"[:count]])
    response = prepare(client, body)
    assert response.status_code == 201
    assert [s["alias"] for s in response.json()["payload"]["sources"]] == list("ABC"[:count])


@pytest.mark.parametrize("sources", [
    [source(a) for a in "ABC"] + [source("A")],      # 4 fuentes
    [source("A"), source("A")],                      # alias repetido
    [{"alias": "D", "columns": source()["columns"]}],  # alias fuera de A-C
])
def test_invalid_source_sets_are_rejected(sources):
    client, _ = make_client()
    assert prepare(client, {"objective": "Objetivo válido", "sources": sources}).status_code == 422


def test_prepared_payload_is_exactly_the_whitelisted_content():
    client, _ = make_client()
    prepared = prepare(client, context(source("A"), source("B"))).json()
    payload = prepared["payload"]
    assert set(payload) == {"version", "objective", "message", "sources"}
    assert payload["message"] is None  # solo presente en la autorización de un mensaje
    assert set(payload["sources"][0]) == {"alias", "columns", "size_range"}
    assert set(payload["sources"][0]["columns"][0]) == {
        "name", "format", "semantic_type", "semantic_confidence", "user_corrected", "missing_markers",
    }
    assert prepared["payload_sha256"] == payload_hash(AIContext.model_validate(payload))
    assert prepared["ai_enabled"] is False and prepared["external_calls_implemented"] is False


# --- Autorización ------------------------------------------------------------

def test_nothing_is_sent_while_ai_is_disabled():
    provider = FakeProvider()
    client, _ = make_client(ai_enabled=False, provider=provider)
    prepared = prepare(client, context()).json()
    response = authorize(client, prepared)
    assert response.status_code == 403
    assert "AI_ENABLED=false" in response.json()["detail"]
    assert provider.received == []
    # La autorización no queda guardada para más tarde.
    assert authorize(client, prepared).status_code == 403


def test_unprepared_or_altered_requests_are_rejected():
    provider = FakeProvider()
    client, _ = make_client(ai_enabled=True, provider=provider)
    prepared = prepare(client, context()).json()
    assert authorize(client, {**prepared, "request_id": "inexistente"}).status_code == 404
    assert authorize(client, {**prepared, "payload_sha256": "0" * 64}).status_code == 409
    missing_confirm = client.post(
        f"/api/ai/requests/{prepared['request_id']}/authorize", json={"payload_sha256": prepared["payload_sha256"]}, headers=ORIGIN
    )
    assert missing_confirm.status_code == 422
    assert provider.received == []


def test_authorization_is_single_use_and_sends_only_the_approved_content():
    provider = FakeProvider()
    client, _ = make_client(ai_enabled=True, provider=provider)
    prepared = prepare(client, context(source("A"), source("B"))).json()
    assert authorize(client, prepared).status_code == 200
    assert provider.received == [prepared["payload"]]
    assert authorize(client, prepared).status_code == 404  # no se reutiliza
    assert len(provider.received) == 1


def test_cancelled_and_expired_requests_cannot_be_sent():
    provider = FakeProvider()
    client, app = make_client(ai_enabled=True, provider=provider)
    prepared = prepare(client, context()).json()
    assert client.delete(f"/api/ai/requests/{prepared['request_id']}", headers=ORIGIN).status_code == 204
    assert authorize(client, prepared).status_code == 404

    now = [1000.0]
    app.state.ai_store = AIRequestStore(ttl_seconds=60, clock=lambda: now[0])
    prepared = prepare(client, context()).json()
    now[0] += 61
    assert authorize(client, prepared).status_code in (404, 410)
    assert provider.received == []


def test_default_provider_never_calls_openai_in_this_phase():
    client, _ = make_client(ai_enabled=True, api_key="sk-prueba-no-real")
    prepared = prepare(client, context()).json()
    response = authorize(client, prepared)
    assert response.status_code == 501
    assert "No se envió nada" in response.json()["detail"]


# --- Configuración, origen y registros ------------------------------------------

def test_status_reports_configuration_without_revealing_the_key():
    client, _ = make_client(ai_enabled=False, api_key="sk-prueba-secreta-123")
    response = client.get("/api/ai/status")
    assert response.json() == {"ai_enabled": False, "provider_configured": True, "external_calls_implemented": False}
    assert "sk-prueba" not in response.text


def test_ai_is_disabled_by_default(monkeypatch):
    monkeypatch.delenv("AI_ENABLED", raising=False)
    assert Settings(_env_file=None).ai_enabled is False


@pytest.mark.parametrize("origin", ["https://sitio-externo.example", "null"])
def test_unauthorized_origins_are_rejected(origin):
    client, _ = make_client(ai_enabled=True, provider=FakeProvider())
    response = client.post("/api/ai/requests", json=context(), headers={"Origin": origin})
    assert response.status_code == 403
    assert client.delete("/api/ai/requests/x", headers={"Origin": origin}).status_code == 403


def test_oversized_ai_requests_are_rejected():
    client, _ = make_client()
    huge = context(objective="x" * 2000)
    huge["sources"][0]["columns"] = [{"name": f"c{i}" * 20, "format": "text"} for i in range(250)] * 1
    response = client.post("/api/ai/requests", json={**huge, "padding": "y" * 70_000}, headers=ORIGIN)
    assert response.status_code == 413


def test_request_content_is_not_logged(caplog):
    client, _ = make_client(ai_enabled=False)
    secret_objective = "Analizar despidos confidenciales de la planta Norte"
    with caplog.at_level(logging.DEBUG):
        prepared = prepare(client, context(source("A", {"name": "diagnostico_medico", "format": "text"}), objective=secret_objective)).json()
        authorize(client, prepared)
    logged = caplog.text
    assert "despidos" not in logged and "diagnostico_medico" not in logged


# --- Decisiones de la revisión obligatoria ------------------------------------

def test_user_review_decisions_are_accepted_without_values():
    client, _ = make_client()
    col = {
        "name": "codigo", "format": "integer", "semantic_type": "identifier",
        "semantic_confidence": None, "user_corrected": True, "missing_markers": "valid_value",
    }
    response = prepare(client, context(source("A", col, {"name": "monto", "format": "decimal"})))
    assert response.status_code == 201
    sent = response.json()["payload"]["sources"][0]["columns"]
    assert sent[0]["user_corrected"] is True and sent[0]["missing_markers"] == "valid_value"
    assert sent[1]["user_corrected"] is False and sent[1]["missing_markers"] is None


@pytest.mark.parametrize("bad", [
    {"missing_markers": ["NA", "N/A"]},   # valores de marcadores: no se aceptan
    {"missing_markers": "borrar"},        # decisión inexistente
    {"format": "float64"},                # formato técnico de Pandas
])
def test_review_fields_only_accept_closed_values(bad):
    client, _ = make_client()
    col = {"name": "codigo", "format": "text", **bad}
    assert prepare(client, context(source("A", col))).status_code == 422


def test_each_message_needs_its_own_authorization():
    provider = FakeProvider()
    client, _ = make_client(ai_enabled=True, provider=provider)
    first = prepare(client, {**context(), "message": "¿Cómo evolucionó el CIF por año?"}).json()
    second = prepare(client, {**context(), "message": "¿Y por país?"}).json()
    assert first["payload_sha256"] != second["payload_sha256"]
    # La autorización del primer mensaje no sirve para el segundo.
    wrong = client.post(
        f"/api/ai/requests/{second['request_id']}/authorize",
        json={"payload_sha256": first["payload_sha256"], "confirm": True},
        headers=ORIGIN,
    )
    assert wrong.status_code == 409
    assert authorize(client, first).status_code == 200
    assert provider.received == [first["payload"]]
