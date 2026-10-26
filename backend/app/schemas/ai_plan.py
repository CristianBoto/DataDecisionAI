"""Respuesta estructurada de la IA (Fase 3B.2).

La IA no devuelve texto libre ni código: devuelve este esquema (Structured
Outputs). Aun así, el backend vuelve a validarlo contra el contexto autorizado:
solo alias y columnas que el usuario compartió, solo operaciones del catálogo.

Structured Outputs exige que todos los campos sean obligatorios; los opcionales
se expresan como `| None`. Por eso no hay valores por defecto.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict

from app.schemas.ai_context import AIContext

Alias = Literal["A", "B", "C"]

# Catálogo ÚNICO de operaciones: la IA solo puede proponer lo que el motor Pandas
# ejecuta (`OPERATIONS` en analysis_engine.py; una prueba verifica que coincidan).
# Para cada una: qué calcula y qué columnas necesita. Esta descripción se envía
# a la IA como parte de sus instrucciones.
OPERATION_GUIDE: dict[str, str] = {
    "count": "cantidad de registros (filas); con group_by, por grupo. No necesita columnas cuantitativas.",
    "distinct_count": "cantidad de valores distintos de cada columna de columns.",
    "sum": "suma de columnas cuantitativas; con group_by, por grupo.",
    "mean": "promedio de columnas cuantitativas; con group_by, por grupo.",
    "median": "mediana de columnas cuantitativas; con group_by, por grupo.",
    "min": "mínimo de columnas cuantitativas; con group_by, por grupo.",
    "max": "máximo de columnas cuantitativas; con group_by, por grupo.",
    "frequency": "cantidad de registros por cada valor de una columna categórica (o combinación de columnas).",
    "group_by": "suma de las columnas cuantitativas de columns por cada categoría de group_by (conteo si no hay cuantitativas).",
    "compare_groups": "total de una columna cuantitativa por grupo y la participación (%) de cada grupo sobre el total.",
    "time_series": "suma de las columnas cuantitativas por período (mes, o año si abarca muchos años) de una columna temporal; "
    "puede desglosarse por una categoría agregándola en group_by.",
}
SUPPORTED_OPERATIONS: tuple[str, ...] = tuple(OPERATION_GUIDE)
Operation = Literal[SUPPORTED_OPERATIONS]  # type: ignore[valid-type]

# Gráficos que el dashboard puede construir con los resultados del motor.
# (Dispersión e histograma se agregarán cuando el motor devuelva esos datos.)
CHART_GUIDE: dict[str, str] = {
    "line": "evolución en el tiempo (requiere una agrupación temporal).",
    "bar": "comparación entre categorías (una o dos agrupaciones).",
    "pie": "partes de un total (una agrupación, 2 a 6 grupos, sumas o conteos; nunca promedios).",
    "kpi": "un único valor total (sin agrupaciones).",
    "table": "valores detallados.",
}
SUPPORTED_CHARTS: tuple[str, ...] = tuple(CHART_GUIDE)
ChartType = Literal[SUPPORTED_CHARTS]  # type: ignore[valid-type]
SourceRelationship = Literal["single", "independent", "compare", "concatenate", "relate", "unclear"]

MAX_PLANS = 6
MAX_QUESTIONS = 8
MAX_OPERATIONS_PER_PLAN = 10
MAX_CHARTS_PER_PLAN = 4
MAX_TEXT_CHARS = 1500


class _Out(BaseModel):
    model_config = ConfigDict(extra="forbid")


class AIOperation(_Out):
    operation: Operation
    columns: list[str]
    group_by: list[str]
    description: str


class AIChart(_Out):
    type: ChartType
    x: str | None
    y: str | None
    title: str


class AIPlan(_Out):
    """Plan para UNA fuente: los planes nunca unen datasets en esta etapa."""

    source_alias: Alias
    title: str
    rationale: str
    columns_needed: list[str]
    operations: list[AIOperation]
    charts: list[AIChart]
    limitations: list[str]


class AIQuestion(_Out):
    question: str
    reason: str
    source_alias: Alias | None
    column: str | None


class AIAssistantReply(_Out):
    message: str
    interpreted_objective: str
    source_relationship: SourceRelationship
    questions: list[AIQuestion]
    plans: list[AIPlan]
    warnings: list[str]


def _texts(reply: AIAssistantReply) -> list[str]:
    texts = [reply.message, reply.interpreted_objective, *reply.warnings]
    for q in reply.questions:
        texts += [q.question, q.reason]
    for plan in reply.plans:
        texts += [plan.title, plan.rationale, *plan.limitations]
        texts += [op.description for op in plan.operations] + [chart.title for chart in plan.charts]
    return texts


def validate_reply(reply: AIAssistantReply, context: AIContext) -> list[str]:
    """Problemas de la respuesta frente al contexto autorizado (lista vacía = válida)."""
    columns = {s.alias: {c.name for c in s.columns} for s in context.sources}
    problems: list[str] = []

    if not reply.questions and not reply.plans:
        problems.append("La respuesta no contiene preguntas ni planes.")
    if len(reply.plans) > MAX_PLANS or len(reply.questions) > MAX_QUESTIONS:
        problems.append("La respuesta supera la cantidad máxima de planes o preguntas.")
    if any(len(text) > MAX_TEXT_CHARS for text in _texts(reply)):
        problems.append("La respuesta contiene textos demasiado extensos.")
    if any("```" in text for text in _texts(reply)):
        problems.append("La respuesta contiene bloques de código, que no se aceptan.")

    for plan in reply.plans:
        known = columns.get(plan.source_alias)
        if known is None:
            problems.append(f"El plan «{plan.title}» usa la fuente {plan.source_alias}, que no fue autorizada.")
            continue
        if len(plan.operations) > MAX_OPERATIONS_PER_PLAN or len(plan.charts) > MAX_CHARTS_PER_PLAN:
            problems.append(f"El plan «{plan.title}» supera la cantidad máxima de operaciones o gráficos.")
        used = set(plan.columns_needed)
        for op in plan.operations:
            used |= set(op.columns) | set(op.group_by)
        for chart in plan.charts:
            used |= {c for c in (chart.x, chart.y) if c}
        for name in sorted(used - known):
            problems.append(f"El plan «{plan.title}» usa la columna «{name}», que no existe en la fuente {plan.source_alias}.")

    for q in reply.questions:
        if q.source_alias is not None and q.source_alias not in columns:
            problems.append(f"Una pregunta menciona la fuente {q.source_alias}, que no fue autorizada.")
        elif q.column is not None:
            scope = columns[q.source_alias] if q.source_alias else set().union(*columns.values())
            if q.column not in scope:
                problems.append(f"Una pregunta menciona la columna «{q.column}», que no fue autorizada.")
    return problems
