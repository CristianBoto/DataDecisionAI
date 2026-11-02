"""Contexto compacto para interpretar con la IA (Fase 5.1).

Reproduce el caso real (72 filas, 17 operaciones en 3 planes) que superaba el límite de tokens y prueba
resultados mucho más grandes. Datos sintéticos; proveedor falso: sin red, sin OpenAI, sin consumo.
"""

import json

import pytest

from app.core.config import Settings
from app.schemas.ai_plan import AIPlan
from app.schemas.interpretation import AIInterpretation
from app.services.interpretation_context import compact_context, context_char_budget
from app.services.report import build_context, estimate_interpretation
from tests.ai_helpers import ORIGIN, FakeProvider, make_client, no_network  # noqa: F401 - no_network se activa en todo el módulo
from tests.interpretation_cases import COLUMNS, PLANS_17, run_plans, sales17, sales72_csv
from app.services.report import descriptive_summary

SETTINGS = Settings(_env_file=None)


def full_context(result: dict, summary: dict | None = None):
    return build_context({"result": result, "summary": summary or descriptive_summary(result), "objective": "Decidir dónde reforzar las ventas"})


def compact_ops(compact) -> dict:
    return {op.ref: op for plan in compact.plans for op in plan.operations}


def run_api(client, app, csv: str, plans: list[tuple[str, list[dict]]], columns: list[dict]) -> dict:
    ids = []
    for title, ops in plans:
        plan = AIPlan.model_validate({"source_alias": "A", "title": title, "rationale": "r", "columns_needed": [],
                                      "operations": ops, "charts": [], "limitations": []})
        plan_id = app.state.ai_plans.save(plan, app.state.test_user_id)
        app.state.ai_plans.approve(plan_id, app.state.test_user_id)
        ids.append(plan_id)
    body = {"plan_ids": ids, "sources": [{"alias": "A", "columns": columns}], "objective": "Decidir dónde reforzar las ventas"}
    response = client.post("/api/analysis/execute", data={"request": json.dumps(body)},
                           files={"file_A": ("ventas.csv", csv.encode("utf-8"), "text/csv")}, headers=ORIGIN)
    assert response.status_code == 200, response.text
    return response.json()


# --- El caso real: 17 operaciones en 3 planes ------------------------------------------------

def test_the_old_context_exceeded_the_limit_and_the_compact_one_fits_with_margin():
    result, summary = sales17()
    full = full_context(result, summary)
    old_tokens, _ = estimate_interpretation(full, SETTINGS)
    assert old_tokens > SETTINGS.ai_max_input_tokens  # la causa del error reportado
    compact = compact_context(full, SETTINGS)
    tokens, _ = estimate_interpretation(compact, SETTINGS)
    assert tokens <= SETTINGS.ai_max_input_tokens * 0.85
    assert len(json.dumps(compact.wire(), ensure_ascii=False)) <= context_char_budget(SETTINGS)
    # Todo va completo: las 17 operaciones, de los 3 planes, con todas sus filas.
    assert compact.coverage.model_dump() == {"operations": 17, "full": 17, "summarized": 0, "facts_only": 0,
                                             "plans_excluded": [], "note": compact.coverage.note}
    assert [p.ref for p in compact.plans] == ["P1", "P2", "P3"]


def test_no_figure_is_lost_or_changed():
    result, summary = sales17()
    full = full_context(result, summary)
    compact = compact_context(full, SETTINGS)
    sent = compact_ops(compact)
    for op in full.operations:
        c = sent[op.ref]
        assert len(c.rows) == len(op.rows)
        kept = [i for i, m in enumerate(op.measures) if m in c.measures]
        for row, crow in zip(op.rows, c.rows):
            assert crow == [*row.keys, *(row.values[i] for i in kept)]  # mismas cifras, mismo orden
        # Una medida omitida por repetida existe, idéntica, en la operación referenciada.
        for label, ref in c.repeated.items():
            i = next(i for i, m in enumerate(op.measures) if label.startswith(f"{m.column} ({m.aggregate}"))
            source = next(o for o in full.operations if o.ref == ref)
            j = next(j for j, m in enumerate(source.measures) if (m.column, m.aggregate) == (op.measures[i].column, op.measures[i].aggregate))
            assert {tuple(r.keys): r.values[i] for r in op.rows} == {tuple(r.keys): r.values[j] for r in source.rows}
    assert sum(len(c.repeated) for c in sent.values()) >= 3  # la variación repite la serie; el Pareto, la comparación


def test_no_duplicated_statistics_and_enough_for_recommendations():
    result, summary = sales17()
    compact = compact_context(full_context(result, summary), SETTINGS)
    wire = compact.wire()
    # Sin bloque aparte del resumen descriptivo: los hechos van solo donde aportan cifras derivadas.
    assert "descriptive_summary" not in wire
    sent = compact_ops(compact)
    assert sent["P1.O3"].facts and "variación de" in sent["P1.O3"].facts[0]  # tendencia por rubro
    assert sent["P2.O4"].facts and "concentran el 80 %" in sent["P2.O4"].facts[0]  # Pareto
    assert not sent["P2.O1"].facts  # una comparación simple: sus filas ya dicen todo
    # Cada advertencia viaja una sola vez, con sus operaciones.
    texts = [w["text"] for w in wire.get("warnings", [])]
    assert len(texts) == len(set(texts))


def test_the_full_flow_interprets_and_verifies_against_the_original_results():
    provider = FakeProvider(interpretation=lambda payload: {
        "executive_summary": [{"text": f"Las ventas suman {total_text} ARS.", "evidence": ["P1.O1"], "claims": [
            {"ref": "P1.O1", "measure": "monto_ars", "kind": "value", "keys": [], "period_from": None, "period_to": None,
             "value": total, "unit": "ARS"}]}],
        "findings": [], "trends": [], "implications": [], "recommendations": [], "hypotheses": [],
        "information_needed": [], "not_supported": [], "limitations": [], "data_quality": [],
    })
    client, app = make_client(ai_enabled=True, provider=provider)
    result = run_api(client, app, sales72_csv(), PLANS_17, COLUMNS)
    total = result["results"][0]["operations"][0]["rows"][0]["values"][0]
    total_text = f"{total:,.0f}".replace(",", ".")
    prepared = client.post("/api/ai/interpretations", json={"execution_id": result["execution_id"]}, headers=ORIGIN)
    assert prepared.status_code == 201, prepared.text
    body = prepared.json()
    assert body["payload"]["version"] == 2 and body["payload"]["coverage"]["full"] == 17
    authorized = client.post(f"/api/ai/interpretations/{body['request_id']}/authorize",
                             json={"payload_sha256": body["payload_sha256"], "confirm": True}, headers=ORIGIN)
    assert authorized.status_code == 200, authorized.text
    # El proveedor recibió EXACTAMENTE el contenido mostrado y autorizado.
    assert provider.interpreted == [body["payload"]]
    item = authorized.json()["interpretation"]["executive_summary"][0]
    assert item["status"] == "verified" and item["claims"][0]["value"] == total


# --- Resultados mucho más grandes ------------------------------------------------------------

def big_csv() -> str:
    lines = ["fecha,producto,region,canal,monto"]
    for m in range(1, 25):
        for p in range(120):
            lines.append(f"{2023 + (m - 1) // 12}-{(m - 1) % 12 + 1:02d}-10,Producto {p:03d},Región {p % 7},Canal {p % 3},{100 + p * 3 + m * 7}")
    return "\n".join(lines) + "\n"


BIG_COLUMNS = [
    {"name": "fecha", "original": "fecha", "semantic_type": "temporal"},
    {"name": "producto", "original": "producto", "semantic_type": "categorical"},
    {"name": "region", "original": "region", "semantic_type": "categorical"},
    {"name": "canal", "original": "canal", "semantic_type": "categorical"},
    {"name": "monto", "original": "monto", "semantic_type": "quantitative", "unit": "ARS", "additivity": "additive"},
]


def _op(operation, columns, group_by=(), description=None):
    return {"operation": operation, "columns": list(columns), "group_by": list(group_by), "description": description or operation}


# Dos planes distintos con resultados grandes (2.880 filas por mes y producto, 120 productos) y un
# tercero que repite operaciones de los anteriores (como suele proponer la IA: el total en cada plan).
BIG_PLANS = [
    ("Productos", [
        _op("time_series", ["fecha", "monto"], ["producto"], "Por mes y producto"),
        _op("compare_groups", ["monto"], ["producto"], "Por producto"),
        _op("pareto", ["monto"], ["producto"], "Ranking de productos"),
        _op("sum", ["monto"], description="Total"),
    ]),
    ("Regiones y canales", [
        _op("time_series", ["fecha", "monto"], ["region"], "Por mes y región"),
        _op("variation", ["monto"], ["fecha", "canal"], "Variación por canal"),
        _op("compare_groups", ["monto"], ["region", "canal"], "Canal dentro de cada región"),
        _op("mean", ["monto"], ["region"], "Promedio por región"),
    ]),
    ("Resumen", [
        _op("sum", ["monto"], description="Total"),
        _op("compare_groups", ["monto"], ["producto"], "Por producto"),
    ]),
]


@pytest.fixture(scope="module")
def big():
    result = run_plans(big_csv(), BIG_PLANS, BIG_COLUMNS)
    return result, full_context(result)


def test_large_results_are_summarized_within_the_budget_without_losing_any_operation(big):
    result, full = big
    assert sum(1 for p in result["results"] for o in p["operations"] if o["status"] == "ok") == 10
    compact = compact_context(full, SETTINGS)
    tokens, _ = estimate_interpretation(compact, SETTINGS)
    assert tokens <= SETTINGS.ai_max_input_tokens
    sent = compact_ops(compact)
    # Ninguna operación ni plan desaparece; lo reducido lo dice.
    assert set(sent) == {op.ref for op in full.operations}
    assert [p.ref for p in compact.plans] == ["P1", "P2", "P3"]
    # Las operaciones idénticas del tercer plan se referencian, no se repiten.
    assert sent["P3.O1"].same_as == "P1.O4" and sent["P3.O2"].same_as == "P1.O2" and not sent["P3.O2"].rows
    assert compact.coverage.summarized + compact.coverage.facts_only > 0
    assert compact.coverage.note.startswith("Resumen parcial")
    for op in sent.values():
        assert op.rows or op.facts or op.stats or op.same_as, op.ref
        if op.detail != "full" and not op.same_as:
            assert op.omitted and op.facts  # qué falta y los hechos verificados de lo que no viaja
    # Las filas resumidas son representativas y exactas (subconjunto de las filas reales).
    real = {op.ref: {json.dumps([*r.keys, *r.values]) for r in op.rows} for op in full.operations}
    for ref, op in sent.items():
        if op.detail == "summary" and not op.repeated:
            assert {json.dumps(r) for r in op.rows} <= real[ref]


def test_figures_not_sent_are_still_verified_against_the_original_results(big):
    from app.services.report import verify_interpretation

    _, full = big
    compact = compact_context(full, SETTINGS)
    target = next(op for op in full.operations if op.operation == "compare_groups")
    row = target.rows[60]  # un grupo intermedio, que no viaja en el resumen
    claim = {"ref": target.ref, "measure": "monto", "kind": "value", "keys": [{"dimension": "producto", "value": row.keys[0]}],
             "period_from": None, "period_to": None, "value": row.values[0], "unit": "ARS"}
    reply = AIInterpretation.model_validate({
        "executive_summary": [], "trends": [], "implications": [], "recommendations": [], "hypotheses": [],
        "information_needed": [], "not_supported": [], "limitations": [], "data_quality": [],
        "findings": [{"text": f"{row.keys[0]} suma {row.values[0]:.0f} ARS.", "evidence": [target.ref], "claims": [claim]},
                     {"text": f"{row.keys[0]} suma {row.values[0] + 1:.0f} ARS.", "evidence": [target.ref],
                      "claims": [{**claim, "value": row.values[0] + 1}]}],
    })
    verified, notes = verify_interpretation(reply, compact.verification)
    assert [f["status"] for f in verified["findings"]] == ["verified"]
    assert "valor incorrecto" in " ".join(notes)


def test_if_even_the_summary_does_not_fit_plans_can_be_interpreted_in_parts(big):
    _, full = big
    tight = Settings(_env_file=None, ai_max_input_tokens=5000)
    with pytest.raises(Exception) as error:
        compact_context(full, tight)
    assert getattr(error.value, "status_code", None) == 413 and "Elegí menos planes" in error.value.detail
    part = compact_context(full, tight, plans=[1])
    assert [p.ref for p in part.plans] == ["P1"]
    assert part.coverage.plans_excluded == ["P2", "P3"] and "No se incluyeron los planes P2, P3" in part.coverage.note
    # La verificación usa solo los planes elegidos: citar otro plan se rechaza.
    assert {op.ref.split(".")[0] for op in part.verification.operations} == {"P1"}


def test_plan_selection_through_the_api_and_unknown_plans():
    client, app = make_client(ai_enabled=True, provider=FakeProvider())
    result = run_api(client, app, sales72_csv(), PLANS_17, COLUMNS)
    one = client.post("/api/ai/interpretations", json={"execution_id": result["execution_id"], "plans": [2]}, headers=ORIGIN)
    assert one.status_code == 201
    assert [p["ref"] for p in one.json()["payload"]["plans"]] == ["P2"]
    bad = client.post("/api/ai/interpretations", json={"execution_id": result["execution_id"], "plans": [9]}, headers=ORIGIN)
    assert bad.status_code == 422 and "P9" in bad.json()["detail"]


def test_nothing_individual_or_unauthorized_reaches_the_ai():
    result, summary = sales17()
    wire = json.dumps(compact_context(full_context(result, summary), SETTINGS).wire(), ensure_ascii=False)
    # Ninguna fila original del CSV (fecha completa del registro) ni nombres de archivo.
    assert "2025-01-03" not in wire and "ventas.csv" not in wire
    assert "monto_ars" in wire  # solo nombres de columnas autorizadas y resultados agregados
