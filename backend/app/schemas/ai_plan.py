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

# Catálogo cerrado: lo único que el motor Pandas podrá ejecutar más adelante.
Operation = Literal[
    "count",
    "distinct_count",
    "sum",
    "mean",
    "median",
    "min",
    "max",
    "std",
    "percentage",
    "frequency",
    "group_by",
    "time_series",
    "top_n",
    "compare_groups",
    "correlation",
    "missing_summary",
]
ChartType = Literal["bar", "line", "pie", "histogram", "scatter", "box", "table", "kpi"]
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
