"""Fase 4C: informe interpretativo.

- Resumen descriptivo determinístico (sin IA) sobre los resultados reales de Pandas.
- Interpretación con IA: contexto agregado armado por el backend, autorización de uso
  único, presupuesto y verificación de la respuesta (cifras, causalidad, operaciones citadas).
- Aislamiento: los resultados y las solicitudes de un visitante no existen para otro.
Siempre con el proveedor falso: ninguna prueba usa la red ni consume créditos.
"""

import json

from app.schemas.ai_plan import AIPlan
from app.schemas.interpretation import AIInterpretation, InterpretationContext
from app.services.dataset_profiler import profile_dataset
from app.services.report import _verified, allowed_numbers, fmt, verify_interpretation
from tests.ai_helpers import ORIGIN, FakeProvider, login, make_client, no_network  # noqa: F401 - no_network se activa en todo el módulo

# Mismo dataset sintético de ventas que genera el frontend (lib/sampleDatasets.ts): 72 filas, total 69.060.
RUBROS = (("Alimentos", 1200), ("Limpieza", 450), ("Bebidas", 800))
SALES = "fecha;rubro;canal;monto_ars\n" + "".join(
    f"2025-{m:02d}-{day:02d};{rubro};{'Online' if (day + i) % 2 == 0 else 'Local'};{base + m * 25 + day * 3 + i * 10}\n"
    for m in range(1, 7)
    for day in (3, 11, 19, 27)
    for i, (rubro, base) in enumerate(RUBROS)
)

ECONOMY = "periodo,zona,serie,unidad,dato\n" + "".join(
    f"{year}-01-01,{zona},{serie},{unidad},{value}\n"
    for year in (2022, 2023)
    for zona, factor in (("Este", 1), ("Oeste", 2))
    for serie, unidad, value in (
        ("ventas externas", "millones USD", 100 * factor + (year - 2022) * 10),
        ("desocupacion", "%", 6.0 + factor),
        ("habitantes", "personas", 500000 * factor),
    )
)

CLASSIFIER = "resultado,probabilidad,edad\nsi,0.9,40\nno,0.3,22\nsi,0.6,51\nno,0.7,33\nsi,0.8,47\nno,0.1,29\n"


def op(operation, columns, group_by=(), description="—"):
    return {"operation": operation, "columns": list(columns), "group_by": list(group_by), "description": description}


def mappings(csv: str, **overrides) -> list[dict]:
    """Decisiones de la revisión que aceptan las sugerencias del perfil (con correcciones puntuales)."""
    prof = profile_dataset(csv.encode("utf-8"), "datos.csv")
    result = []
    for c in prof["columns"]:
        mapping = {
            "name": c["name"], "original": c["name"], "semantic_type": c["semantic_type"],
            "unit": c["unit_suggestion"], "additivity": c["additivity_suggestion"], "split_by": c["split_by_suggestion"],
        }
        mapping.update(overrides.get(c["name"], {}))
        result.append(mapping)
    return result


def run(client, app, csv, operations, columns, *, objective="Quiero ver la evolución de las ventas por rubro"):
    plan = AIPlan.model_validate({
        "source_alias": "A", "title": "Plan de prueba", "rationale": "r", "columns_needed": [],
        "operations": operations, "charts": [], "limitations": ["Datos sintéticos."],
    })
    plan_id = app.state.ai_plans.save(plan, app.state.test_user_id)
    app.state.ai_plans.approve(plan_id, app.state.test_user_id)
    body = {"plan_ids": [plan_id], "sources": [{"alias": "A", "columns": columns}], "objective": objective}
    response = client.post(
        "/api/analysis/execute", data={"request": json.dumps(body)},
        files={"file_A": ("datos.csv", csv.encode("utf-8"), "text/csv")}, headers=ORIGIN,
    )
    assert response.status_code == 200, response.text
    return response.json()


def facts(result, ref):
    return next(i for i in result["summary"]["items"] if i["ref"] == ref)


def prepare(client, execution_id):
    return client.post("/api/ai/interpretations", json={"execution_id": execution_id}, headers=ORIGIN)


def authorize(client, prepared):
    return client.post(
        f"/api/ai/interpretations/{prepared['request_id']}/authorize",
        json={"payload_sha256": prepared["payload_sha256"], "confirm": True}, headers=ORIGIN,
    )


SALES_OPS = [
    op("sum", ["monto_ars"], description="Total vendido"),
    op("time_series", ["fecha", "monto_ars"], ["rubro"], description="Evolución por rubro"),
    op("compare_groups", ["monto_ars"], ["canal"], description="Comparación por canal"),
    op("histogram", ["monto_ars"], description="Distribución"),
]


def sales_columns():
    return mappings(SALES, monto_ars={"unit": "ARS"})


# --- Resumen descriptivo (sin IA) -------------------------------------------------------

def test_sales_summary_is_exact_and_needs_no_ai():
    client, app = make_client()  # IA deshabilitada: el resumen igual se genera
    result = run(client, app, SALES, SALES_OPS, sales_columns())
    summary = result["summary"]

    assert result["execution_id"] and summary["generated_by"] == "pandas" and summary["status"] == "complete"
    assert facts(result, "P1.O1")["facts"] == ["Suma de monto_ars: 69.060 ARS."]
    evolution = " ".join(facts(result, "P1.O2")["facts"])
    # Alimentos: 5.080 en enero y 5.580 en junio (+500, +9,8 %), calculado sobre la tabla del motor.
    assert "pasó de 5.080 ARS en 2025-01 a 5.580 ARS en 2025-06" in evolution and "+500 ARS (+9,8 %)" in evolution
    assert "rubro = Alimentos" in evolution and "rubro = Limpieza" in evolution
    by_channel = facts(result, "P1.O3")["facts"][0]
    assert by_channel.startswith("Suma de monto_ars en 2 grupos. Mayor: canal = ") and "% del total" in by_channel
    assert "72 valores de monto_ars distribuidos en" in facts(result, "P1.O4")["facts"][0]
    assert "sin intervención de la IA" in summary["notes"][0]
    # Resumen ejecutivo descriptivo: un hecho por operación calculada, sin IA.
    assert summary["executive"][0] == "Se calcularon 4 de 4 operaciones con Pandas."
    assert "Suma de monto_ars: 69.060 ARS." in summary["executive"]


def test_long_format_indicators_are_summarized_separately():
    client, app = make_client()
    result = run(client, app, ECONOMY, [op("sum", ["dato"]), op("time_series", ["periodo", "dato"])], mappings(ECONOMY),
                 objective="Comparar los indicadores económicos por año")
    total = facts(result, "P1.O1")["facts"]
    # Una cifra por indicador y unidad: nunca un total que mezcle USD, % y personas.
    assert len(total) == 3
    assert any("serie = desocupacion, unidad = %" in f and "7,5" in f for f in total)
    assert any("serie = habitantes, unidad = personas" in f and "3.000.000" in f for f in total)
    assert any("serie = ventas externas, unidad = millones USD" in f and "620" in f for f in total)
    series = " ".join(facts(result, "P1.O2")["facts"])
    assert "pasó de 300 en 2022 a 320 en 2023" in series  # ventas externas, sin mezclar con otros indicadores


def test_failed_operations_are_flagged_and_produce_no_conclusions():
    client, app = make_client()
    columns = sales_columns()
    result = run(client, app, SALES, [op("sum", ["monto_ars"]), op("sum", ["rubro"]), op("count", [], ["rubro"])], columns)
    failed = facts(result, "P1.O2")
    assert failed["status"] == "error" and failed["facts"] == [] and failed["error"]
    assert result["summary"]["status"] == "partial"
    assert any("1 de 3 operaciones no se pudieron calcular" in n for n in result["summary"]["notes"])


def test_number_formatting():
    assert fmt(69060) == "69.060" and fmt(9.8412, 1) == "9,8" and fmt(0.888889, 3) == "0,889" and fmt(-0.0) == "0"


# --- Interpretación con IA (proveedor falso) ----------------------------------------------

def claim(ref, measure, kind="value", keys=None, value=0.0, unit=None, period_from=None, period_to=None) -> dict:
    return {
        "ref": ref, "measure": measure, "kind": kind,
        "keys": [{"dimension": d, "value": v} for d, v in (keys or {}).items()],
        "period_from": period_from, "period_to": period_to, "value": value, "unit": unit,
    }


def item(text, *claims, evidence=None) -> dict:
    return {"text": text, "evidence": evidence if evidence is not None else list(dict.fromkeys(c["ref"] for c in claims)),
            "claims": list(claims)}


TOTAL = claim("P1.O1", "monto_ars", value=69060, unit="ARS")
ALIMENTOS_CHANGE = claim("P1.O2", "monto_ars", "change", {"rubro": "Alimentos"}, 500, "ARS", "2025-01", "2025-06")


def interpretation(**overrides) -> dict:
    data = {
        "executive_summary": [item("Las ventas totales suman 69.060 ARS.", TOTAL)],
        "findings": [
            item("Alimentos creció 500 ARS entre 2025-01 y 2025-06.", ALIMENTOS_CHANGE),
            item("El canal Online vende 45.000 ARS.", claim("P1.O3", "monto_ars", keys={"canal": "Online"}, value=45000, unit="ARS")),
            item("El aumento de precios provoca la suba de Alimentos.", evidence=["P1.O2"]),
            item("Las cantidades por rubro son estables.", evidence=["P1.O9"]),
            item("Alimentos es el rubro de mayor venta en todos los meses.", evidence=["P1.O2"]),
        ],
        "trends": [item("Los tres rubros muestran una evolución creciente.", evidence=["P1.O2"])],
        "recommendations": [item("Comparar el canal de venta dentro de cada rubro.", evidence=["P1.O3", "P1.O2"])],
        "limitations": ["Los datos son sintéticos y abarcan 6 meses."],
        "data_quality": ["No se informaron valores faltantes."],
    }
    data.update(overrides)
    return data


def test_interpretation_requires_review_authorization_and_is_verified():
    provider = FakeProvider(interpretation=interpretation())
    client, app = make_client(ai_enabled=True, provider=provider)
    result = run(client, app, SALES, SALES_OPS, sales_columns())

    prepared = prepare(client, result["execution_id"]).json()
    # Preparar no envía nada: se muestra el contenido exacto y su costo máximo estimado.
    assert provider.interpreted == []
    assert prepared["payload"]["objective"] == "Quiero ver la evolución de las ventas por rubro"
    assert prepared["estimated_max_cost_usd"] > 0 and prepared["estimated_input_tokens"] > 0
    assert [o["ref"] for o in prepared["payload"]["operations"]] == ["P1.O1", "P1.O2", "P1.O3", "P1.O4"]

    response = authorize(client, prepared)
    assert response.status_code == 200, response.text
    body = response.json()
    # La IA recibió exactamente lo que se mostró.
    assert provider.interpreted == [prepared["payload"]]
    verified = body["interpretation"]
    assert [(i["text"], i["status"]) for i in verified["executive_summary"]] == [("Las ventas totales suman 69.060 ARS.", "verified")]
    assert [(i["text"], i["status"]) for i in verified["findings"]] == [
        ("Alimentos creció 500 ARS entre 2025-01 y 2025-06.", "verified"),
        ("Alimentos es el rubro de mayor venta en todos los meses.", "unverified"),
    ]
    # El claim verificado lleva el valor recalculado por el backend.
    assert verified["findings"][0]["claims"][0] | {"value": 500.0} == verified["findings"][0]["claims"][0]
    notes = " ".join(body["notes"])
    assert "Se descartaron 3 afirmaciones" in notes
    assert "valor incorrecto en P1.O3: el resultado es 14.220 ARS" in notes
    assert "atribuye causas" in notes and "no se apoya en ninguna operación calculada" in notes
    assert "se muestran como no verificadas" in notes
    # Consumo registrado en el presupuesto del visitante.
    assert body["usage"]["cost_usd"] > 0
    assert client.get("/api/ai/status").json()["requests_used"] == 1
    # Uso único: la misma autorización no sirve dos veces.
    assert authorize(client, prepared).status_code == 404


def test_rows_of_scatter_and_roc_never_reach_the_ai():
    auc = item("El AUC es 0,889.", claim("P1.O1", "auc", "statistic", value=0.889))
    provider = FakeProvider(interpretation=interpretation(executive_summary=[auc], findings=[auc], trends=[], recommendations=[]))
    client, app = make_client(ai_enabled=True, provider=provider)
    columns = mappings(CLASSIFIER, resultado={"positive_label": "si"})
    result = run(client, app, CLASSIFIER, [op("roc_curve", ["resultado", "probabilidad"]), op("scatter", ["edad", "probabilidad"])],
                 columns, objective="Evaluar el clasificador")
    assert any(r["operations"][0]["rows"] for r in result["results"])  # el navegador sí recibe los puntos
    prepared = prepare(client, result["execution_id"]).json()
    for operation in prepared["payload"]["operations"]:
        assert operation["rows"] == [] and operation["stats"]
    assert "positive_label" not in json.dumps(prepared["payload"])  # la clase positiva es un valor del dataset
    assert "AUC: 0,889" in facts(result, "P1.O1")["facts"][0]
    assert "no implica causalidad" in facts(result, "P1.O2")["facts"][0]
    finding = authorize(client, prepared).json()["interpretation"]["findings"][0]
    assert finding["status"] == "verified" and finding["claims"][0]["value"] == 0.888889


def test_failed_operations_cannot_back_a_conclusion():
    provider = FakeProvider(interpretation=interpretation(
        executive_summary=[item("Hay 72 registros.", evidence=["P1.O1"])],  # cifra sin declarar
        findings=[item("El rubro suma mucho.", evidence=["P1.O2"]), item("Hay tres rubros.", evidence=["P1.O3"]),
                  item("Suma 69.060 ARS.", claim("P1.O2", "rubro", value=69060, unit="ARS"))],
        trends=[], recommendations=[],
    ))
    client, app = make_client(ai_enabled=True, provider=provider)
    result = run(client, app, SALES, [op("sum", ["monto_ars"]), op("sum", ["rubro"]), op("count", [], ["rubro"])], sales_columns())
    body = authorize(client, prepare(client, result["execution_id"]).json()).json()
    assert [f["text"] for f in body["interpretation"]["findings"]] == ["Hay tres rubros."]
    assert body["interpretation"]["executive_summary"] == []
    notes = " ".join(body["notes"])
    assert "cita P1.O2, que no se pudo calcular" in notes or "no se apoya en ninguna operación calculada" in notes
    assert "escribe cifras sin declararlas" in notes
    assert "P1.O2" in notes and "no se interpretan" in notes


def test_ai_disabled_sends_nothing_but_the_summary_is_available():
    provider = FakeProvider(interpretation=interpretation())
    client, app = make_client(ai_enabled=False, provider=provider)
    result = run(client, app, SALES, SALES_OPS, sales_columns())
    assert result["summary"]["items"] and result["summary"]["executive"]
    prepared = prepare(client, result["execution_id"]).json()
    assert prepared["ai_enabled"] is False
    assert authorize(client, prepared).status_code == 403
    assert provider.interpreted == []


def test_changed_content_or_reply_without_support_is_rejected():
    provider = FakeProvider(interpretation=interpretation(
        executive_summary=[item("Las ventas suman 99.999 ARS.", claim("P1.O1", "monto_ars", value=99999, unit="ARS"))],
        findings=[item("Algo.", evidence=["P1.O7"])],
    ))
    client, app = make_client(ai_enabled=True, provider=provider)
    result = run(client, app, SALES, SALES_OPS, sales_columns())
    prepared = prepare(client, result["execution_id"]).json()
    tampered = client.post(
        f"/api/ai/interpretations/{prepared['request_id']}/authorize",
        json={"payload_sha256": "0" * 64, "confirm": True}, headers=ORIGIN,
    )
    assert tampered.status_code == 409 and provider.interpreted == []
    rejected = authorize(client, prepare(client, result["execution_id"]).json())
    assert rejected.status_code == 502 and "no superó la verificación" in rejected.json()["detail"]


def test_results_and_requests_are_isolated_between_visitors():
    provider = FakeProvider(interpretation=interpretation())
    alice, app = make_client(ai_enabled=True, provider=provider)
    result = run(alice, app, SALES, SALES_OPS, sales_columns())
    prepared = prepare(alice, result["execution_id"]).json()

    bob_headers = {**ORIGIN, **login(app, "otro visitante")}
    assert alice.post("/api/ai/interpretations", json={"execution_id": result["execution_id"]}, headers=bob_headers).status_code == 404
    stolen = alice.post(
        f"/api/ai/interpretations/{prepared['request_id']}/authorize",
        json={"payload_sha256": prepared["payload_sha256"], "confirm": True}, headers=bob_headers,
    )
    assert stolen.status_code == 404 and provider.interpreted == []
    # Una solicitud de interpretación tampoco sirve en el endpoint de planes (almacenes separados).
    assert alice.post(
        f"/api/ai/requests/{prepared['request_id']}/authorize",
        json={"payload_sha256": prepared["payload_sha256"], "confirm": True}, headers=ORIGIN,
    ).status_code == 404
    # Sin sesión no hay acceso.
    anonymous = alice.post("/api/ai/interpretations", json={"execution_id": result["execution_id"]},
                           headers={**ORIGIN, "Authorization": ""})
    assert anonymous.status_code == 401
    # El PDF se arma solo con lo que recibe cada sesión: Bob no obtiene resultados ni interpretaciones de Alice.
    bob_interpretation = alice.post(
        f"/api/ai/interpretations/{prepared['request_id']}/authorize",
        json={"payload_sha256": prepared["payload_sha256"], "confirm": True}, headers=bob_headers,
    )
    assert bob_interpretation.status_code == 404 and "69.060" not in bob_interpretation.text


# --- Verificación determinística de las afirmaciones ------------------------------------

def sales_context() -> InterpretationContext:
    client, app = make_client()
    result = run(client, app, SALES, SALES_OPS, sales_columns())
    return InterpretationContext.model_validate(prepare(client, result["execution_id"]).json()["payload"])


def verify(context, *findings):
    reply = AIInterpretation.model_validate(interpretation(
        executive_summary=[], findings=list(findings), trends=[], recommendations=[], limitations=[], data_quality=[],
    ))
    verified, notes = verify_interpretation(reply, context)
    return verified["findings"], " ".join(notes)


def statuses(findings):
    return [f["status"] for f in findings]


def test_correct_claims_are_recalculated_on_the_pandas_results():
    found, notes = verify(
        sales_context(),
        item("Las ventas suman 69.060 ARS.", TOTAL),
        item("Alimentos creció 500 ARS (+9,8 %) entre 2025-01 y 2025-06.", ALIMENTOS_CHANGE,
             claim("P1.O2", "monto_ars", "change_pct", {"rubro": "Alimentos"}, 9.8, "%", "2025-01", "2025-06")),
        item("El canal Local concentra el 79 % del total, con 54.840 ARS.",
             claim("P1.O3", "monto_ars", "share_pct", {"canal": "Local"}, 79, "%"),
             claim("P1.O3", "monto_ars", keys={"canal": "Local"}, value=54840, unit="ARS")),
    )
    assert statuses(found) == ["verified"] * 3, notes
    pct = found[1]["claims"][1]
    assert abs(pct["value"] - 500 / 5080 * 100) < 1e-9 and pct["unit"] == "%"


def test_misattributed_categories_are_rejected():
    context = sales_context()
    june = {"fecha": "2025-06", "rubro": "Alimentos"}
    found, notes = verify(
        context,
        # La cifra es de Alimentos, pero el texto la atribuye a Bebidas.
        item("Bebidas vendió 5.580 ARS en 2025-06.", claim("P1.O2", "monto_ars", keys=june, value=5580, unit="ARS")),
        # El claim dice Bebidas, pero 5.580 es el valor de Alimentos.
        item("Bebidas vendió 5.580 ARS en 2025-06.",
             claim("P1.O2", "monto_ars", keys={"fecha": "2025-06", "rubro": "Bebidas"}, value=5580, unit="ARS")),
        # Una cifra correcta junto a otra categoría que no le corresponde.
        item("Alimentos vendió 5.580 ARS en 2025-06, más que Bebidas.", claim("P1.O2", "monto_ars", keys=june, value=5580, unit="ARS")),
        # Falta el rubro: la cifra no identifica a qué serie pertenece.
        item("En 2025-06 se vendieron 5.580 ARS.", claim("P1.O2", "monto_ars", keys={"fecha": "2025-06"}, value=5580, unit="ARS")),
    )
    assert found == []
    assert "no nombra «Alimentos»" in notes
    assert "valor incorrecto en P1.O2: el resultado es 4.060 ARS" in notes
    assert "nombra «Bebidas», que no corresponde" in notes
    assert "no identifica todas sus categorías" in notes


def test_wrong_periods_are_rejected():
    found, notes = verify(
        sales_context(),
        item("Alimentos vendió 5.580 ARS en 2025-05.",
             claim("P1.O2", "monto_ars", keys={"fecha": "2025-05", "rubro": "Alimentos"}, value=5580, unit="ARS")),
        item("Alimentos creció 500 ARS entre 2025-01 y 2025-05.", ALIMENTOS_CHANGE),
        item("Alimentos creció 500 ARS entre 2025-01 y 2025-07.",
             claim("P1.O2", "monto_ars", "change", {"rubro": "Alimentos"}, 500, "ARS", "2025-01", "2025-07")),
    )
    assert found == []
    assert "el resultado es 5.480 ARS" in notes
    assert "no nombra «2025-06»" in notes
    assert "no tiene los períodos «2025-01» y «2025-07»" in notes


def test_incompatible_units_are_rejected():
    found, notes = verify(
        sales_context(),
        item("Las ventas suman 69.060 USD.", claim("P1.O1", "monto_ars", value=69060, unit="USD")),
        item("Las ventas suman 69.060 %.", TOTAL),
        item("El total es 69.060.", claim("P1.O1", "monto_ars", value=69060, unit=None)),
    )
    assert found == []
    assert "unidad incorrecta en P1.O1: corresponde ARS, no USD" in notes
    assert "la cifra «69.060 %» no corresponde" in notes
    assert "corresponde ARS, no sin unidad" in notes

    # Formato largo: la unidad la define la categoría «unidad» de cada indicador.
    client, app = make_client()
    result = run(client, app, ECONOMY, [op("sum", ["dato"])], mappings(ECONOMY))
    economy = InterpretationContext.model_validate(prepare(client, result["execution_id"]).json()["payload"])
    rate = {"serie": "desocupacion", "unidad": "%"}
    found, notes = verify(
        economy,
        item("La desocupacion es 7,5 %.", claim("P1.O1", "dato", keys=rate, value=7.5, unit="%")),
        item("La desocupacion es 7,5 personas.", claim("P1.O1", "dato", keys=rate, value=7.5, unit="personas")),
        item("La desocupacion es 7,5.", claim("P1.O1", "dato", keys={"serie": "desocupacion"}, value=7.5, unit="%")),
    )
    assert statuses(found) == ["verified"], notes
    assert "corresponde %, no personas" in notes and "no identifica todas sus categorías" in notes


def test_wrong_percentages_and_directions_are_rejected():
    pct = lambda value: claim("P1.O2", "monto_ars", "change_pct", {"rubro": "Alimentos"}, value, "%", "2025-01", "2025-06")  # noqa: E731
    found, notes = verify(
        sales_context(),
        item("Alimentos creció 12 % entre 2025-01 y 2025-06.", pct(12)),
        item("El canal Local concentra el 80 % del total.", claim("P1.O3", "monto_ars", "share_pct", {"canal": "Local"}, 80, "%")),
        item("Alimentos cayó 9,8 % entre 2025-01 y 2025-06.", pct(9.8)),
        item("Alimentos varió -9,8 % entre 2025-01 y 2025-06.", pct(-9.8)),
        item("Alimentos creció 9,8 % entre 2025-01 y 2025-06.", pct(9.8)),
    )
    assert statuses(found) == ["verified"]  # solo la última es correcta
    assert "el resultado es 9,84 %" in notes and "el resultado es 79,41 %" in notes
    assert "describe como caída una variación positiva" in notes and "signo incorrecto" in notes


def test_causal_claims_without_evidence_are_rejected():
    found, notes = verify(
        sales_context(),
        item("Alimentos creció 500 ARS entre 2025-01 y 2025-06 debido a la inflación.", ALIMENTOS_CHANGE),
        item("La publicidad provoca más ventas en Alimentos.", evidence=["P1.O2"]),
        item("Una asociación entre rubros no implica causalidad.", evidence=["P1.O2"]),
    )
    assert [f["text"] for f in found] == ["Una asociación entre rubros no implica causalidad."]
    assert found[0]["status"] == "unverified"
    assert notes.count("atribuye causas") == 2


def test_undeclared_figures_and_qualitative_statements():
    found, notes = verify(
        sales_context(),
        item("Alimentos creció 500 ARS.", evidence=["P1.O2"]),  # cifra sin claim
        item("Alimentos creció 500 ARS y Bebidas 700 ARS entre 2025-01 y 2025-06.", ALIMENTOS_CHANGE),  # 700 sin claim
        item("Alimentos es el rubro de mayor venta.", evidence=["P1.O2"]),
    )
    assert [(f["text"], f["status"]) for f in found] == [("Alimentos es el rubro de mayor venta.", "unverified")]
    assert "escribe cifras sin declararlas" in notes


def test_row_level_groupings_are_withheld_and_cannot_be_cited():
    csv = "cliente,monto\nAna,10\nBeto,20\nCeli,30\n"
    client, app = make_client()
    columns = mappings(csv, cliente={"semantic_type": "categorical"}, monto={"semantic_type": "quantitative", "unit": "ARS"})
    result = run(client, app, csv, [op("group_by", ["monto"], ["cliente"])], columns)
    assert result["results"][0]["operations"][0]["rows"]  # el navegador sí los recibe
    payload = prepare(client, result["execution_id"]).json()["payload"]
    assert payload["operations"][0]["rows"] == [] and payload["operations"][0]["rows_withheld"] is True
    assert "Ana" not in json.dumps(payload["operations"])
    found, notes = verify(InterpretationContext.model_validate(payload),
                          item("Ana compró 10 ARS.", claim("P1.O1", "monto", keys={"cliente": "Ana"}, value=10, unit="ARS")))
    assert found == [] and "no tiene resultados agregados" in notes


# --- Cifras de limitaciones y calidad de datos ---------------------------------------------

def context_with(*facts_text: str) -> InterpretationContext:
    return InterpretationContext.model_validate({
        "sources": [{"alias": "A", "rows": 72, "columns": 4}],
        "operations": [{"ref": "P1.O1", "plan_title": "t", "source_alias": "A", "operation": "sum", "description": "d",
                        "status": "ok", "measures": [{"column": "m", "aggregate": "sum", "unit": "ARS"}],
                        "rows": [{"keys": [], "values": [69060.0]}], "rows_total": 1}],
        "descriptive_summary": [{"ref": "P1.O1", "facts": list(facts_text)}],
    })


def test_numbers_in_limitations_must_come_from_the_results():
    allowed = allowed_numbers(context_with("Variación de +9,8 %.", "AUC: 0,889."))
    for ok in ("69.060", "69060", "69060,0", "9,8", "10", "0,89", "72", "3"):  # 10 = 9,8 redondeado; 3 = número chico
        assert _verified(ok, allowed), ok
    for invented in ("45.000", "9,7", "0,5", "70.000", "13,4"):
        assert not _verified(invented, allowed), invented
    reply = AIInterpretation.model_validate(interpretation(
        executive_summary=[item("Suma 69.060 ARS.", claim("P1.O1", "m", value=69060, unit="ARS"))], findings=[], trends=[],
        recommendations=[], limitations=["Hay 72 filas.", "Faltan 45.000 registros.", "La baja se debe a la crisis."],
        data_quality=[],
    ))
    verified, notes = verify_interpretation(reply, context_with())
    assert verified["limitations"] == ["Hay 72 filas."]
    assert verified["executive_summary"][0]["status"] == "verified"
    assert "cita cifras que no figuran" in " ".join(notes) and "atribuye causas" in " ".join(notes)


# --- Movimientos financieros: suma neta, modalidad de pago y contrapartes (datos ficticios) --------

FINANCE = "fecha,categoria,modalidad,contraparte,importe,cuotas\n" + "".join(
    f"2025-{1 + i % 6:02d}-{1 + i % 27:02d},{('Supermercado', 'Transporte', 'Sueldo', 'Servicios')[i % 4]},"
    f"{('Tarjeta', 'Efectivo', 'Transferencia')[i % 3]},{('Ana Ficticia', 'Comercio Ejemplo', 'Beto Inventado')[i % 3]},"
    f"{(-1200 - i, -300 - i, 250000, -8000 - i)[i % 4]},{1 + i % 3}\n"
    for i in range(48)
)


def finance_columns():
    return mappings(FINANCE, contraparte={"semantic_type": "categorical"}, importe={"unit": "ARS"})


def test_mixed_sign_measures_are_reported_as_net_balances():
    prof = profile_dataset(FINANCE.encode(), "movimientos.csv")
    signs = {c["name"]: c["value_sign"] for c in prof["columns"]}
    assert signs["importe"] == "mixed" and signs["cuotas"] == "positive" and signs["categoria"] is None

    client, app = make_client()
    result = run(client, app, FINANCE, [
        op("sum", ["importe"]), op("group_by", ["importe"], ["categoria"]), op("mean", ["importe"]), op("sum", ["cuotas"]),
    ], finance_columns(), objective="Cuánto gasté")
    total, by_category, mean, cuotas = result["results"][0]["operations"]
    assert total["signed_measures"] == ["importe"] and by_category["signed_measures"] == ["importe"]
    assert any("la suma es neta" in w and "no se pueden distinguir ingresos de egresos" in w for w in total["warnings"])
    assert mean["signed_measures"] == [] and cuotas["signed_measures"] == []  # promedio y medida solo positiva: sin aviso
    facts = " ".join(facts_ for i in result["summary"]["items"][:1] for facts_ in i["facts"])
    assert facts.startswith("Suma neta de importe:") and "no es el saldo de una cuenta" in facts
    assert "Saldo" not in facts
    payload = prepare(client, result["execution_id"]).json()["payload"]
    assert payload["operations"][0]["signed_measures"] == ["importe"]


def test_a_net_balance_cannot_be_presented_as_spending():
    client, app = make_client()
    result = run(client, app, FINANCE, [op("sum", ["importe"])], finance_columns(), objective="Cuánto gasté")
    context = InterpretationContext.model_validate(prepare(client, result["execution_id"]).json()["payload"])
    net = result["results"][0]["operations"][0]["rows"][0]["values"][0]
    written = f"{net:,.0f}".replace(",", ".")
    total = claim("P1.O1", "importe", value=net, unit="ARS")
    found, notes = verify(
        context,
        item(f"Gastaste {written} ARS en total.", total),
        item(f"El saldo de la cuenta es {written} ARS.", total),
        item(f"La suma neta de los movimientos es {written} ARS.", total),
    )
    assert [f["text"] for f in found] == [f"La suma neta de los movimientos es {written} ARS."]
    assert notes.count("presenta una suma neta") == 2
