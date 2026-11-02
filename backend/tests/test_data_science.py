"""Fase 5 — ciencia de datos con tres datasets SINTÉTICOS de estructuras distintas.

Cada resultado se compara con un valor calculado de forma independiente (a mano o con
`statistics`), no con el propio motor. Mismo camino que la aplicación: perfilado real,
decisiones por defecto de la revisión y motor Pandas con planes escritos en la prueba.
"""

import statistics

import pytest

from app.services.dataset_profiler import profile_dataset
from app.services.operation_rules import ColumnMeta, operation_problem
from app.services.report import descriptive_summary
from tests.synthetic_datasets import EDUCATION, ERRORS_CSV, RUBROS, education_csv, sales_csv, sales_rows
from tests.test_general_engine import mappings, op, profile, rows, run


def issues(prof: dict) -> dict[tuple, dict]:
    return {(i["column"], i["kind"]): i for i in prof["quality_issues"]}


# --- A · Ventas ---------------------------------------------------------------------------

SALES = sales_csv()
SALES_COLS = mappings(profile(SALES))


def test_sales_totals_crosses_and_shares_within_each_category():
    total, by_rubro, by_cross = run(SALES, [
        op("sum", ["monto_ars"]),
        op("group_by", ["monto_ars"], ["rubro"]),
        op("compare_groups", ["monto_ars"], ["rubro", "canal"]),
    ], SALES_COLS)
    # Total = Σ (1,5·base + 15·mes) = 9·(1000+500+300) + 3·315.
    assert total["rows"][0]["values"] == [17145]
    assert rows(by_rubro) == {("Alimentos",): [9315], ("Bebidas",): [4815], ("Limpieza",): [3015]}
    # Canal dentro de cada rubro: Alimentos Local = Σ(1000+10·m) = 6210 de 9315.
    cross = rows(by_cross)
    assert cross[("Alimentos", "Local")] == [6210, pytest.approx(6210 / 9315 * 100, abs=1e-4)]
    assert cross[("Alimentos", "Online")][1] == pytest.approx(3105 / 9315 * 100, abs=1e-4)
    for rubro, _ in RUBROS:
        assert cross[(rubro, "Local")][1] + cross[(rubro, "Online")][1] == pytest.approx(100)
    assert any("dentro de cada «rubro»" in w for w in by_cross["warnings"])


def test_sales_mean_median_and_standard_deviation_by_channel():
    mean, median, std = run(SALES, [
        op("mean", ["monto_ars"], ["canal"]), op("median", ["monto_ars"], ["canal"]), op("std", ["monto_ars"], ["canal"]),
    ], SALES_COLS)
    local = [m for _, _, c, m in sales_rows() if c == "Local"]
    assert rows(mean)[("Local",)] == [pytest.approx(statistics.mean(local))]
    assert rows(median)[("Local",)] == [pytest.approx(statistics.median(local))]
    assert rows(std)[("Local",)] == [pytest.approx(statistics.stdev(local), abs=1e-6)]
    assert std["measures"][0]["aggregate"] == "std"


def test_sales_variation_between_consecutive_months_by_category():
    total, by_rubro = run(SALES, [
        op("variation", ["monto_ars"], ["fecha"]), op("variation", ["monto_ars"], ["fecha", "rubro"]),
    ], SALES_COLS)
    # Total del mes m = 2700 + 45·m: +45 por mes; el primer mes no tiene variación.
    months = rows(total)
    assert months[("2025-01",)] == [2745, None, None]
    assert months[("2025-02",)] == [2790, 45, pytest.approx(45 / 2745 * 100, abs=1e-4)]
    assert [m["aggregate"] for m in total["measures"]] == ["sum", "change", "change_pct"]
    # Dentro de cada rubro: Alimentos sube 15 por mes (10 Local + 5 Online).
    assert rows(by_rubro)[("2025-03", "Alimentos")][1] == 15
    assert rows(by_rubro)[("2025-01", "Alimentos")][1] is None


def test_sales_pareto_ranking_and_the_categories_that_reach_80_percent():
    (pareto,) = run(SALES, [op("pareto", ["monto_ars"], ["rubro"])], SALES_COLS)
    assert [r["keys"][0] for r in pareto["rows"]] == ["Alimentos", "Bebidas", "Limpieza"]
    first, second, third = pareto["rows"]
    assert first["values"][1] == pytest.approx(9315 / 17145 * 100, abs=1e-4)
    assert second["values"][2] == pytest.approx((9315 + 4815) / 17145 * 100, abs=1e-4)
    assert third["values"][2] == pytest.approx(100)
    assert pareto["stats"]["groups_for_80"] == 2


def test_sales_quality_reports_a_skewed_distribution_not_errors():
    found = issues(profile(SALES))
    outliers = found[("monto_ars", "outliers")]
    assert outliers["severity"] == "baja" and "asimétrica o mezcla grupos" in outliers["impact"]
    assert not any(kind in ("missing", "duplicates", "inconsistent_categories") for _, kind in found)


def test_sales_summary_describes_the_new_operations():
    results = run(SALES, [op("pareto", ["monto_ars"], ["rubro"]), op("variation", ["monto_ars"], ["fecha"])], SALES_COLS)
    summary = descriptive_summary({"results": [{"title": "Ventas", "source_alias": "A", "operations": results}]})
    facts = [f for item in summary["items"] for f in item["facts"]]
    assert facts[0].startswith("Ranking de 3 categorías de rubro") and "2 de 3 categorías concentran el 80 %" in facts[0]
    assert "mayor variación entre períodos consecutivos" in facts[1]


# --- B · Educación -----------------------------------------------------------------------

EDU = education_csv()
EDU_PROFILE = profile(EDU)
EDU_COLS = mappings(EDU_PROFILE)


def test_education_columns_are_interpreted_by_their_values_not_their_names():
    cols = {c["name"]: c for c in EDU_PROFILE["columns"]}
    assert cols["codigo"]["semantic_type"] == "identifier"
    assert cols["matricula"]["additivity_suggestion"] == "additive"
    assert cols["tasa_aprobacion"]["additivity_suggestion"] == "non_additive"


def test_education_cost_per_student_by_level_is_a_ratio_of_totals():
    (by_level,) = run(EDU, [op("ratio", ["gastos_ars", "matricula"], ["nivel"])], EDU_COLS)
    # Primario: la escuela sin matrícula se excluye; el resto se suma antes de dividir.
    primario = [r for r in EDUCATION if r[2] == "Primario" and r[3]]
    gastos = sum(int(r[4]) for r in primario)
    alumnos = sum(int(r[3]) for r in primario)
    assert rows(by_level)[("Primario",)] == [gastos, alumnos, pytest.approx(gastos / alumnos)]
    # Secundario: la matrícula 0 entra en la suma (sus gastos también): no se divide por cero fila a fila.
    secundario = [r for r in EDUCATION if r[2] == "Secundario"]
    expected = sum(int(r[4]) for r in secundario) / sum(int(r[3]) for r in secundario)
    assert rows(by_level)[("Secundario",)][2] == pytest.approx(expected)
    assert by_level["measures"][2] == {"column": "gastos_ars por matricula", "aggregate": "ratio", "unit": None}
    assert any("Se excluyeron 1 filas sin «gastos_ars» o sin «matricula»" in w for w in by_level["warnings"])
    assert any("1 filas tienen «matricula» = 0" in w for w in by_level["warnings"])


def test_education_ratio_by_institution_is_undefined_when_enrolment_is_zero():
    (by_school,) = run(EDU, [op("ratio", ["gastos_ars", "matricula"], ["institucion"])], EDU_COLS)
    assert rows(by_school)[("Colegio Ficticio Lago",)] == [950000, 0, None]
    assert rows(by_school)[("Escuela Ficticia Norte",)][2] == pytest.approx(20000)
    assert any("el cociente no está definido" in w for w in by_school["warnings"])


def test_education_rates_are_averaged_never_summed():
    (grouped,) = run(EDU, [op("group_by", ["tasa_aprobacion"], ["nivel"])], EDU_COLS)
    superior = [float(r[5].rstrip("%")) for r in EDUCATION if r[2] == "Superior"]
    assert rows(grouped)[("Superior",)] == [pytest.approx(statistics.mean(superior))]
    assert grouped["measures"][0]["aggregate"] == "mean"


@pytest.mark.parametrize("operation,columns,group_by,reason", [
    ("sum", ["tasa_aprobacion"], ["nivel"], "no es aditiva"),
    ("ratio", ["tasa_aprobacion", "matricula"], [], "no es aditiva"),
    ("ratio", ["gastos_ars"], ["nivel"], "exactamente dos columnas"),
    ("pareto", ["tasa_aprobacion"], ["nivel"], "no es aditiva"),
    ("pareto", ["gastos_ars"], ["nivel", "institucion"], "UNA sola columna"),
    ("sum", ["codigo"], [], "código o identificador"),
    ("variation", ["gastos_ars"], ["nivel"], "columna temporal"),
])
def test_education_rejects_statistically_invalid_operations(operation, columns, group_by, reason):
    (result,) = run(EDU, [op(operation, columns, group_by)], EDU_COLS)
    assert result["status"] == "error" and reason in result["error"]


def test_rules_do_not_depend_on_column_names():
    meta = {"x": ColumnMeta("quantitative", "non_additive"), "y": ColumnMeta("quantitative", "additive"),
            "g": ColumnMeta("categorical", distinct_values="3-10")}
    assert "no es aditiva" in operation_problem("ratio", ["x", "y"], ["g"], meta)
    assert operation_problem("ratio", ["y", "y"], ["g"], meta) is None


# --- C · Datos con errores -------------------------------------------------------------------

ERR_PROFILE = profile(ERRORS_CSV)


def test_errors_are_detected_with_their_impact():
    found = issues(ERR_PROFILE)
    assert found[("fecha", "invalid_dates")]["message"] == "2 fechas o períodos no se pueden leer."
    assert ("fecha", "mixed_dates") in found
    assert ("monto", "mixed_numeric") in found
    assert found[("monto", "conversion")]["message"].startswith("1 valor no se puede")
    assert found[("monto", "outliers")]["message"].startswith("1 valor atípico")
    assert found[("monto", "missing")]["message"].startswith("1 valor vacío")
    zona = [i["message"] for i in ERR_PROFILE["quality_issues"] if i["column"] == "zona" and i["kind"] == "inconsistent_categories"]
    assert any("«Norte», «norte»" in m for m in zona) and any("«Sur», « SUR »" in m for m in zona)
    assert found[(None, "duplicates")]["message"] == "1 fila idéntica a otra."
    assert found[(None, "logical_duplicates")]["message"].startswith("1 fila igual")
    assert ERR_PROFILE["duplicate_rows"] == 1 and ERR_PROFILE["logical_duplicate_rows"] == 1
    # Nada se corrige: no hay impactos que digan que se eliminó, unificó o imputó algo.
    for issue in ERR_PROFILE["quality_issues"]:
        assert not any(word in issue["impact"] for word in ("se eliminaron", "se unificaron", "se imputaron", "se reemplazaron"))


def test_numeric_stats_ignore_markers_and_text_but_keep_the_outlier():
    monto = next(c for c in ERR_PROFILE["columns"] if c["name"] == "monto")
    values = [120, 120, 130, 125, 125, 140, 135, 128, 132, 99999, 127, 131, 126]
    assert monto["stats"]["count"] == len(values)
    assert monto["stats"]["mean"] == pytest.approx(statistics.mean(values))
    assert monto["stats"]["median"] == pytest.approx(statistics.median(values))
    assert monto["stats"]["conversion_errors"] == 1  # «abc»; «N/A» es un marcador de ausencia


def test_the_engine_does_not_merge_or_drop_records_on_its_own():
    cols = mappings(ERR_PROFILE, monto={"semantic_type": "quantitative", "additivity": "additive"},
                    fecha={"semantic_type": "temporal"})
    counts, total = run(ERRORS_CSV, [op("count", [], ["zona"]), op("sum", ["monto"])], cols)
    # «Norte» y «norte» siguen separadas; « SUR » se agrupa con «Sur» solo por los espacios de los extremos.
    assert rows(counts) == {("Este",): [5], ("Norte",): [5], ("SUR",): [1], ("Sur",): [4], ("norte",): [1]}
    # El duplicado exacto y el atípico se suman (no se eliminan); «abc» y «N/A» no (no son números).
    assert total["rows"][0]["values"] == [120 + 120 + 130 + 125 + 125 + 140 + 135 + 128 + 132 + 99999 + 127 + 131 + 126]
    assert any("valores no numéricos se excluyeron" in w for w in total["warnings"])


def test_profiling_does_not_modify_the_file():
    content = ERRORS_CSV.encode("utf-8")
    original = bytes(content)
    profile_dataset(content, "errores.csv")
    assert content == original


# --- Plan descriptivo sin IA ------------------------------------------------------------------

def _shared(prof: dict) -> list[dict]:
    """Columnas como las comparte la revisión (metadatos, nunca valores)."""
    ranges = {1: "1", 2: "2"}
    out = []
    for c in prof["columns"]:
        d = c["distinct"]
        out.append({
            "name": c["name"], "format": "text", "semantic_type": c["semantic_type"],
            "additivity": c["additivity_suggestion"], "unit": c["unit_suggestion"], "split_by": c["split_by_suggestion"],
            "distinct_values": ranges.get(d) or ("3-10" if d <= 10 else "11-50" if d <= 50 else "51-500" if d <= 500 else ">500"),
        })
    return out


def test_descriptive_plan_without_ai_is_valid_and_runs_on_the_engine():
    from app.services.descriptive_plan import DescriptivePlanRequest, descriptive_reply

    reply, notes = descriptive_reply(DescriptivePlanRequest.model_validate({"sources": [{"alias": "A", "columns": _shared(EDU_PROFILE)}]}))
    plan = reply.plans[0]
    ops = [o.operation for o in plan.operations]
    assert ops[:5] == ["count", "sum", "mean", "median", "std"]
    # La tasa (no aditiva) se promedia pero no se suma; el código nunca es una medida.
    assert "tasa_aprobacion" not in plan.operations[1].columns and "tasa_aprobacion" in plan.operations[2].columns
    assert all("codigo" not in o.columns for o in plan.operations)
    operations = [o.model_dump() for o in plan.operations]
    results = run(EDU, operations[:6], EDU_COLS) + run(EDU, operations[6:], EDU_COLS)  # máximo 6 planes por ejecución
    assert all(r["status"] == "ok" for r in results), [r.get("error") for r in results]
    assert results[0]["rows"][0]["values"] == [len(EDUCATION)]


def test_descriptive_plan_endpoint_does_not_use_the_ai():
    from tests.ai_helpers import ORIGIN, FakeProvider, make_client

    provider = FakeProvider()
    client, _ = make_client(ai_enabled=False, provider=provider)
    response = client.post("/api/ai/plans/descriptive", json={"sources": [{"alias": "A", "columns": _shared(profile(SALES))}]}, headers=ORIGIN)
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["usage"]["cost_usd"] == 0 and body["plan_ids"]
    assert provider.received == [] and provider.interpreted == []
    assert client.post(f"/api/ai/plans/{body['plan_ids'][0]}/approve", headers=ORIGIN).status_code == 200
