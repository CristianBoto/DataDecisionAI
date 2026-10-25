"""Fase 3B.2: proveedor OpenAI, control del consumo y validación de planes.

Todo con proveedores falsos o clientes simulados: ninguna prueba consume tokens
y la red externa está bloqueada.
"""

import json
from types import SimpleNamespace

import httpx2
import openai
import pytest

from app.core.config import Settings
from app.schemas.ai_context import AIContext
from app.schemas.ai_plan import AIAssistantReply
from app.services.ai_budget import AIBudget
from app.services.openai_provider import INSTRUCTIONS, OpenAIProvider, ProviderCallError, _default_client
from tests.ai_helpers import (  # noqa: F401 - no_network se activa en todo el módulo
    ORIGIN,
    FakeProvider,
    authorize,
    context,
    make_client,
    no_network,
    prepare,
    reply_for,
    source,
)

# --- Caso obligatorio: dos fuentes reales, metadatos sintéticos equivalentes ----

INDICADORES = source(
    "A",
    {"name": "provincia", "format": "text", "semantic_type": "categorical", "semantic_confidence": "high"},
    {"name": "anio", "format": "numeric", "semantic_type": "temporal", "semantic_confidence": "high"},
    {"name": "indicador", "format": "text", "semantic_type": "categorical", "semantic_confidence": "high"},
    {"name": "valor", "format": "numeric", "semantic_type": "quantitative", "semantic_confidence": "high",
     "missing_markers": "pending"},
)
SIACAM = source(
    "B",
    {"name": "ANYO", "format": "numeric", "semantic_type": "temporal", "semantic_confidence": "high"},
    {"name": "ORIGEN", "format": "text", "semantic_type": "categorical", "semantic_confidence": "high",
     "missing_markers": "pending"},
    {"name": "PPRO", "format": "integer", "semantic_type": "identifier", "semantic_confidence": None,
     "user_corrected": True, "missing_markers": "pending"},
    {"name": "CIF", "format": "numeric", "semantic_type": "quantitative", "semantic_confidence": "high"},
)
OBJECTIVE = (
    "Quiero analizar los indicadores provinciales y las importaciones de minerales de SIACAM "
    "de manera independiente, sin unir los datasets."
)


def mandatory_case_reply(payload: dict) -> AIAssistantReply:
    """Lo que se espera de la IA real en el caso obligatorio (respuesta simulada)."""
    return AIAssistantReply.model_validate({
        "message": "Voy a analizar cada fuente por separado, sin unirlas. Antes, necesito aclarar los NA.",
        "interpreted_objective": "Analizar A y B de forma independiente.",
        "source_relationship": "independent",
        "questions": [
            {"question": "¿Los NA de ORIGEN son datos faltantes o un país válido (Namibia)?",
             "reason": "Cambia el conteo por país de origen.", "source_alias": "B", "column": "ORIGEN"},
            {"question": "PPRO figura como código: ¿querés agrupar por producto?",
             "reason": "Es numérico, pero marcaste que es un identificador.", "source_alias": "B", "column": "PPRO"},
        ],
        "plans": [
            {"source_alias": "A", "title": "Evolución de indicadores por provincia",
             "rationale": "Permite comparar provincias a lo largo del tiempo.", "columns_needed": ["provincia", "anio", "indicador", "valor"],
             "operations": [{"operation": "time_series", "columns": ["valor"], "group_by": ["provincia", "indicador"],
                             "description": "Valor por año"}],
             "charts": [{"type": "line", "x": "anio", "y": "valor", "title": "Indicadores por año"}],
             "limitations": ["Los NA de valor están sin decidir."]},
            {"source_alias": "B", "title": "Importaciones de minerales por año",
             "rationale": "Muestra cómo evolucionó el valor CIF importado.", "columns_needed": ["ANYO", "CIF", "PPRO"],
             "operations": [{"operation": "sum", "columns": ["CIF"], "group_by": ["ANYO"], "description": "CIF total por año"},
                            {"operation": "distinct_count", "columns": ["PPRO"], "group_by": ["ANYO"],
                             "description": "Productos distintos por año (PPRO se cuenta, no se suma)"}],
             "charts": [{"type": "bar", "x": "ANYO", "y": "CIF", "title": "CIF por año"}],
             "limitations": []},
        ],
        "warnings": ["No se calculó ningún resultado: los valores se obtendrán con Pandas tras tu aprobación."],
    })


def test_mandatory_case_two_independent_plans_without_joining():
    provider = FakeProvider(mandatory_case_reply)
    client, app = make_client(ai_enabled=True, provider=provider)
    prepared = prepare(client, {"objective": OBJECTIVE, "sources": [INDICADORES, SIACAM]}).json()
    response = authorize(client, prepared)
    assert response.status_code == 200, response.text
    data = response.json()

    reply = data["reply"]
    assert reply["source_relationship"] == "independent"
    assert {p["source_alias"] for p in reply["plans"]} == {"A", "B"}
    assert all(len({p["source_alias"]}) == 1 for p in reply["plans"])  # cada plan, una sola fuente
    assert any(q["column"] == "PPRO" for q in reply["questions"])
    assert any("NA" in q["question"] for q in reply["questions"])
    assert len(data["plan_ids"]) == 2
    # Los planes quedan guardados como propuestos: no se ejecuta nada.
    assert all(app.state.ai_plans.get(pid)["status"] == "proposed" for pid in data["plan_ids"])

    # Lo enviado: solo alias, metadatos revisados y el objetivo (sin nombres de archivo ni valores).
    sent = json.dumps(provider.received[0], ensure_ascii=False)
    for forbidden in ("indicadores-provinciales", "impominerales", ".csv", "Namibia"):
        assert forbidden not in sent
    assert provider.received[0]["sources"][1]["columns"][2]["user_corrected"] is True


def test_plan_approval_is_recorded_but_nothing_is_executed():
    client, _ = make_client(ai_enabled=True, provider=FakeProvider())
    prepared = prepare(client, context()).json()
    plan_id = authorize(client, prepared).json()["plan_ids"][0]
    approved = client.post(f"/api/ai/plans/{plan_id}/approve", headers=ORIGIN)
    assert approved.status_code == 200
    assert approved.json()["status"] == "approved" and approved.json()["executed"] is False
    assert client.post("/api/ai/plans/inexistente/approve", headers=ORIGIN).status_code == 404
    assert client.post(f"/api/ai/plans/{plan_id}/approve", headers={"Origin": "null"}).status_code == 403


@pytest.mark.parametrize("count", [1, 3])
def test_one_and_three_sources_get_one_plan_each(count):
    provider = FakeProvider()
    client, _ = make_client(ai_enabled=True, provider=provider)
    prepared = prepare(client, context(*[source(a) for a in "ABC"[:count]])).json()
    data = authorize(client, prepared).json()
    assert [p["source_alias"] for p in data["reply"]["plans"]] == list("ABC"[:count])
    assert data["reply"]["source_relationship"] == ("single" if count == 1 else "independent")


# --- Validación de la respuesta -----------------------------------------------

def _plan(alias="A", column="ANYO"):
    return {"source_alias": alias, "title": "Plan", "rationale": "r", "columns_needed": [column],
            "operations": [], "charts": [], "limitations": []}


@pytest.mark.parametrize("overrides, fragment", [
    ({"plans": [_plan("B")]}, "fuente B"),
    ({"plans": [_plan("A", "columna_inventada")]}, "columna_inventada"),
    ({"plans": [], "questions": [{"question": "¿?", "reason": "r", "source_alias": "A", "column": "SALARIO"}]}, "SALARIO"),
    ({"plans": [], "questions": []}, "ni planes"),
    ({"message": "```python\nimport os\n```"}, "código"),
])
def test_invalid_replies_are_discarded_and_no_plan_is_saved(overrides, fragment):
    provider = FakeProvider(lambda payload: reply_for(payload, **overrides))
    client, app = make_client(ai_enabled=True, provider=provider)
    prepared = prepare(client, context()).json()
    response = authorize(client, prepared)
    assert response.status_code == 502
    assert fragment in response.json()["detail"]
    assert app.state.ai_plans._plans == {}
    # El consumo real se registró igual.
    assert app.state.ai_budget.spent_usd > 0


def test_operations_outside_the_catalog_are_rejected_by_the_schema():
    bad = reply_for(context()).model_dump()
    bad["plans"][0]["operations"][0]["operation"] = "exec_python"
    with pytest.raises(ValueError):
        AIAssistantReply.model_validate(bad)


def test_relating_sources_adds_a_warning():
    provider = FakeProvider(lambda p: reply_for(p, source_relationship="relate"))
    client, _ = make_client(ai_enabled=True, provider=provider)
    prepared = prepare(client, context(source("A"), source("B"))).json()
    warnings = authorize(client, prepared).json()["reply"]["warnings"]
    assert any("una sola fuente" in w for w in warnings)


@pytest.mark.parametrize("problem", [
    "La respuesta superó el límite de tokens de salida y quedó incompleta.",
    "La IA no aceptó responder esta solicitud.",
])
def test_incomplete_or_refused_replies_are_reported(problem):
    client, app = make_client(ai_enabled=True, provider=FakeProvider(problem=problem))
    prepared = prepare(client, context()).json()
    response = authorize(client, prepared)
    assert response.status_code == 502 and problem in response.json()["detail"]
    assert app.state.ai_budget.spent_usd > 0


# --- Consumo y presupuesto ----------------------------------------------------

def test_real_usage_is_recorded_without_content():
    provider = FakeProvider(input_tokens=1200, output_tokens=400)
    client, app = make_client(ai_enabled=True, provider=provider)
    prepared = prepare(client, context(objective="Objetivo confidencial de la planta Norte")).json()
    usage = authorize(client, prepared).json()["usage"]
    # gpt-6-luna: USD 0,10 / 0,50 por millón → 1200 × 0,10 + 400 × 0,50 = 320 millonésimas.
    assert usage["cost_usd"] == pytest.approx(0.00032)
    assert usage["input_tokens"] == 1200 and usage["output_tokens"] == 400
    ledger = app.state.ai_budget.usage_file.read_text(encoding="utf-8")
    record = json.loads(ledger)[0]
    assert set(record) == {"at", "model", "input_tokens", "output_tokens", "cost_usd", "estimated"}
    assert "confidencial" not in ledger and "ANYO" not in ledger
    status = client.get("/api/ai/status").json()
    assert status["spent_usd"] == pytest.approx(0.00032) and status["requests_used"] == 1


def test_insufficient_budget_blocks_before_sending():
    provider = FakeProvider()
    client, _ = make_client(ai_enabled=True, provider=provider, budget_usd=0.0001)
    prepared = prepare(client, context()).json()
    assert prepared["estimated_max_cost_usd"] > 0.0001
    response = authorize(client, prepared)
    assert response.status_code == 402
    assert "Presupuesto local insuficiente" in response.json()["detail"]
    assert provider.received == []


def test_request_limit_per_session():
    provider = FakeProvider()
    client, _ = make_client(ai_enabled=True, provider=provider, max_requests=1)
    assert authorize(client, prepare(client, context()).json()).status_code == 200
    response = authorize(client, prepare(client, context()).json())
    assert response.status_code == 429 and len(provider.received) == 1


def test_budget_persists_across_restarts(tmp_path):
    usage_file = tmp_path / "ai_usage.json"
    first = AIBudget(usage_file, 1.0, 5)
    first.settle(first.reserve(0.01), model="gpt-6-luna", input_tokens=10, output_tokens=10, cost=0.4, estimated=False)
    second = AIBudget(usage_file, 1.0, 5)
    assert second.spent_usd == pytest.approx(0.4)
    with pytest.raises(Exception, match="Presupuesto"):
        second.reserve(0.7)


def test_unreadable_ledger_blocks_spending(tmp_path):
    usage_file = tmp_path / "ai_usage.json"
    usage_file.write_text("{roto", encoding="utf-8")
    with pytest.raises(Exception, match="Presupuesto"):
        AIBudget(usage_file, 1.0, 5).reserve(0.001)
    assert usage_file.read_text(encoding="utf-8") == "{roto"  # no se sobrescribe


def test_unknown_model_without_price_is_not_sent():
    provider = FakeProvider()
    client, _ = make_client(ai_enabled=True, provider=provider, openai_model="modelo-sin-precio")
    prepared = prepare(client, context()).json()
    assert prepared["estimated_max_cost_usd"] is None
    response = authorize(client, prepared)
    assert response.status_code == 503 and "OPENAI_PRICE_INPUT_PER_1M" in response.json()["detail"]
    assert provider.received == []


def test_context_size_limit_applies_in_the_backend():
    client, _ = make_client(ai_enabled=True, provider=FakeProvider(), ai_max_input_tokens=1500)
    cols = [{"name": f"columna_larga_{i:03d}", "format": "text"} for i in range(200)]
    assert prepare(client, context(source("A", *cols))).status_code == 413


# --- Contexto: historial y objetivo no duplicado --------------------------------

def test_first_message_equal_to_objective_is_not_sent_twice():
    client, _ = make_client()
    payload = prepare(client, {**context(), "message": "Evolución anual de las importaciones"}).json()["payload"]
    assert payload["message"] is None


def test_history_is_part_of_the_approved_content_and_limited():
    client, _ = make_client()
    turns = [{"role": "user", "content": "Hola"}, {"role": "assistant", "content": "¿Qué querés analizar?"}]
    first = prepare(client, {**context(), "history": turns}).json()
    second = prepare(client, {**context(), "history": turns[:1]}).json()
    assert first["payload"]["history"] == turns
    assert first["payload_sha256"] != second["payload_sha256"]
    assert prepare(client, {**context(), "history": turns * 5}).status_code == 422  # más de 8 turnos
    assert prepare(client, {**context(), "history": [{"role": "system", "content": "x"}]}).status_code == 422
    assert prepare(client, {**context(), "history": [{**turns[0], "rows": [1]}]}).status_code == 422


def test_conversation_turns_are_sent_to_the_provider():
    provider = FakeProvider()
    client, _ = make_client(ai_enabled=True, provider=provider)
    turns = [{"role": "user", "content": "Quiero ver importaciones"}, {"role": "assistant", "content": "¿Por año o por país?"}]
    prepared = prepare(client, {**context(), "message": "Por año", "history": turns}).json()
    assert authorize(client, prepared).status_code == 200
    assert provider.received[0]["history"] == turns and provider.received[0]["message"] == "Por año"


# --- Proveedor OpenAI con cliente simulado (sin red) --------------------------

REQUEST = httpx2.Request("POST", "https://api.openai.com/v1/responses")


class FakeResponses:
    def __init__(self, outcome):
        self.outcome = outcome
        self.calls = []

    def parse(self, **kwargs):
        self.calls.append(kwargs)
        if isinstance(self.outcome, Exception):
            raise self.outcome
        return self.outcome


def fake_openai(outcome):
    responses = FakeResponses(outcome)
    return OpenAIProvider(client_factory=lambda settings: SimpleNamespace(responses=responses)), responses


def completed(parsed, *, status="completed", reason=None, refusal=False):
    content = [SimpleNamespace(type="refusal", refusal="No")] if refusal else []
    return SimpleNamespace(
        status=status,
        incomplete_details=SimpleNamespace(reason=reason) if reason else None,
        usage=SimpleNamespace(input_tokens=900, output_tokens=300),
        output=[SimpleNamespace(type="message", content=content)],
        output_parsed=parsed,
    )


def settings(**overrides):
    return Settings(_env_file=None, ai_enabled=True, openai_api_key="sk-prueba-falsa", **overrides)


CTX = AIContext.model_validate(context())


def test_openai_provider_uses_responses_api_with_limits_and_no_storage():
    provider, responses = fake_openai(completed(reply_for(context())))
    result = provider.send(CTX, settings(ai_max_output_tokens=1200))
    call = responses.calls[0]
    assert call["model"] == "gpt-6-luna" and call["text_format"] is AIAssistantReply
    assert call["max_output_tokens"] == 1200 and call["store"] is False
    assert call["reasoning"] == {"effort": "low"} and call["instructions"] == INSTRUCTIONS
    assert json.loads(call["input"]) == CTX.model_dump(mode="json")
    assert result.reply is not None and (result.input_tokens, result.output_tokens) == (900, 300)


def test_default_client_never_retries_and_has_a_timeout():
    client = _default_client(settings(ai_timeout_seconds=12))
    assert client.max_retries == 0
    assert client.timeout == 12


@pytest.mark.parametrize("outcome, problem", [
    (completed(None, status="incomplete", reason="max_output_tokens"), "límite de tokens"),
    (completed(None, refusal=True), "no aceptó"),
    (completed(None), "formato esperado"),
])
def test_openai_provider_reports_unusable_replies(outcome, problem):
    provider, _ = fake_openai(outcome)
    result = provider.send(CTX, settings())
    assert result.reply is None and problem in result.problem


@pytest.mark.parametrize("error, status, fragment, may_have_cost", [
    (openai.APITimeoutError(REQUEST), 504, "no respondió a tiempo", True),
    (openai.APIConnectionError(request=REQUEST), 502, "conexión", False),
    (openai.AuthenticationError("bad key sk-xyz", response=httpx2.Response(401, request=REQUEST), body=None), 502, "credenciales", False),
    (openai.RateLimitError("quota", response=httpx2.Response(429, request=REQUEST), body={"code": "insufficient_quota"}), 429, "saldo", False),
    (openai.RateLimitError("rate", response=httpx2.Response(429, request=REQUEST), body=None), 429, "limitó", False),
    (openai.NotFoundError("model", response=httpx2.Response(404, request=REQUEST), body=None), 502, "modelo", False),
    (ValueError("salida malformada"), 502, "formato esperado", True),
])
def test_openai_errors_are_translated_without_secrets(error, status, fragment, may_have_cost):
    provider, _ = fake_openai(error)
    with pytest.raises(ProviderCallError) as caught:
        provider.send(CTX, settings())
    assert caught.value.status_code == status and fragment in caught.value.detail
    assert caught.value.may_have_cost is may_have_cost
    assert "sk-" not in caught.value.detail


def test_timeout_records_the_estimated_maximum_and_is_not_retried():
    provider, responses = fake_openai(openai.APITimeoutError(REQUEST))
    client, app = make_client(ai_enabled=True, provider=provider)
    prepared = prepare(client, context()).json()
    response = authorize(client, prepared)
    assert response.status_code == 504
    assert len(responses.calls) == 1  # sin reintentos
    record = json.loads(app.state.ai_budget.usage_file.read_text(encoding="utf-8"))[0]
    assert record["estimated"] is True
    assert record["cost_usd"] == pytest.approx(prepared["estimated_max_cost_usd"], rel=1e-3)
    # La autorización ya se usó: repetir exige validar de nuevo.
    assert authorize(client, prepared).status_code == 404


def test_connection_error_records_no_cost():
    provider, _ = fake_openai(openai.APIConnectionError(request=REQUEST))
    client, app = make_client(ai_enabled=True, provider=provider)
    response = authorize(client, prepare(client, context()).json())
    assert response.status_code == 502
    assert app.state.ai_budget.spent_usd == 0
    assert not app.state.ai_budget.usage_file.exists()
