"""Motor de análisis con Pandas (Fase 4A).

Se ejecutan planes aprobados sobre archivos reenviados por el navegador. No hay
IA en el cálculo: la red externa está bloqueada y la IA está deshabilitada.
"""

import json

import pytest

from app.schemas.ai_plan import AIPlan
from app.services.analysis_engine import parse_number, to_dates
from tests.ai_helpers import ORIGIN, FakeProvider, make_client, no_network  # noqa: F401

CSV = (
    "fecha,sector,ventas\n"
    "2026-01-01,Tecnologia,15000\n"
    "2026-01-01,Indumentaria,8000\n"
    "2026-02-01,Tecnologia,18000\n"
    "2026-02-01,Indumentaria,9500\n"
    "2026-03-01,Tecnologia,21000\n"
    "2026-03-01,Indumentaria,11000\n"
).encode()

COLUMNS = [
    {"name": "fecha", "original": "fecha", "semantic_type": "temporal"},
    {"name": "sector", "original": "sector", "semantic_type": "categorical"},
    {"name": "ventas", "original": "ventas", "semantic_type": "quantitative", "unit": "ARS"},
]


def op(operation, columns, group_by=(), description="—"):
    return {"operation": operation, "columns": list(columns), "group_by": list(group_by), "description": description}


def plan(*operations, alias="A", columns=("fecha", "sector", "ventas"), title="Ventas por sector y mes"):
    return {
        "source_alias": alias, "title": title, "rationale": "Plan de prueba.", "columns_needed": list(columns),
        "operations": list(operations), "charts": [{"type": "bar", "x": "sector", "y": "ventas", "title": "Ventas"}],
        "limitations": ["Datos sintéticos."],
    }


def store_plan(app, data, approve=True):
    store = app.state.ai_plans
    plan_id = store.save(AIPlan.model_validate(data), app.state.test_user_id)
    if approve:
        store.approve(plan_id, app.state.test_user_id)
    return plan_id


def execute(client, plan_ids, files, sources=None):
    sources = sources or [{"alias": "A", "columns": COLUMNS}]
    body = {"plan_ids": plan_ids, "sources": sources}
    multipart = {f"file_{alias}": (name, content, "text/csv") for alias, (name, content) in files.items()}
    return client.post("/api/analysis/execute", data={"request": json.dumps(body)}, files=multipart, headers=ORIGIN)


def rows(operation):
    return {tuple(r["keys"]): r["values"] for r in operation["rows"]}


# --- Caso obligatorio --------------------------------------------------------------

def test_mandatory_synthetic_csv_produces_the_expected_totals():
    provider = FakeProvider()
    client, app = make_client(ai_enabled=False, provider=provider)  # la ejecución no depende de la IA
    plan_id = store_plan(app, plan(
        op("time_series", ["ventas"], ["fecha"], "Ventas totales por mes"),
        op("group_by", ["ventas"], ["sector"], "Ventas totales por sector"),
        op("sum", ["ventas"], [], "Total general"),
    ))
    response = execute(client, [plan_id], {"A": ("ventas.csv", CSV)})
    assert response.status_code == 200, response.text
    data = response.json()
    result = data["results"][0]
    assert result["status"] == "ok" and result["source_alias"] == "A"
    monthly, by_sector, total = result["operations"]

    assert monthly["period"] == "month" and monthly["dimensions"] == ["fecha"]
    assert rows(monthly) == {("2026-01",): [23000.0], ("2026-02",): [27500.0], ("2026-03",): [32000.0]}
    assert rows(by_sector) == {("Tecnologia",): [54000.0], ("Indumentaria",): [28500.0]}
    assert rows(total) == {(): [82500.0]}
    assert monthly["measures"] == [{"column": "ventas", "aggregate": "sum", "unit": "ARS"}]
    assert total["rows_used"] == 6
    assert data["engine"] == "pandas" and data["sources"] == [{"alias": "A", "rows": 6, "columns": 3}]
    assert result["charts"][0]["type"] == "bar"  # gráficos del plan aprobado, no inventados
    assert provider.received == []  # la IA no participó


def test_mean_min_max_count_median_and_comparison():
    client, app = make_client()
    plan_id = store_plan(app, plan(
        op("mean", ["ventas"], ["sector"]), op("min", ["ventas"]), op("max", ["ventas"]),
        op("count", [], ["sector"]), op("median", ["ventas"]), op("compare_groups", ["ventas"], ["sector"]),
        op("frequency", ["sector"]), op("distinct_count", ["sector", "fecha"]),
    ))
    ops = execute(client, [plan_id], {"A": ("ventas.csv", CSV)}).json()["results"][0]["operations"]
    mean, low, high, count, median, compare, freq, distinct = ops
    assert rows(mean) == {("Indumentaria",): [9500.0], ("Tecnologia",): [18000.0]}
    assert rows(low) == {(): [8000.0]} and rows(high) == {(): [21000.0]}
    assert rows(count) == {("Indumentaria",): [3.0], ("Tecnologia",): [3.0]}
    assert rows(median) == {(): [13000.0]}
    shares = rows(compare)
    assert shares[("Tecnologia",)][0] == 54000.0 and shares[("Tecnologia",)][1] == pytest.approx(65.4545, abs=1e-3)
    assert compare["measures"][1] == {"column": "ventas", "aggregate": "share_pct", "unit": "%"}
    assert rows(freq) == {("Indumentaria",): [3.0], ("Tecnologia",): [3.0]}
    assert rows(distinct) == {(): [2.0, 3.0]}


# --- Validaciones del plan ---------------------------------------------------------

def test_unapproved_or_unknown_plans_are_not_executed():
    client, app = make_client()
    pending = store_plan(app, plan(op("sum", ["ventas"])), approve=False)
    response = execute(client, [pending], {"A": ("ventas.csv", CSV)})
    assert response.status_code == 409 and "no está aprobado" in response.json()["detail"]
    response = execute(client, ["inexistente"], {"A": ("ventas.csv", CSV)})
    assert response.status_code == 404 and "Pedí la propuesta de nuevo" in response.json()["detail"]


def test_missing_or_different_file_is_reported():
    client, app = make_client()
    plan_id = store_plan(app, plan(op("sum", ["ventas"])))
    response = execute(client, [plan_id], {})
    assert response.status_code == 422 and "Falta el archivo de la fuente A" in response.json()["detail"]
    other = b"region,poblacion\nNorte,10\n"
    response = execute(client, [plan_id], {"A": ("otro.csv", other)})
    assert response.status_code == 422 and "¿se cargó otro archivo?" in response.json()["detail"]


def test_plan_columns_must_be_authorized():
    client, app = make_client()
    plan_id = store_plan(app, plan(op("sum", ["ventas"])))
    limited = [{"alias": "A", "columns": COLUMNS[:2]}]  # "ventas" ya no está autorizada
    result = execute(client, [plan_id], {"A": ("ventas.csv", CSV)}, sources=limited).json()["results"][0]
    assert result["status"] == "error" and "ventas" in result["warnings"][0]


def test_invalid_request_is_rejected():
    client, app = make_client()
    plan_id = store_plan(app, plan(op("sum", ["ventas"])))
    bad = client.post("/api/analysis/execute", data={"request": json.dumps({"plan_ids": [plan_id], "sources": [], "x": 1})},
                      files={"file_A": ("v.csv", CSV, "text/csv")}, headers=ORIGIN)
    assert bad.status_code == 422


# --- Tipos incompatibles y operaciones no disponibles -----------------------------

@pytest.mark.parametrize("operation, fragment", [
    (op("sum", ["sector"]), "categórica"),
    (op("mean", ["fecha"]), "temporal"),
    (op("time_series", ["ventas"], ["sector"]), "requiere una columna temporal"),
])
def test_incompatible_operations_are_reported_and_not_replaced(operation, fragment):
    client, app = make_client()
    plan_id = store_plan(app, plan(operation, op("sum", ["ventas"])))
    result = execute(client, [plan_id], {"A": ("ventas.csv", CSV)}).json()["results"][0]
    failed, ok = result["operations"]
    assert failed["status"] == "error" and fragment in failed["error"] and failed["rows"] == []
    assert ok["status"] == "ok" and result["status"] == "partial"


def test_identifiers_are_not_summed():
    client, app = make_client()
    csv = b"codigo,monto\n001,10\n002,20\n"
    columns = [{"name": "codigo", "original": "codigo", "semantic_type": "identifier"},
               {"name": "monto", "original": "monto", "semantic_type": "quantitative"}]
    plan_id = store_plan(app, plan(op("sum", ["codigo"]), op("count", [], ["codigo"]), columns=("codigo", "monto")))
    result = execute(client, [plan_id], {"A": ("c.csv", csv)}, sources=[{"alias": "A", "columns": columns}]).json()["results"][0]
    assert "código o identificador" in result["operations"][0]["error"]
    assert rows(result["operations"][1]) == {("001",): [1.0], ("002",): [1.0]}


# --- Fechas inválidas y faltantes -------------------------------------------------

def test_invalid_dates_are_grouped_apart_with_a_warning():
    client, app = make_client()
    csv = b"fecha,ventas\n2026-01-01,10\n2026-13-45,5\n2026-01-15,20\n"
    columns = [COLUMNS[0], COLUMNS[2]]
    plan_id = store_plan(app, plan(op("time_series", ["ventas"], ["fecha"]), columns=("fecha", "ventas")))
    operation = execute(client, [plan_id], {"A": ("f.csv", csv)}, sources=[{"alias": "A", "columns": columns}]).json()["results"][0]["operations"][0]
    assert rows(operation) == {("(sin dato)",): [5.0], ("2026-01",): [30.0]}
    assert any("1 fechas inválidas" in w for w in operation["warnings"])


def test_missing_values_follow_the_review_decisions():
    client, app = make_client()
    csv = b"sector,ventas\nA,100\nB,\nA,NA\nB,50\n"
    plan_data = plan(op("sum", ["ventas"]), op("count", []), columns=("sector", "ventas"))

    # Marcadores sin decidir: "NA" no es faltante, pero tampoco es un número → se excluye y se avisa.
    pending = [{"name": "sector", "original": "sector", "semantic_type": "categorical"},
               {"name": "ventas", "original": "ventas", "semantic_type": "quantitative", "missing_markers": "pending"}]
    plan_id = store_plan(app, plan_data)
    total, count = execute(client, [plan_id], {"A": ("m.csv", csv)}, sources=[{"alias": "A", "columns": pending}]).json()["results"][0]["operations"]
    assert rows(total) == {(): [150.0]} and total["rows_used"] == 2
    assert any("1 valores no numéricos" in w and "sin decidir" in w for w in total["warnings"])
    assert rows(count) == {(): [4.0]}  # los registros se cuentan todos

    # "Tratar como faltante": el NA es un faltante más, sin advertencia de conversión.
    treat = [pending[0], {**pending[1], "missing_markers": "treat_as_missing"}]
    plan_id = store_plan(app, plan_data)
    total = execute(client, [plan_id], {"A": ("m.csv", csv)}, sources=[{"alias": "A", "columns": treat}]).json()["results"][0]["operations"][0]
    assert rows(total) == {(): [150.0]} and total["warnings"] == []


def test_renamed_columns_are_mapped_to_the_original_file():
    client, app = make_client()
    columns = [{"name": "rubro", "original": "sector", "semantic_type": "categorical"},
               {"name": "importe", "original": "ventas", "semantic_type": "quantitative", "unit": "ARS"}]
    plan_id = store_plan(app, plan(op("group_by", ["importe"], ["rubro"]), columns=("rubro", "importe")))
    operation = execute(client, [plan_id], {"A": ("v.csv", CSV)}, sources=[{"alias": "A", "columns": columns}]).json()["results"][0]["operations"][0]
    assert rows(operation) == {("Tecnologia",): [54000.0], ("Indumentaria",): [28500.0]}


# --- Varias fuentes independientes ----------------------------------------------

def test_two_sources_produce_separate_results_without_joining():
    client, app = make_client()
    other = b"ANYO,CIF\n2020,100\n2020,50\n2021,70\n"
    columns_b = [{"name": "ANYO", "original": "ANYO", "semantic_type": "temporal"},
                 {"name": "CIF", "original": "CIF", "semantic_type": "quantitative"}]
    plan_a = store_plan(app, plan(op("sum", ["ventas"])))
    plan_b = store_plan(app, plan(op("time_series", ["CIF"], ["ANYO"]), alias="B", columns=("ANYO", "CIF"), title="CIF por año"))
    data = execute(client, [plan_a, plan_b], {"A": ("ventas.csv", CSV), "B": ("siacam.csv", other)},
                   sources=[{"alias": "A", "columns": COLUMNS}, {"alias": "B", "columns": columns_b}]).json()
    result_a, result_b = data["results"]
    assert result_a["source_alias"] == "A" and rows(result_a["operations"][0]) == {(): [82500.0]}
    assert result_b["source_alias"] == "B" and result_b["operations"][0]["period"] == "year"
    assert rows(result_b["operations"][0]) == {("2020",): [150.0], ("2021",): [70.0]}
    assert {s["alias"]: s["rows"] for s in data["sources"]} == {"A": 6, "B": 3}


# --- Seguridad y límites -----------------------------------------------------------

def test_original_bytes_are_not_modified_and_nothing_is_stored(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    client, app = make_client()
    original = bytes(CSV)
    plan_id = store_plan(app, plan(op("sum", ["ventas"])))
    assert execute(client, [plan_id], {"A": ("ventas.csv", CSV)}).status_code == 200
    assert CSV == original
    assert list(tmp_path.iterdir()) == []


def test_unauthorized_origin_and_oversized_files_are_rejected():
    client, app = make_client()
    plan_id = store_plan(app, plan(op("sum", ["ventas"])))
    body = {"request": json.dumps({"plan_ids": [plan_id], "sources": [{"alias": "A", "columns": COLUMNS}]})}
    bad = client.post("/api/analysis/execute", data=body, files={"file_A": ("v.csv", CSV, "text/csv")},
                      headers={"Origin": "https://sitio-externo.example"})
    assert bad.status_code == 403
    big = b"fecha,sector,ventas\n" + b"2026-01-01,X,1\n" * (26 * 1024 * 1024 // 15)
    assert client.post("/api/analysis/execute", data=body, files={"file_A": ("v.csv", big, "text/csv")}, headers=ORIGIN).status_code == 413


def test_large_group_results_are_truncated():
    client, app = make_client()
    # 30 sectores × 20 regiones = 600 combinaciones (cada columna tiene pocos valores: se puede agrupar).
    csv = "sector,region\n" + "".join(f"S{i},R{j}\n" for i in range(30) for j in range(20))
    columns = [{"name": "sector", "original": "sector", "semantic_type": "categorical"},
               {"name": "region", "original": "region", "semantic_type": "categorical"}]
    plan_id = store_plan(app, plan(op("frequency", ["sector", "region"]), columns=("sector", "region")))
    operation = execute(client, [plan_id], {"A": ("s.csv", csv.encode())}, sources=[{"alias": "A", "columns": columns}]).json()["results"][0]["operations"][0]
    assert len(operation["rows"]) == 500 and any("primeros 500" in w for w in operation["warnings"])


# --- Conversión de textos ----------------------------------------------------------

@pytest.mark.parametrize("text, expected", [
    ("15000", 15000.0), ("15.000", 15000.0), ("1.234,56", 1234.56), ("1,234.56", 1234.56),
    ("3,5", 3.5), ("-2.5", -2.5), ("abc", None), ("", None), ("NA", None),
])
def test_number_parsing(text, expected):
    assert parse_number(text) == expected


def test_date_parsing_picks_the_matching_format():
    import pandas as pd

    dates, invalid = to_dates(pd.Series(["01/02/2026", "15/03/2026", "no es fecha"]))
    assert invalid == 1
    assert [d.strftime("%Y-%m-%d") for d in dates.dropna()] == ["2026-02-01", "2026-03-15"]


# --- Catálogo único: la IA solo puede proponer lo que el motor ejecuta ------------

def test_ai_catalog_matches_the_engine():
    from app.schemas.ai_plan import SUPPORTED_OPERATIONS
    from app.services.analysis_engine import OPERATIONS

    assert set(OPERATIONS) == set(SUPPORTED_OPERATIONS)


@pytest.mark.parametrize("operation", ["std", "percentage", "top_n", "correlation", "missing_summary", "exec_python"])
def test_operations_the_engine_cannot_run_cannot_reach_a_plan(operation):
    with pytest.raises(ValueError):
        AIPlan.model_validate(plan(op(operation, ["ventas"])))


@pytest.mark.parametrize("chart", ["box", "violin", "heatmap"])
def test_charts_the_dashboard_cannot_build_cannot_reach_a_plan(chart):
    data = plan(op("sum", ["ventas"]))
    data["charts"] = [{"type": chart, "x": "ventas", "y": None, "title": "x"}]
    with pytest.raises(ValueError):
        AIPlan.model_validate(data)


def test_unknown_operations_are_still_reported_defensively():
    """Si una operación desconocida llegara igual (por ejemplo, un plan viejo), se informa sin reemplazarla."""
    from app.schemas.ai_plan import AIOperation
    from app.services.analysis_engine import PreparedSource, run_operation
    import pandas as pd

    src = PreparedSource(alias="A", df=pd.DataFrame({"ventas": ["1"]}), columns={})
    result = run_operation(src, AIOperation.model_construct(operation="std", columns=[], group_by=[], description=""))
    assert result.status == "error" and "todavía no está disponible" in result.error
