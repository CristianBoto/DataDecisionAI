"""Contexto COMPACTO para interpretar resultados con la IA (Fase 5.1).

Problema que resuelve: con muchas operaciones (por ejemplo, 17 en 3 planes), el contexto completo superaba
el límite de tokens de entrada aunque los datos eran chicos. La mayor parte era estructura repetida (las
mismas claves en cada operación), filas como objetos, el resumen descriptivo que repite las mismas cifras
y medidas idénticas en varias operaciones.

Cómo se arma (determinístico, sin IA):
1. Filas como arreglos (`[clave…, valor…]`) y el título del plan una sola vez.
2. Una medida idéntica a la de otra operación (mismas dimensiones y valores) se reemplaza por una
   referencia (`repeated`): no se pierde ninguna cifra.
3. Los hechos del resumen descriptivo viajan solo cuando aportan cifras derivadas (variaciones, Pareto,
   cocientes, distribución, correlaciones) o cuando las filas no van completas.
4. Las advertencias, una sola vez cada una, con sus operaciones.
5. Si aun así no entra en el presupuesto (límite de tokens con margen), se reduce el detalle de a una
   operación por vez, siempre la más grande: primero a filas representativas («summary»: primer y último
   período, máximo y mínimo de cada serie, o los grupos mayores y menores) y después a sus hechos
   («facts»). Ninguna operación desaparece y cada reducción queda explicada (`omitted`, `coverage`).
6. Si ni así entra, no se envía nada: se pide elegir menos planes (interpretar por partes).

El contexto completo (todas las filas agregadas) queda en el backend para VERIFICAR cada cifra.
"""

from __future__ import annotations

import json

from app.core.config import Settings
from app.schemas.interpretation import (
    CompactInterpretationContext,
    CompactOperation,
    CompactPlan,
    CompactWarning,
    ContextCoverage,
    ContextOperation,
    InterpretationContext,
)
from app.services.ai_budget import CHARS_PER_TOKEN, estimate_tokens
from app.services.ai_errors import AIGatewayError
from app.services.openai_provider import INTERPRETATION_INSTRUCTIONS

# Margen sobre el límite de tokens de entrada: la estimación es aproximada.
SAFETY_MARGIN = 0.85
# Reserva para el esquema de salida estructurada que el proveedor agrega a la solicitud.
INTERPRETATION_SCHEMA_CHARS = 2400
# Filas representativas por operación resumida.
SUMMARY_TOP = 5
SUMMARY_BOTTOM = 2
SUMMARY_SERIES = 6
# Filas máximas para enviar una operación completa (más que esto se resume, con aviso).
MAX_FULL_ROWS = 40
MAX_FULL_TEMPORAL_ROWS = 120
# Operaciones cuyos hechos aportan cifras derivadas que no están en las filas.
DERIVED_FACTS = {"time_series", "variation", "pareto", "ratio", "histogram", "scatter", "roc_curve"}
LEVELS = ("full", "summary", "facts")


class ContextTooLarge(AIGatewayError):
    def __init__(self, detail: str) -> None:
        super().__init__(413, detail)


def context_char_budget(settings: Settings) -> int:
    """Caracteres disponibles para el contexto: límite con margen, menos instrucciones y esquema."""
    fixed = estimate_tokens(INTERPRETATION_INSTRUCTIONS) + INTERPRETATION_SCHEMA_CHARS // CHARS_PER_TOKEN
    tokens = int(settings.ai_max_input_tokens * SAFETY_MARGIN) - fixed
    return max(tokens, 0) * CHARS_PER_TOKEN


def _plan_of(ref: str) -> str:
    return ref.split(".")[0]


def select_plans(full: InterpretationContext, plans: list[int] | None) -> tuple[InterpretationContext, list[str]]:
    """Las operaciones de los planes elegidos (1 = P1). Devuelve el contexto y los planes excluidos."""
    all_plans = list(dict.fromkeys(_plan_of(op.ref) for op in full.operations))
    if not plans:
        return full, []
    wanted = {f"P{n}" for n in plans}
    unknown = wanted - set(all_plans)
    if unknown:
        raise AIGatewayError(422, f"No existen los planes {', '.join(sorted(unknown))} en estos resultados.")
    selected = full.model_copy(update={
        "operations": [op for op in full.operations if _plan_of(op.ref) in wanted],
        "descriptive_summary": [f for f in full.descriptive_summary if _plan_of(f.ref) in wanted],
    })
    return selected, [p for p in all_plans if p not in wanted]


def _measure_key(op: ContextOperation, index: int) -> tuple:
    m = op.measures[index]
    # Independiente del orden de las filas (un Pareto ordena por valor; una comparación, por categoría).
    values = tuple(sorted(((tuple(r.keys), r.values[index]) for r in op.rows), key=lambda kv: (kv[0], kv[1] is None, kv[1] or 0)))
    return (tuple(op.dimensions), m.column, m.aggregate, m.unit, values)


def _label(op: ContextOperation, index: int) -> str:
    m = op.measures[index]
    return f"{m.column} ({m.aggregate}{f', {m.unit}' if m.unit else ''})"


def _representative_rows(op: ContextOperation) -> tuple[list[int], str]:
    """Índices de filas representativas y la explicación de lo que no viaja."""
    rows = op.rows
    total = len(rows)
    if op.temporal_dimension in op.dimensions:
        t = op.dimensions.index(op.temporal_dimension)
        others = [i for i in range(len(op.dimensions)) if i != t]
        series: dict[tuple, list[int]] = {}
        for i, r in enumerate(rows):
            series.setdefault(tuple(r.keys[j] for j in others), []).append(i)
        ranked = sorted(series.values(), key=lambda idx: -sum(abs(rows[i].values[0] or 0) for i in idx))
        keep: set[int] = set()
        for idx in ranked[:SUMMARY_SERIES]:
            valued = [i for i in idx if rows[i].values[0] is not None] or idx
            ordered = sorted(valued, key=lambda i: rows[i].keys[t])
            keep |= {ordered[0], ordered[-1],
                     max(valued, key=lambda i: rows[i].values[0] or 0), min(valued, key=lambda i: rows[i].values[0] or 0)}
        extra = f"; de {len(series)} series, las {SUMMARY_SERIES} de mayor magnitud" if len(series) > SUMMARY_SERIES else ""
        note = (f"Se enviaron {len(keep)} de {total} filas: por serie, el primer y el último período, el máximo y el mínimo"
                f"{extra}. La IA no puede evaluar los períodos intermedios.")
        return sorted(keep), note
    order = sorted(range(total), key=lambda i: -(rows[i].values[0] or 0) if rows[i].values else 0)
    keep = sorted(set(order[:SUMMARY_TOP]) | set(order[-SUMMARY_BOTTOM:]))
    note = (f"Se enviaron {len(keep)} de {total} grupos: los {SUMMARY_TOP} mayores y los {SUMMARY_BOTTOM} menores. "
            "La IA no puede evaluar los grupos intermedios.")
    return keep, note


def _compact_operation(op: ContextOperation, level: str, facts: list[str], repeated: dict[int, str]) -> CompactOperation:
    base = dict(
        ref=op.ref, operation=op.operation, description=op.description, status=op.status, detail=level,
        dimensions=op.dimensions, temporal_dimension=op.temporal_dimension, split_dimensions=op.split_dimensions,
        period=op.period, rows_total=op.rows_total, rows_used=op.rows_used, stats=op.stats,
        signed_measures=op.signed_measures, error=op.error,
    )
    if op.status != "ok":
        return CompactOperation(**base)
    if op.rows_withheld:
        # Ni filas ni hechos: los hechos nombrarían grupos que equivalen a registros individuales.
        return CompactOperation(**{**base, "detail": "facts"},
                                omitted="Sin filas ni hechos: cada grupo correspondería a un registro individual, así que no se envían.")
    if not op.rows:  # dispersión y ROC: solo estadísticos
        return CompactOperation(**base, measures=op.measures, facts=facts)
    if level == "facts":
        return CompactOperation(**base, measures=op.measures, facts=facts,
                                omitted=f"Solo se enviaron sus hechos principales (no sus {op.rows_total} filas), por el límite de tamaño.")
    kept = [i for i in range(len(op.measures)) if i not in repeated]
    indexes, note = (list(range(len(op.rows))), None) if level == "full" else _representative_rows(op)
    rows = [[*op.rows[i].keys, *(op.rows[i].values[m] for m in kept)] for i in indexes]
    with_facts = level != "full" or op.operation in DERIVED_FACTS
    return CompactOperation(
        **base, measures=[op.measures[m] for m in kept], rows=rows, facts=facts if with_facts else [],
        repeated={_label(op, m): ref for m, ref in repeated.items()}, omitted=note,
    )


def _signature(op: ContextOperation) -> str:
    """Identidad del resultado (sin la ref ni el plan): dos operaciones iguales dan lo mismo."""
    return json.dumps([op.operation, op.status, op.dimensions, [m.model_dump() for m in op.measures],
                       [[*r.keys, *r.values] for r in op.rows], op.stats, op.error], ensure_ascii=False, sort_keys=True)


def _assemble(selected: InterpretationContext, levels: dict[str, str], excluded: list[str]) -> CompactInterpretationContext:
    facts = {f.ref: f.facts for f in selected.descriptive_summary}
    # Operaciones idénticas a una anterior: se referencian (sin perder nada).
    first: dict[str, str] = {}
    same_as: dict[str, str] = {}
    for op in selected.operations:
        signature = _signature(op)
        if signature in first:
            same_as[op.ref] = first[signature]
        else:
            first[signature] = op.ref
    # Medidas idénticas a las de una operación anterior que va completa: se referencian, no se repiten.
    seen: dict[tuple, str] = {}
    repeated: dict[str, dict[int, str]] = {}
    for op in selected.operations:
        if op.status != "ok" or not op.rows or op.rows_withheld:
            continue
        for i in range(len(op.measures)):
            key = _measure_key(op, i)
            if key in seen and levels.get(seen[key]) == "full" and op.ref not in same_as:
                repeated.setdefault(op.ref, {})[i] = seen[key]
            elif levels.get(op.ref) == "full":
                seen.setdefault(key, op.ref)
    warnings: dict[str, list[str]] = {}
    plans: dict[str, CompactPlan] = {}
    for op in selected.operations:
        plan_ref = _plan_of(op.ref)
        plan = plans.setdefault(plan_ref, CompactPlan(ref=plan_ref, title=op.plan_title, source_alias=op.source_alias, operations=[]))
        if op.ref in same_as:
            plan.operations.append(CompactOperation(ref=op.ref, operation=op.operation, description=op.description,
                                                    status=op.status, detail=levels[same_as[op.ref]], same_as=same_as[op.ref]))
        else:
            plan.operations.append(_compact_operation(op, levels[op.ref], facts.get(op.ref, []), repeated.get(op.ref, {})))
        for text in op.warnings:
            warnings.setdefault(text, []).append(op.ref)
    effective = {op.ref: levels[same_as.get(op.ref, op.ref)] for op in selected.operations}
    counts = {level: sum(1 for level_ in effective.values() if level_ == level) for level in LEVELS}
    reduced = counts["summary"] + counts["facts"]
    note = ("Contexto completo: van todos los resultados agregados de las operaciones elegidas."
            if not reduced else
            f"Resumen parcial: {counts['summary']} operaciones van con filas representativas y {counts['facts']} solo con sus "
            "hechos principales (ver «omitted» en cada una). No se pueden sacar conclusiones sobre lo que no se envió.")
    if excluded:
        note += f" No se incluyeron los planes {', '.join(excluded)}, por elección de la persona."
    return CompactInterpretationContext(
        objective=selected.objective, sources=selected.sources, plans=list(plans.values()),
        warnings=[CompactWarning(text=t, refs=refs) for t, refs in warnings.items()],
        coverage=ContextCoverage(operations=len(selected.operations), full=counts["full"], summarized=counts["summary"],
                                 facts_only=counts["facts"], plans_excluded=excluded, note=note),
    )


def _size(model) -> int:
    return len(json.dumps(model.wire() if hasattr(model, "wire") else model, ensure_ascii=False))


def compact_context(full: InterpretationContext, settings: Settings, *, plans: list[int] | None = None) -> CompactInterpretationContext:
    """Contexto compacto que entra en el presupuesto, o `ContextTooLarge` si ni resumido entra."""
    selected, excluded = select_plans(full, plans)
    budget = context_char_budget(settings)
    levels: dict[str, str] = {}
    for op in selected.operations:
        limit = MAX_FULL_TEMPORAL_ROWS if op.temporal_dimension else MAX_FULL_ROWS
        levels[op.ref] = "summary" if len(op.rows) > limit else "full"
    while True:
        compact = _assemble(selected, levels, excluded)
        if _size(compact) <= budget:
            break
        # Se reduce primero la operación que más ocupa (ninguna desaparece: la última etapa son sus hechos).
        sizes = {op.ref: len(json.dumps(op.model_dump(mode="json"), ensure_ascii=False))
                 for plan in compact.plans for op in plan.operations if op.detail != "facts" and op.rows}
        if not sizes:
            total = len(dict.fromkeys(_plan_of(op.ref) for op in full.operations))
            raise ContextTooLarge(
                "Ni siquiera el resumen compacto de estos resultados entra en el límite de la IA. No se envió nada. "
                + ("Elegí menos planes para interpretar por partes." if total > 1 else "Reducí la cantidad de operaciones del plan.")
            )
        largest = max(sizes, key=lambda ref: (sizes[ref], ref))
        levels[largest] = LEVELS[LEVELS.index(levels[largest]) + 1]
    compact._verification = selected
    return compact
