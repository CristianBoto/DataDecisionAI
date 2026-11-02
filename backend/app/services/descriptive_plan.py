"""Plan descriptivo SIN IA (Fase 5): análisis básico calculable sin autorizar envíos a OpenAI.

Se arma con reglas a partir de los metadatos que la persona revisó (tipo semántico, aditividad,
dependencia y rango de valores distintos), nunca con nombres de columnas ni con valores. Pasa por la
misma validación que los planes de la IA (`prune_reply`) y se aprueba, confirma y ejecuta igual.
No interpreta el objetivo: es un punto de partida cuando la IA no está disponible o no se autoriza.
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.ai_context import MAX_SOURCES, AIContext, SourceContext
from app.schemas.ai_plan import AIAssistantReply, prune_reply

FEW_GROUPS = ("2", "3-10", "11-50")
MAX_MEASURES = 3


class DescriptivePlanRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    sources: list[SourceContext] = Field(min_length=1, max_length=MAX_SOURCES)


def _op(operation: str, columns: list[str], group_by: list[str], description: str) -> dict:
    return {"operation": operation, "columns": columns, "group_by": group_by, "description": description}


def _source_plan(source: SourceContext) -> dict | None:
    columns = source.columns
    measures = [c.name for c in columns if c.semantic_type == "quantitative" and not c.split_by][:MAX_MEASURES]
    additive = [c.name for c in columns if c.name in measures and c.additivity != "non_additive"]
    temporal = next((c.name for c in columns if c.semantic_type == "temporal"), None)
    category = next((c.name for c in columns if c.semantic_type == "categorical" and c.distinct_values in FEW_GROUPS), None)

    operations = [_op("count", [], [], "Cantidad de registros")]
    if additive:
        operations.append(_op("sum", additive, [], "Totales"))
    if measures:
        operations += [
            _op("mean", measures, [], "Promedios"),
            _op("median", measures, [], "Medianas"),
            _op("std", measures, [], "Desvíos estándar"),
        ]
    if temporal:
        values = additive[:1]
        operations.append(_op("time_series", [temporal, *values], [], f"Evolución por {temporal}"))
    if category:
        if additive:
            operations.append(_op("compare_groups", additive[:1], [category], f"{additive[0]} por {category}"))
        else:
            operations.append(_op("frequency", [category], [], f"Registros por {category}"))
    if measures:
        operations.append(_op("histogram", [measures[0]], [], f"Distribución de {measures[0]}"))
    used = sorted({c for op in operations for c in op["columns"] + op["group_by"]})
    return {
        "source_alias": source.alias,
        "title": f"Descripción general · fuente {source.alias}",
        "rationale": "Resumen descriptivo calculado con reglas a partir de los tipos de columna que revisaste, sin IA.",
        "columns_needed": used,
        "operations": operations,
        "charts": [],
        "limitations": [
            "Plan generado por reglas, sin IA: no interpreta tu objetivo ni elige las comparaciones más útiles. "
            "Para un análisis a medida, conversá con el asistente."
        ],
    }


def descriptive_reply(request: DescriptivePlanRequest) -> tuple[AIAssistantReply, list[str]]:
    """Plan descriptivo validado con las mismas reglas que los de la IA (una fuente por plan)."""
    plans = [p for p in (_source_plan(s) for s in request.sources) if p]
    reply = AIAssistantReply.model_validate({
        "message": "Propuesta descriptiva automática, armada sin IA con los tipos de columna que revisaste. "
                   "Revisala y, si te sirve, confirmala.",
        "interpreted_objective": "Describir los datos: cantidad de registros, totales, promedios, dispersión, evolución y distribución.",
        "feasibility": "partial",
        "missing_data": [],
        "decisions": ["Conocer el panorama general de los datos antes de definir una pregunta concreta."],
        "source_relationship": "independent" if len(plans) > 1 else "single",
        "questions": [],
        "plans": plans,
        "warnings": ["Generado sin IA: no se envió nada a OpenAI."],
    })
    context = AIContext.model_validate({"objective": "Análisis descriptivo sin IA", "sources": [s.model_dump() for s in request.sources]})
    return prune_reply(reply, context)
