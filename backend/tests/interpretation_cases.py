"""Caso real de la prueba manual (Fase 5): dataset sintético de ventas de 72 filas y 17 operaciones
en 3 planes, como los que propone la IA. Lo usan las pruebas del contexto de interpretación.
Datos inventados y determinísticos (los mismos que el dataset de prueba «Ventas» del frontend).
"""

from app.schemas.ai_plan import AIPlan
from app.schemas.analysis import ExecutionRequest
from app.services.analysis_engine import execute_analysis
from app.services.report import descriptive_summary


def sales72_csv() -> str:
    lines = []
    rubros = [("Alimentos", 1200), ("Limpieza", 450), ("Bebidas", 800)]
    for m in range(1, 7):
        for day in (3, 11, 19, 27):
            for i, (rubro, base) in enumerate(rubros):
                canal = "Online" if (day + i) % 2 == 0 else "Local"
                amount = base + m * 25 + day * 3 + i * 10
                lines.append(f"2025-{m:02d}-{day:02d};{rubro};{canal};{amount}")
    return "fecha;rubro;canal;monto_ars\n" + "\n".join(lines) + "\n"


def _op(operation, columns, group_by=(), description=None):
    return {"operation": operation, "columns": list(columns), "group_by": list(group_by), "description": description or operation}


PLANS_17 = [
    ("Evolución de las ventas", [
        _op("sum", ["monto_ars"], description="Total vendido"),
        _op("time_series", ["fecha", "monto_ars"], description="Ventas por mes"),
        _op("time_series", ["fecha", "monto_ars"], ["rubro"], "Ventas por mes y rubro"),
        _op("time_series", ["fecha", "monto_ars"], ["canal"], "Ventas por mes y canal"),
        _op("variation", ["monto_ars"], ["fecha"], "Variación mensual"),
        _op("variation", ["monto_ars"], ["fecha", "rubro"], "Variación mensual por rubro"),
    ]),
    ("Rubros y canales", [
        _op("compare_groups", ["monto_ars"], ["rubro"], "Participación por rubro"),
        _op("compare_groups", ["monto_ars"], ["canal"], "Participación por canal"),
        _op("compare_groups", ["monto_ars"], ["rubro", "canal"], "Canal dentro de cada rubro"),
        _op("pareto", ["monto_ars"], ["rubro"], "Ranking de rubros"),
        _op("count", [], ["canal"], "Operaciones por canal"),
        _op("mean", ["monto_ars"], ["canal"], "Ticket promedio por canal"),
    ]),
    ("Distribución de los montos", [
        _op("histogram", ["monto_ars"], description="Distribución de montos"),
        _op("median", ["monto_ars"], ["rubro"], "Mediana por rubro"),
        _op("std", ["monto_ars"], ["rubro"], "Dispersión por rubro"),
        _op("min", ["monto_ars"], ["rubro"], "Mínimo por rubro"),
        _op("max", ["monto_ars"], ["rubro"], "Máximo por rubro"),
    ]),
]

COLUMNS = [
    {"name": "fecha", "original": "fecha", "semantic_type": "temporal"},
    {"name": "rubro", "original": "rubro", "semantic_type": "categorical"},
    {"name": "canal", "original": "canal", "semantic_type": "categorical"},
    {"name": "monto_ars", "original": "monto_ars", "semantic_type": "quantitative", "unit": "ARS", "additivity": "additive"},
]


def run_plans(csv: str, plans: list[tuple[str, list[dict]]], columns: list[dict] = COLUMNS) -> dict:
    """Ejecuta los planes con el motor real y devuelve el resultado como lo guarda la aplicación."""
    parsed = [(f"p{i}", AIPlan.model_validate({
        "source_alias": "A", "title": title, "rationale": "r", "columns_needed": [], "operations": ops, "charts": [], "limitations": [],
    })) for i, (title, ops) in enumerate(plans)]
    request = ExecutionRequest.model_validate({"plan_ids": [p for p, _ in parsed], "sources": [{"alias": "A", "columns": columns}]})
    result = execute_analysis(request, parsed, {"A": (csv.encode("utf-8"), "ventas.csv")})
    return result


def sales17() -> tuple[dict, dict]:
    result = run_plans(sales72_csv(), PLANS_17)
    return result, descriptive_summary(result)
