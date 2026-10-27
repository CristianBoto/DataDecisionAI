"""Motor generalista: seis datasets sintéticos de temáticas y estructuras distintas.

Cada prueba recorre el mismo camino que la aplicación, sin reglas por dataset:
1. perfilado real (`profile_dataset`): tipos, unidades, aditividad, dependencias y marcadores sugeridos;
2. decisiones por defecto = aceptar las sugerencias (lo que hace la revisión si nadie corrige);
3. motor Pandas (`execute_analysis`) con planes como los que propondría la IA;
4. comparación con valores calculados a mano.
Sin red ni IA: los planes se escriben en la prueba.
"""

import pytest

from app.schemas.ai_context import AIContext
from app.schemas.ai_plan import AIAssistantReply, AIPlan, prune_reply
from app.schemas.analysis import ExecutionRequest
from app.services.analysis_engine import execute_analysis
from app.services.dataset_profiler import profile_dataset


def profile(csv: str, name: str = "datos.csv") -> dict:
    return profile_dataset(csv.encode("utf-8"), name)


def by_name(prof: dict) -> dict:
    return {c["name"]: c for c in prof["columns"]}


def mappings(prof: dict, **overrides) -> list[dict]:
    """Decisiones de la revisión que acepta todas las sugerencias (con correcciones puntuales)."""
    result = []
    for c in prof["columns"]:
        mapping = {
            "name": c["name"], "original": c["name"], "semantic_type": c["semantic_type"],
            "unit": c["unit_suggestion"], "additivity": c["additivity_suggestion"],
            "split_by": c["split_by_suggestion"],
        }
        mapping.update(overrides.get(c["name"], {}))
        result.append(mapping)
    return result


def run(csv: str, operations: list[dict], columns: list[dict], name: str = "datos.csv") -> list[dict]:
    plans = [(f"p{i}", AIPlan.model_validate({
        "source_alias": "A", "title": f"Plan {i}", "rationale": "r", "columns_needed": [],
        "operations": [operation], "charts": [], "limitations": [],
    })) for i, operation in enumerate(operations)]
    request = ExecutionRequest.model_validate({"plan_ids": [p for p, _ in plans], "sources": [{"alias": "A", "columns": columns}]})
    response = execute_analysis(request, plans, {"A": (csv.encode("utf-8"), name)})
    return [r["operations"][0] for r in response["results"]]


def op(operation, columns, group_by=()):
    return {"operation": operation, "columns": list(columns), "group_by": list(group_by), "description": operation}


def rows(result: dict) -> dict:
    return {tuple(r["keys"]): r["values"] for r in result["rows"]}


# --- 1. Ventas: fechas diarias, categorías y montos con símbolo de moneda ---------------------

SALES = "fecha;rubro;monto\n" + "".join(
    f"2025-{m:02d}-{d:02d};{rubro};$ {monto}\n"
    for m in (1, 2, 3)
    for d, rubro, monto in ((3, "Alimentos", "1.200,50"), (17, "Alimentos", "800"), (9, "Limpieza", "450,25"))
)


def test_sales_with_currency_daily_dates_and_categories():
    prof = profile(SALES)
    cols = by_name(prof)
    assert cols["monto"]["semantic_type"] == "quantitative" and cols["monto"]["unit_suggestion"] == "$"
    assert cols["monto"]["additivity_suggestion"] == "additive"
    assert cols["fecha"]["semantic_type"] == "temporal" and cols["rubro"]["semantic_type"] == "categorical"

    total, monthly, by_rubro = run(SALES, [
        op("sum", ["monto"]), op("time_series", ["fecha", "monto"]), op("group_by", ["monto"], ["rubro"]),
    ], mappings(prof))
    assert rows(total) == {(): [3 * (1200.50 + 800 + 450.25)]}
    assert total["measures"][0]["unit"] == "$"
    # Datos diarios: se resumen por mes, en orden cronológico.
    assert monthly["period"] == "month" and monthly["temporal_dimension"] == "fecha"
    assert rows(monthly) == {("2025-01",): [2450.75], ("2025-02",): [2450.75], ("2025-03",): [2450.75]}
    assert rows(by_rubro) == {("Alimentos",): [6001.5], ("Limpieza",): [1350.75]}


# --- 2. Indicadores económicos en formato largo con unidades distintas ---------------------

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


def test_long_format_indicators_are_never_mixed():
    prof = profile(ECONOMY)
    cols = by_name(prof)
    # El perfil detecta la estructura: «dato» depende de «serie» y «unidad»; los años son anuales.
    assert set(cols["dato"]["split_by_suggestion"]) == {"serie", "unidad"}
    assert cols["periodo"]["semantic_type"] == "temporal"

    total, by_year, by_zone = run(ECONOMY, [
        op("sum", ["dato"]),
        op("time_series", ["periodo", "dato"]),
        op("group_by", ["dato"], ["zona"]),
    ], mappings(prof))

    # Nunca un único total que mezcle USD, % y personas: una fila por indicador.
    assert total["split_dimensions"] == ["serie", "unidad"]
    assert rows(total) == {
        ("desocupacion", "%"): [7.5],  # porcentaje: promedio de 7, 8, 7 y 8 (nunca 30)
        ("habitantes", "personas"): [2 * (500000 + 1000000)],
        ("ventas externas", "millones USD"): [100 + 200 + 110 + 210],
    }
    # Serie anual (no "2022-01"): suma regional de los indicadores aditivos y PROMEDIO del porcentaje.
    assert by_year["period"] == "year"
    assert rows(by_year)[("2022", "ventas externas", "millones USD")] == [300.0]
    assert rows(by_year)[("2023", "ventas externas", "millones USD")] == [320.0]
    assert rows(by_year)[("2022", "desocupacion", "%")] == [7.5]  # (7 + 8) / 2, no 15
    assert any("promedio y no la suma" in w for w in by_year["warnings"])
    # La unidad no se aplica globalmente: la indica cada categoría.
    assert by_year["measures"][0]["unit"] is None
    assert rows(by_zone)[("Este", "habitantes", "personas")] == [1000000.0]


def test_explicit_sum_of_a_percentage_column_is_rejected():
    csv = "anio,region,tasa_actividad (%)\n2023,Norte,45.2\n2023,Sur,47.8\n2024,Norte,46.0\n2024,Sur,48.0\n"
    prof = profile(csv)
    col = by_name(prof)["tasa_actividad (%)"]
    assert col["unit_suggestion"] == "%" and col["additivity_suggestion"] == "non_additive"
    total, average, series = run(csv, [
        op("sum", ["tasa_actividad (%)"]), op("mean", ["tasa_actividad (%)"]),
        op("time_series", ["anio", "tasa_actividad (%)"]),
    ], mappings(prof))
    assert total["status"] == "error" and "no es aditiva" in total["error"]
    assert rows(average) == {(): [46.75]}
    # La evolución promedia las regiones de cada año en lugar de sumarlas.
    assert rows(series) == {("2023",): [46.5], ("2024",): [47.0]}
    assert series["measures"][0]["aggregate"] == "mean"


# --- 3. Educación: matrícula por nivel y trimestre ----------------------------------------------

EDUCATION = "trimestre,nivel,matricula,tasa_promocion\n" + "".join(
    f"{year}-Q{q},{nivel},{base + q * 10},{0.80 + q / 100}\n"
    for year in (2023, 2024) for q in (1, 2, 3, 4) for nivel, base in (("Inicial", 1000), ("Primario", 3000))
)


def test_education_quarters_and_non_additive_rates():
    prof = profile(EDUCATION)
    cols = by_name(prof)
    assert cols["trimestre"]["semantic_type"] == "temporal"
    assert cols["tasa_promocion"]["additivity_suggestion"] == "non_additive"  # proporción entre 0 y 1
    enrolment, rate = run(EDUCATION, [
        op("time_series", ["trimestre", "matricula"], ["nivel"]),
        op("time_series", ["trimestre", "tasa_promocion"]),
    ], mappings(prof))
    assert enrolment["period"] == "quarter"
    assert rows(enrolment)[("2023-T1", "Inicial")] == [1010.0]
    assert rows(enrolment)[("2024-T4", "Primario")] == [3040.0]
    # Una fila por nivel y trimestre: se informa el valor tal cual (sin agregar).
    assert enrolment["measures"][0]["aggregate"] == "value"
    assert rows(rate)[("2023-T2",)] == [pytest.approx(0.82)]  # promedio de los dos niveles, no 1,64


# --- 4. Faltantes, marcadores personalizados y tipos ambiguos ----------------------------------

MISSING = "legajo;edad;ingreso;observacion\n" + "".join(
    f"{i:05d};{-99 if i % 4 == 0 else 20 + i};{'' if i % 5 == 0 else ('NA' if i % 7 == 0 else 1000 + i)};{'ok' if i % 2 else 'revisar'}\n"
    for i in range(1, 29)
)


def test_missing_values_sentinels_and_ambiguity():
    prof = profile(MISSING)
    cols = by_name(prof)
    assert cols["legajo"]["semantic_type"] == "identifier"  # ceros a la izquierda: código
    assert cols["edad"]["missing_value_suggestions"] == ["-99"]
    assert cols["ingreso"]["suspected_missing"] > 0  # "NA" sin decidir

    pending, decided = run(MISSING, [op("mean", ["edad"]), op("mean", ["ingreso"])],
                           mappings(prof, ingreso={"missing_markers": "pending"}))
    # Sin decidir, -99 cuenta como una edad: el promedio queda sesgado (y la persona lo ve en la revisión).
    with_sentinel = [(-99 if i % 4 == 0 else 20 + i) for i in range(1, 29)]
    assert rows(pending)[()][0] == pytest.approx(sum(with_sentinel) / 28, rel=1e-6)
    assert any("no numéricos" in w and "sin decidir" in w for w in decided["warnings"])

    fixed, treated = run(MISSING, [op("mean", ["edad"]), op("mean", ["ingreso"])], mappings(
        prof, edad={"missing_values": ["-99"]}, ingreso={"missing_markers": "treat_as_missing"},
    ))
    ages = [20 + i for i in range(1, 29) if i % 4]
    assert rows(fixed)[()][0] == pytest.approx(sum(ages) / len(ages), rel=1e-6)
    incomes = [1000 + i for i in range(1, 29) if i % 5 and i % 7]
    assert rows(treated)[()][0] == pytest.approx(sum(incomes) / len(incomes), rel=1e-6)
    assert treated["warnings"] == []
    assert fixed["rows_used"] == len(ages)


def test_ambiguous_numeric_codes_are_flagged_for_review():
    csv = "codigo_postal,poblacion\n" + "".join(f"{1000 + i * 7},{100 + i}\n" for i in range(30))
    cols = by_name(profile(csv))
    assert cols["codigo_postal"]["semantic_type"] == "identifier"
    assert cols["poblacion"]["semantic_type"] in ("quantitative", "identifier")
    # Una columna mixta (números y textos) no se trata como cantidad.
    mixed = by_name(profile("valor\n" + "".join(f"{i}\n" if i % 2 else "pendiente\n" for i in range(30))))
    assert mixed["valor"]["semantic_type"] == "text" and mixed["valor"]["semantic_confidence"] == "low"


# --- 5. Clasificación: etiquetas reales y probabilidades (ROC) -----------------------------------

CLASSIFIER = "resultado,probabilidad\nsi,0.9\nno,0.3\nsi,0.6\nno,0.7\nsi,0.8\nno,0.1\n"


def test_roc_with_labels_and_probabilities():
    prof = profile(CLASSIFIER)
    cols = by_name(prof)
    assert cols["probabilidad"]["additivity_suggestion"] == "non_additive"
    (roc,) = run(CLASSIFIER, [op("roc_curve", ["resultado", "probabilidad"])],
                 mappings(prof, resultado={"positive_label": "si"}))
    # 9 pares positivo-negativo: 8 bien ordenados (0,6 < 0,7 es el único error) → AUC = 8/9.
    assert roc["status"] == "ok" and roc["stats"]["auc"] == pytest.approx(8 / 9, abs=1e-6)


# --- 6. Fechas y agrupaciones multidimensionales ------------------------------------------------

MULTI = "mes,region,canal,unidades\n" + "".join(
    f"{mes},{region},{canal},{u}\n"
    for mes in ("ene-2024", "feb-2024", "mar-2024")
    for region, r in (("Norte", 1), ("Sur", 2), ("Centro", 3))
    for canal, c in (("Online", 10), ("Local", 20))
    for u in (r * c,)
)


def test_multidimensional_groupings_with_month_names():
    prof = profile(MULTI)
    assert by_name(prof)["mes"]["semantic_type"] == "temporal"
    cube, series, freq = run(MULTI, [
        op("sum", ["unidades"], ["mes", "region", "canal"]),
        op("time_series", ["mes", "unidades"], ["canal"]),
        op("frequency", ["region", "canal"]),
    ], mappings(prof))
    assert cube["dimensions"] == ["mes", "region", "canal"] and len(cube["rows"]) == 18
    assert cube["temporal_dimension"] == "mes" and cube["period"] == "month"
    assert rows(cube)[("2024-02", "Sur", "Local")] == [40.0]
    assert rows(series)[("2024-01", "Online")] == [10.0 + 20 + 30]
    assert rows(series)[("2024-03", "Local")] == [20.0 + 40 + 60]
    assert rows(freq)[("Norte", "Online")] == [3.0]


# --- Pedidos incompatibles: mismas reglas en la validación de la IA y en el motor ----------------

def test_incompatible_requests_are_rejected_with_reasons():
    prof = profile(ECONOMY)
    columns = mappings(prof)
    results = run(ECONOMY, [
        op("histogram", ["dato"]),                    # mezclaría indicadores
        op("time_series", ["dato"], ["zona"]),        # sin columna temporal
    ], columns)
    assert [r["status"] for r in results] == ["error", "error"]
    assert "mezclaría magnitudes" in results[0]["error"]
    assert "columna temporal" in results[1]["error"]
    # Agrupar por una cantidad con muchos valores distintos no resume nada (para eso, un histograma).
    continuous = "monto,rubro\n" + "".join(f"{100 + i * 3.5},R{i % 3}\n" for i in range(60))
    (grouped,) = run(continuous, [op("count", [], ["monto"])], mappings(profile(continuous)))
    assert grouped["status"] == "error" and "histograma" in grouped["error"]


def test_ai_plans_are_pruned_with_the_same_rules():
    context = AIContext.model_validate({"objective": "Ver la producción", "sources": [{"alias": "A", "columns": [
        {"name": "periodo", "format": "date", "semantic_type": "temporal"},
        {"name": "serie", "format": "text", "semantic_type": "categorical", "distinct_values": "3-10"},
        {"name": "dato", "format": "numeric", "semantic_type": "quantitative", "split_by": ["serie"]},
        {"name": "tasa", "format": "numeric", "semantic_type": "quantitative", "additivity": "non_additive", "unit": "%"},
    ]}]})
    reply = AIAssistantReply.model_validate({
        "message": "m", "interpreted_objective": "o", "source_relationship": "single", "questions": [], "warnings": [],
        "plans": [{"source_alias": "A", "title": "Producción", "rationale": "r", "columns_needed": ["periodo", "dato"],
                   "charts": [], "limitations": [], "operations": [
                       op("time_series", ["periodo", "dato"], ["serie"]) | {"description": "evolución"},
                       op("histogram", ["dato"]) | {"description": "distribución"},
                       op("sum", ["tasa"]) | {"description": "total de la tasa"},
                   ]}],
    })
    pruned, notes = prune_reply(reply, context)
    assert [o.operation for o in pruned.plans[0].operations] == ["time_series"]
    assert len(notes) == 2 and any("mezclaría" in n for n in notes) and any("no es aditiva" in n for n in notes)
    assert all(n in pruned.plans[0].limitations for n in notes)  # la persona ve qué se descartó y por qué


def test_split_columns_must_be_shared_columns():
    with pytest.raises(ValueError):
        AIContext.model_validate({"objective": "x" * 5, "sources": [{"alias": "A", "columns": [
            {"name": "dato", "format": "numeric", "semantic_type": "quantitative", "split_by": ["oculta"]},
        ]}]})


# --- Servidor de prueba con IA simulada (scripts/simulated_ai_server.py) -------------------

def _load_simulated_server():
    import importlib.util
    from pathlib import Path

    path = Path(__file__).resolve().parents[1] / "scripts" / "simulated_ai_server.py"
    spec = importlib.util.spec_from_file_location("simulated_ai_server", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_simulated_ai_server_follows_the_same_rules_and_refuses_production(monkeypatch):
    module = _load_simulated_server()
    context = AIContext.model_validate({"objective": "Evolución por zona", "sources": [{"alias": "A", "columns": [
        {"name": "periodo", "format": "date", "semantic_type": "temporal"},
        {"name": "zona", "format": "text", "semantic_type": "categorical", "distinct_values": "3-10"},
        {"name": "serie", "format": "text", "semantic_type": "categorical", "distinct_values": "3-10"},
        {"name": "dato", "format": "numeric", "semantic_type": "quantitative", "split_by": ["serie"]},
    ]}]})
    result = module.SimulatedProvider().send(context, None)
    pruned, notes = prune_reply(result.reply, context)
    assert [o.operation for o in pruned.plans[0].operations] == ["time_series", "sum"]
    assert any("histogram" in n for n in notes)  # la distribución mezclaría indicadores: se descarta

    monkeypatch.setenv("ENVIRONMENT", "production")
    with pytest.raises(SystemExit):
        _load_simulated_server()
