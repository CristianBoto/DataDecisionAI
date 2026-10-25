"""Utilidades comunes de las pruebas de IA: red bloqueada y proveedor falso.

Ninguna prueba consume tokens: el proveedor real se reemplaza por uno falso o
por un cliente simulado, y cualquier conexión externa hace fallar la prueba.
"""

import socket
import tempfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings, get_settings
from app.main import create_app
from app.schemas.ai_plan import AIAssistantReply
from app.services.ai_budget import AIBudget
from app.services.openai_provider import ProviderResult

LOOPBACK = {"127.0.0.1", "::1", "localhost"}
external_attempts: list = []
ORIGIN = {"Origin": "http://localhost:5173"}
_DEFAULT_KEY = object()


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


def reply_for(context: dict, **overrides) -> AIAssistantReply:
    """Respuesta válida mínima: un plan por fuente, con su primera columna."""
    plans = []
    for src in context["sources"]:
        col = src["columns"][0]["name"]
        plans.append({
            "source_alias": src["alias"], "title": f"Análisis de la fuente {src['alias']}",
            "rationale": "Permite ver la distribución principal.", "columns_needed": [col],
            "operations": [{"operation": "frequency", "columns": [col], "group_by": [], "description": "Frecuencia"}],
            "charts": [{"type": "bar", "x": col, "y": None, "title": "Frecuencia"}], "limitations": [],
        })
    data = {
        "message": "Propongo un análisis por fuente.", "interpreted_objective": context["objective"],
        "source_relationship": "independent" if len(plans) > 1 else "single",
        "questions": [], "plans": plans, "warnings": [],
    }
    data.update(overrides)
    return AIAssistantReply.model_validate(data)


class FakeProvider:
    """Proveedor de prueba: registra lo que recibiría la IA y responde sin red."""

    implemented = True

    def __init__(self, reply=None, *, input_tokens=1200, output_tokens=400, error=None, problem=None):
        self.received = []
        self.reply = reply
        self.input_tokens = input_tokens
        self.output_tokens = output_tokens
        self.error = error
        self.problem = problem

    def send(self, context, settings):
        payload = context.model_dump(mode="json")
        self.received.append(payload)
        if self.error is not None:
            raise self.error
        if self.problem is not None:
            return ProviderResult(None, self.input_tokens, self.output_tokens, self.problem)
        reply = self.reply(payload) if callable(self.reply) else (self.reply or reply_for(payload))
        return ProviderResult(reply, self.input_tokens, self.output_tokens)


def make_client(*, ai_enabled=False, api_key=_DEFAULT_KEY, provider=None, budget_usd=1.0, max_requests=25, **settings):
    """Cliente con configuración aislada (sin backend/.env) y registro de consumo temporal."""
    if api_key is _DEFAULT_KEY:
        api_key = "sk-prueba-falsa" if ai_enabled else None
    app = create_app()
    config = Settings(_env_file=None, ai_enabled=ai_enabled, openai_api_key=api_key, **settings)
    app.dependency_overrides[get_settings] = lambda: config
    usage_file = Path(tempfile.mkdtemp()) / "ai_usage.json"
    app.state.ai_budget = AIBudget(usage_file, budget_usd, max_requests)
    if provider is not None:
        app.state.ai_provider = provider
    return TestClient(app), app


def source(alias="A", *columns):
    cols = columns or ({"name": "ANYO", "format": "numeric", "semantic_type": "temporal", "semantic_confidence": "high"},)
    return {"alias": alias, "columns": list(cols)}


def context(*sources, objective="Evolución anual de las importaciones"):
    return {"objective": objective, "sources": list(sources) or [source()]}


def prepare(client, body):
    return client.post("/api/ai/requests", json=body, headers=ORIGIN)


def authorize(client, prepared):
    return client.post(
        f"/api/ai/requests/{prepared['request_id']}/authorize",
        json={"payload_sha256": prepared["payload_sha256"], "confirm": True},
        headers=ORIGIN,
    )
