"""Histograma, dispersión y curva ROC (Fase 4B.2).

Valores esperados calculados a mano (o con la definición del estadístico), no
copiados de la salida del motor. Sin IA y con la red bloqueada.
"""

import json

import pytest

from app.schemas.ai_context import AIContext
from app.schemas.ai_plan import AIAssistantReply, AIPlan, validate_reply
from tests.ai_helpers import ORIGIN, FakeProvider, make_client, no_network, prepare, reply_for  # noqa: F401


def op(operation, columns, group_by=(), description="—"):
    return {"operation": operation, "columns": list(columns), "group_by": list(group_by), "description": description}


def plan(*operations, alias="A", columns=(), title="Plan visual"):
    return {"source_alias": alias, "title": title, "rationale": "r", "columns_needed": list(columns),
            "operations": list(operations), "charts": [], "limitations": []}


def col(name, semantic, **extra):
    return {"name": name, "original": name, "semantic_type": semantic, **extra}


def run(client, app, plans, files, sources):
    ids = []
    for data in plans:
        plan_id = app.state.ai_plans.save(AIPlan.model_validate(data), app.state.test_user_id)
        app.state.ai_plans.approve(plan_id, app.state.test_user_id)
        ids.append(plan_id)
    body = {"plan_ids": ids, "sources": sources}
    multipart = {f"file_{alias}": (name, content, "text/csv") for alias, (name, content) in files.items()}
    response = client.post("/api/analysis/execute", data={"request": json.dumps(body)}, files=multipart, headers=ORIGIN)
    assert response.status_code == 200, response.text
    return response.json()


def single(csv: str, operation: dict, columns: list[dict]):
    client, app = make_client()
    data = run(client, app, [plan(operation)], {"A": ("d.csv", csv.encode())}, [{"alias": "A", "columns": columns}])
    return data["results"][0]["operations"][0]


def rows(result):
    return [(r["keys"], r["values"]) for r in result["rows"]]


# --- Histograma -------------------------------------------------------------------

def test_histogram_sturges_known_frequencies():
    # n = 8 → k = ⌈log2 8⌉ + 1 = 4 intervalos de ancho (7 − 0) / 4 = 1,75.
    csv = "v\n" + "\n".join(str(i) for i in range(8)) + "\n"
    result = single(csv, op("histogram", ["v"]), [col("v", "quantitative")])
    assert result["status"] == "ok"
    assert rows(result) == [(["[0, 1.75)"], [2.0]), (["[1.75, 3.5)"], [2.0]), (["[3.5, 5.25)"], [2.0]), (["[5.25, 7]"], [2.0])]
    assert result["stats"] == {"bins": 4, "bin_width": 1.75, "min": 0.0, "max": 7.0, "rule": "Sturges"}
    assert result["rows_used"] == 8


def test_histogram_skewed_values_and_missing_cells():
    # n = 7 (la celda vacía se excluye) → k = ⌈log2 7⌉ + 1 = 4; intervalos de ancho 2,25 entre 1 y 10.
    csv = "v\n1\n1\n1\n2\n2\n3\n10\n\n"
    result = single(csv, op("histogram", ["v"]), [col("v", "quantitative")])
    assert [r[1][0] for r in rows(result)] == [6.0, 0.0, 0.0, 1.0]
    assert sum(r[1][0] for r in rows(result)) == 7 and result["rows_used"] == 7


def test_histogram_constant_column_has_one_interval_and_a_warning():
    result = single("v\n5\n5\n5\n", op("histogram", ["v"]), [col("v", "quantitative")])
    assert rows(result) == [(["5"], [3.0])]
    assert any("único valor" in w for w in result["warnings"])


@pytest.mark.parametrize("semantic, fragment", [("categorical", "categórica"), ("identifier", "código")])
def test_histogram_requires_a_quantitative_column(semantic, fragment):
    result = single("v\nA\nB\n", op("histogram", ["v"]), [col("v", semantic)])
    assert result["status"] == "error" and fragment in result["error"]


# --- Dispersión -------------------------------------------------------------------

def test_scatter_points_and_explicit_correlations():
    csv = "x,y\n1,2\n2,4\n3,5\n4,4\n5,5\n"
    result = single(csv, op("scatter", ["x", "y"]), [col("x", "quantitative", unit="kg"), col("y", "quantitative", unit="ARS")])
    assert rows(result) == [([], [1.0, 2.0]), ([], [2.0, 4.0]), ([], [3.0, 5.0]), ([], [4.0, 4.0]), ([], [5.0, 5.0])]
    # Pearson = cov(x, y) / (σx σy) = 3 / √(10 · 4,8)... calculado: 0,7745967; Spearman sobre rangos: 0,7378648.
    assert result["stats"]["pearson"] == pytest.approx(0.7745967, abs=1e-6)
    assert result["stats"]["spearman"] == pytest.approx(0.7378648, abs=1e-6)
    assert result["stats"]["n"] == 5 and result["stats"]["sampled"] is False
    assert [m["unit"] for m in result["measures"]] == ["kg", "ARS"]
    assert any("no implica causalidad" in w for w in result["warnings"])


def test_scatter_is_limited_to_2000_reproducible_points():
    csv = "x,y\n" + "".join(f"{i},{2 * i}\n" for i in range(2500))
    columns = [col("x", "quantitative"), col("y", "quantitative")]
    first = single(csv, op("scatter", ["x", "y"]), columns)
    second = single(csv, op("scatter", ["x", "y"]), columns)
    assert len(first["rows"]) == 2000
    assert first["rows"] == second["rows"]  # misma semilla, misma muestra
    assert first["stats"] == {"pearson": 1.0, "spearman": 1.0, "n": 2500, "shown": 2000, "sampled": True}
    assert any("2000 de 2500 puntos" in w for w in first["warnings"])


def test_scatter_excludes_incomplete_pairs_and_needs_two_quantitative_columns():
    result = single("x,y\n1,2\n2,\n3,6\n", op("scatter", ["x", "y"]), [col("x", "quantitative"), col("y", "quantitative")])
    assert result["stats"]["n"] == 2 and any("Se excluyeron 1 filas" in w for w in result["warnings"])
    bad = single("x,y\nA,1\nB,2\n", op("scatter", ["x", "y"]), [col("x", "categorical"), col("y", "quantitative")])
    assert bad["status"] == "error" and "categórica" in bad["error"]


# --- Curva ROC --------------------------------------------------------------------

ROC_COLUMNS = [col("real", "categorical", positive_label="si"), col("score", "quantitative")]


def test_roc_perfect_separation_gives_auc_1():
    csv = "real,score\nno,0.1\nno,0.2\nsi,0.8\nsi,0.9\n"
    result = single(csv, op("roc_curve", ["real", "score"]), ROC_COLUMNS)
    assert result["status"] == "ok"
    assert result["stats"]["auc"] == 1.0
    assert result["stats"]["positives"] == 2 and result["stats"]["negatives"] == 2
    assert result["stats"]["positive_label"] == "si" and result["stats"]["negative_label"] == "no"
    points = [tuple(r[1]) for r in rows(result)]
    assert points[0] == (0.0, 0.0) and points[-1] == (1.0, 1.0)
    assert (0.0, 1.0) in points  # el clasificador perfecto pasa por la esquina superior izquierda


def test_roc_known_auc_computed_by_hand():
    # Positivos: 0,35 y 0,8; negativos: 0,1 y 0,4. Pares positivo > negativo: (0,35>0,1), (0,8>0,1), (0,8>0,4) → 3/4.
    csv = "real,score\n0,0.1\n0,0.4\n1,0.35\n1,0.8\n"
    columns = [col("real", "categorical", positive_label="1"), col("score", "quantitative")]
    result = single(csv, op("roc_curve", ["real", "score"]), columns)
    assert result["stats"]["auc"] == 0.75
    assert [tuple(r[1]) for r in rows(result)] == [(0.0, 0.0), (0.0, 0.5), (0.5, 0.5), (0.5, 1.0), (1.0, 1.0)]


def test_roc_positive_class_choice_matters_and_is_validated():
    csv = "real,score\n0,0.1\n0,0.4\n1,0.35\n1,0.8\n"
    inverted = single(csv, op("roc_curve", ["real", "score"]), [col("real", "categorical", positive_label="0"), col("score", "quantitative")])
    assert inverted["stats"]["auc"] == 0.25
    assert any("podrían estar invertidas" in w for w in inverted["warnings"])

    missing = single(csv, op("roc_curve", ["real", "score"]), [col("real", "categorical"), col("score", "quantitative")])
    assert missing["status"] == "error" and "Elegí la clase positiva" in missing["error"]
    wrong = single(csv, op("roc_curve", ["real", "score"]), [col("real", "categorical", positive_label="2"), col("score", "quantitative")])
    assert wrong["status"] == "error" and "no es ninguna de las dos clases" in wrong["error"]


def test_roc_requires_exactly_two_classes_and_numeric_scores():
    three = single("real,score\na,0.1\nb,0.2\nc,0.3\n", op("roc_curve", ["real", "score"]),
                   [col("real", "categorical", positive_label="a"), col("score", "quantitative")])
    assert three["status"] == "error" and "tiene 3 clases" in three["error"]
    text_score = single("real,score\nsi,alto\nno,bajo\n", op("roc_curve", ["real", "score"]),
                        [col("real", "categorical", positive_label="si"), col("score", "categorical")])
    assert text_score["status"] == "error" and "categórica" in text_score["error"]


def test_roc_with_missing_values_keeps_valid_rows_and_needs_both_classes():
    csv = "real,score\nsi,0.9\nno,\n,0.5\nsi,0.7\n"
    result = single(csv, op("roc_curve", ["real", "score"]), ROC_COLUMNS)
    assert result["status"] == "error" and "una sola clase" in result["error"]  # quedan solo dos "si"


# --- Independencia y operaciones anteriores ------------------------------------------

def test_two_sources_with_new_and_previous_operations_stay_independent():
    client, app = make_client()
    csv_a = "fecha,sector,ventas\n2026-01-01,T,15000\n2026-01-01,I,8000\n2026-02-01,T,18000\n2026-02-01,I,9500\n"
    csv_b = "real,score\nno,0.1\nno,0.2\nsi,0.8\nsi,0.9\n"
    data = run(
        client, app,
        [plan(op("sum", ["ventas"]), op("histogram", ["ventas"])), plan(op("roc_curve", ["real", "score"]), alias="B")],
        {"A": ("ventas.csv", csv_a.encode()), "B": ("modelo.csv", csv_b.encode())},
        [{"alias": "A", "columns": [col("fecha", "temporal"), col("sector", "categorical"), col("ventas", "quantitative")]},
         {"alias": "B", "columns": ROC_COLUMNS}],
    )
    a, b = data["results"]
    assert a["source_alias"] == "A" and rows(a["operations"][0]) == [([], [50500.0])]
    assert sum(r[1][0] for r in rows(a["operations"][1])) == 4  # 4 ventas en el histograma de A
    assert b["source_alias"] == "B" and b["operations"][0]["stats"]["auc"] == 1.0
    assert {s["alias"]: s["rows"] for s in data["sources"]} == {"A": 4, "B": 4}


# --- Validación de los planes que propone la IA ----------------------------------------

def context_with(*columns):
    return AIContext.model_validate({"objective": "Evaluar", "sources": [{"alias": "A", "columns": list(columns)}]})


def reply_with(operation):
    return AIAssistantReply.model_validate({
        "message": "m", "interpreted_objective": "o", "source_relationship": "single", "questions": [], "warnings": [],
        "plans": [plan(operation, columns=operation["columns"])],
    })


@pytest.mark.parametrize("operation, columns, fragment", [
    (op("roc_curve", ["clase", "score"]), [{"name": "clase", "format": "text", "semantic_type": "categorical", "distinct_values": "3-10"},
                                           {"name": "score", "format": "numeric", "semantic_type": "quantitative"}], "no es binaria"),
    (op("roc_curve", ["real", "nombre"]), [{"name": "real", "format": "text", "semantic_type": "categorical", "distinct_values": "2"},
                                           {"name": "nombre", "format": "text", "semantic_type": "text"}], "no es una puntuación numérica"),
    (op("histogram", ["sector"]), [{"name": "sector", "format": "text", "semantic_type": "categorical"}], "solo admite columnas cuantitativas"),
    (op("scatter", ["x"]), [{"name": "x", "format": "numeric", "semantic_type": "quantitative"}], "exactamente 2 columna"),
    (op("histogram", ["x"], ["x"]), [{"name": "x", "format": "numeric", "semantic_type": "quantitative"}], "ninguna agrupación"),
])
def test_impossible_visual_plans_are_discarded(operation, columns, fragment):
    problems = validate_reply(reply_with(operation), context_with(*columns))
    assert any(fragment in p for p in problems), problems


def test_valid_visual_plans_pass_validation():
    columns = [{"name": "real", "format": "text", "semantic_type": "categorical", "distinct_values": "2"},
               {"name": "score", "format": "numeric", "semantic_type": "quantitative"}]
    assert validate_reply(reply_with(op("roc_curve", ["real", "score"])), context_with(*columns)) == []
    assert validate_reply(reply_with(op("histogram", ["score"])), context_with(*columns)) == []


def test_ai_reply_with_an_impossible_roc_is_rejected_end_to_end():
    """Recorrido con el proveedor simulado (solo en pruebas): la IA propone una ROC imposible y el backend la descarta."""
    columns = [{"name": "clase", "format": "text", "semantic_type": "categorical", "distinct_values": "11-50"},
               {"name": "score", "format": "numeric", "semantic_type": "quantitative"}]
    roc = op("roc_curve", ["clase", "score"])
    provider = FakeProvider(lambda payload: reply_for(payload, plans=[plan(roc, columns=["clase", "score"])]))
    client, app = make_client(ai_enabled=True, provider=provider)
    prepared = prepare(client, {"objective": "Evaluar el modelo", "sources": [{"alias": "A", "columns": columns}]}).json()
    response = client.post(f"/api/ai/requests/{prepared['request_id']}/authorize",
                           json={"payload_sha256": prepared["payload_sha256"], "confirm": True}, headers=ORIGIN)
    assert response.status_code == 502 and "no es binaria" in response.json()["detail"]
    assert app.state.ai_plans._plans == {}
