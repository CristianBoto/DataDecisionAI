"""Utilidades comunes de las pruebas de IA: red bloqueada y proveedor falso.

Ninguna prueba consume tokens: el proveedor real se reemplaza por uno falso o
por un cliente simulado, y cualquier conexión externa hace fallar la prueba.
"""

import socket
import tempfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app
from app.schemas.ai_plan import AIAssistantReply
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


def make_client(
    *,
    ai_enabled=False,
    api_key=_DEFAULT_KEY,
    provider=None,
    budget_usd=1.0,
    user_budget_usd=None,
    max_requests=25,
    authenticated=True,
    **settings,
):
    """Cliente con configuración aislada (sin backend/.env), base temporal y una sesión de invitación.

    `max_requests` es el límite diario del visitante; `budget_usd`, el presupuesto
    global (y, si no se indica otro, también el del visitante).
    """
    if api_key is _DEFAULT_KEY:
        api_key = "sk-prueba-falsa" if ai_enabled else None
    settings.setdefault("rate_limit_per_minute", 1000)
    settings.setdefault("ai_global_daily_requests", 1000)
    settings.setdefault("ai_legacy_usage_file", (Path(tempfile.mkdtemp()) / "sin-registro.json").as_posix())
    config = Settings(
        _env_file=None,
        environment="test",
        ai_enabled=ai_enabled,
        openai_api_key=api_key,
        database_url=f"sqlite:///{(Path(tempfile.mkdtemp()) / 'pruebas.db').as_posix()}",
        ai_budget_usd=budget_usd,
        ai_user_budget_usd=budget_usd if user_budget_usd is None else user_budget_usd,
        ai_user_daily_requests=max_requests,
        **settings,
    )
    app = create_app(config)
    if provider is not None:
        app.state.ai_provider = provider
    client = TestClient(app)
    if authenticated:
        client.headers.update(login(app))
        # Dueño de los recursos que las pruebas crean directamente en los registros.
        app.state.test_user_id = app.state.auth.authenticate(client.headers["Authorization"].split()[1]).id
    return client, app


def login(app, label="visitante de prueba") -> dict:
    """Crea una invitación, la canjea y devuelve el encabezado de la sesión (solo pruebas)."""
    _, code = app.state.auth.create_invitation(label, days=1)
    token, _ = app.state.auth.redeem(code)
    return {"Authorization": f"Bearer {token}"}


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


def max_cost_per_request() -> float:
    """Costo máximo estimado de un envío del contexto de prueba (se recalcula si cambian las instrucciones)."""
    from app.schemas.ai_context import AIContext
    from app.services.ai_gateway import estimate_request

    return estimate_request(AIContext.model_validate(context()), Settings(_env_file=None))[1]
