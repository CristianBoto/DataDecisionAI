"""Respuesta de OpenAI al interpretar resultados (beta pública, 02/11/2026).

En la beta, la interpretación de 10 operaciones terminó en «La respuesta de OpenAI no tenía el formato esperado».
Causa: `responses.parse` valida el texto aunque la respuesta esté cortada por `max_output_tokens` (2500, que incluye
el razonamiento); el JSON truncado fallaba en Pydantic antes de revisar el estado. Estas pruebas recorren el flujo
real de la API con el proveedor OpenAI y un cliente simulado: sin red, sin OpenAI, sin consumo.
"""

import json
import logging
from types import SimpleNamespace

import pytest

from app.services.openai_provider import OpenAIProvider
from tests.ai_helpers import ORIGIN, make_client, no_network  # noqa: F401 - no_network se activa en todo el módulo
from tests.interpretation_cases import COLUMNS, PLANS_17, sales72_csv
from tests.test_interpretation_context import run_api

SECTIONS = ("findings", "trends", "implications", "recommendations", "hypotheses")
NOTES = ("information_needed", "not_supported", "limitations", "data_quality")


class FakeResponses:
    def __init__(self, response):
        self.response = response
        self.calls = []

    def create(self, **kwargs):
        self.calls.append(kwargs)
        return self.response


def openai_response(text: str | None, *, status="completed", reason=None):
    content = [SimpleNamespace(type="output_text", text=text)] if text is not None else []
    return SimpleNamespace(
        status=status,
        incomplete_details=SimpleNamespace(reason=reason) if reason else None,
        usage=SimpleNamespace(input_tokens=5025, output_tokens=2500 if status == "incomplete" else 1800),
        output=[SimpleNamespace(type="message", phase=None, content=content)],
    )


def interpretation(*items, **overrides) -> dict:
    body = {"executive_summary": list(items), **{s: [] for s in SECTIONS}, **{n: [] for n in NOTES}}
    return {**body, **overrides}


def total_item(value: float) -> dict:
    text = f"{value:,.0f}".replace(",", ".")
    return {"text": f"Las ventas suman {text} ARS.", "evidence": ["P1.O1"], "claims": [
        {"ref": "P1.O1", "measure": "monto_ars", "kind": "value", "keys": [], "period_from": None, "period_to": None,
         "value": value, "unit": "ARS"}]}


@pytest.fixture
def flow():
    """Análisis ejecutado con Pandas y una función que interpreta con la respuesta simulada de OpenAI."""
    responses = FakeResponses(None)
    provider = OpenAIProvider(client_factory=lambda settings: SimpleNamespace(responses=responses))
    client, app = make_client(ai_enabled=True, provider=provider)
    result = run_api(client, app, sales72_csv(), PLANS_17, COLUMNS)
    total = result["results"][0]["operations"][0]["rows"][0]["values"][0]

    def prepare():
        prepared = client.post("/api/ai/interpretations", json={"execution_id": result["execution_id"]}, headers=ORIGIN)
        assert prepared.status_code == 201, prepared.text
        return prepared.json()

    def interpret(response, prepared=None):
        responses.response = response
        prepared = prepared or prepare()
        answer = client.post(f"/api/ai/interpretations/{prepared['request_id']}/authorize",
                             json={"payload_sha256": prepared["payload_sha256"], "confirm": True}, headers=ORIGIN)
        return answer, prepared

    return SimpleNamespace(client=client, app=app, result=result, total=total, responses=responses,
                           prepare=prepare, interpret=interpret)


def usage(app) -> list[dict]:
    return [dict(r) for r in app.state.db.query("SELECT input_tokens, output_tokens, estimated FROM ai_usage")]


def test_a_valid_response_is_validated_and_its_figures_verified_against_pandas(flow):
    answer, prepared = flow.interpret(openai_response(json.dumps(interpretation(total_item(flow.total)))))
    assert answer.status_code == 200, answer.text
    item = answer.json()["interpretation"]["executive_summary"][0]
    assert item["status"] == "verified" and item["claims"][0]["value"] == flow.total
    call = flow.responses.calls[0]
    # Formato estructurado estricto, con el tope y la espera propios de la interpretación.
    assert call["text"]["format"]["type"] == "json_schema" and call["text"]["format"]["strict"] is True
    assert call["text"]["format"]["name"] == "AIInterpretation"
    assert call["max_output_tokens"] == 6000 and call["timeout"] == 90 and call["store"] is False
    assert json.loads(call["input"]) == prepared["payload"]
    assert usage(flow.app) == [{"input_tokens": 5025, "output_tokens": 1800, "estimated": 0}]


@pytest.mark.parametrize("response, fragment", [
    (openai_response('{"executive_summary": [{"text": "Las ventas', status="incomplete", reason="max_output_tokens"),
     "superó el límite de tokens de salida"),
    (openai_response('{"executive_summary": [{"text": "Las ventas', status="incomplete", reason="content_filter"),
     "quedó incompleta"),
    (openai_response('{"executive_summary": [ esto no es JSON'), "no era un JSON válido"),
    (openai_response('{"executive_summary": []}'), "le faltaban campos obligatorios"),
    (openai_response(json.dumps(interpretation(findings="un texto en lugar de una lista"))), "tenía datos de un tipo incorrecto"),
    (openai_response(json.dumps({**interpretation(), "limitations": [3]})), "tenía datos de un tipo incorrecto"),
    (openai_response(None), "no devolvió contenido"),
])
def test_unusable_responses_are_reported_by_cause_and_nothing_is_used(flow, response, fragment, caplog):
    with caplog.at_level(logging.WARNING):
        answer, _ = flow.interpret(response)
    assert answer.status_code == 502
    detail = answer.json()["detail"]
    assert fragment in detail and "no se usó nada" in detail and "Se registró el consumo" in detail
    # Se registran los tokens REALES (no el máximo estimado) y no se registra el contenido de la respuesta.
    assert usage(flow.app) == [{"input_tokens": 5025, "output_tokens": response.usage.output_tokens, "estimated": 0}]
    assert "Las ventas" not in caplog.text and "esto no es JSON" not in caplog.text


def test_a_failure_keeps_the_results_and_retrying_needs_a_new_authorization(flow):
    failed, used = flow.interpret(openai_response('{"executive_summary": [', status="incomplete", reason="max_output_tokens"))
    assert failed.status_code == 502
    # La autorización ya se usó: reenviarla no hace otra solicitud a OpenAI.
    again = flow.client.post(f"/api/ai/interpretations/{used['request_id']}/authorize",
                             json={"payload_sha256": used["payload_sha256"], "confirm": True}, headers=ORIGIN)
    assert again.status_code == 404 and len(flow.responses.calls) == 1
    # Los resultados de Pandas siguen disponibles: se prepara un envío nuevo, con su contenido y su costo máximo.
    prepared = flow.prepare()
    assert prepared["payload"] == used["payload"] and prepared["estimated_max_cost_usd"] > 0
    answer, _ = flow.interpret(openai_response(json.dumps(interpretation(total_item(flow.total)))), prepared)
    assert answer.status_code == 200 and len(flow.responses.calls) == 2


def test_the_maximum_cost_shown_covers_the_interpretation_output_limit(flow):
    prepared = flow.prepare()
    # gpt-6-luna: USD 0,10 por millón de entrada y 0,50 de salida; el tope de salida de la interpretación es 6000.
    expected = (prepared["estimated_input_tokens"] * 0.10 + 6000 * 0.50) / 1_000_000
    assert prepared["estimated_max_cost_usd"] == pytest.approx(expected, rel=1e-3)


def test_figures_that_do_not_match_pandas_are_discarded_not_shown(flow):
    wrong = total_item(flow.total + 1000)
    answer, _ = flow.interpret(openai_response(json.dumps(interpretation(total_item(flow.total), wrong))))
    assert answer.status_code == 200
    summary = answer.json()["interpretation"]["executive_summary"]
    assert [i["claims"][0]["value"] for i in summary] == [flow.total]
    assert any("Se descartaron 1 afirmaciones" in n for n in answer.json()["notes"])


def test_if_no_figure_survives_the_verification_nothing_is_concluded(flow):
    answer, _ = flow.interpret(openai_response(json.dumps(interpretation(total_item(flow.total + 1000)))))
    assert answer.status_code == 502
    assert "no superó la verificación" in answer.json()["detail"]
