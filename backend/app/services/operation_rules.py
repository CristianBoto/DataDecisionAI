"""Reglas estadísticas de cada operación del catálogo, en UN solo lugar.

Las usan:
- la validación de los planes de la IA (`ai_plan.prune_reply`), para descartar antes de
  que la persona los apruebe las operaciones que no tienen sentido estadístico;
- el motor Pandas (`analysis_engine`), como última barrera antes de calcular.
Así un plan aprobado no llega a fallar en el motor por un tipo de columna incorrecto.

Las reglas dependen solo de metadatos revisados por la persona (tipo semántico,
aditividad, dependencia y rango de valores distintos), nunca del nombre de una
columna ni de un dataset concreto.
"""

from __future__ import annotations

from dataclasses import dataclass, field

AGGREGATES = ("sum", "mean", "median", "min", "max")
FIXED_SHAPE = {"histogram": 1, "scatter": 2, "roc_curve": 2}
# Agrupar por una columna con muchísimos valores distintos no resume nada.
TOO_MANY_GROUPS = (">500",)
FEW_VALUES = ("1", "2", "3-10")
KIND = {
    "quantitative": "cuantitativa", "categorical": "categórica", "temporal": "temporal",
    "identifier": "un código o identificador", "text": "de texto libre", "unknown": "sin interpretación",
}


@dataclass(frozen=True)
class ColumnMeta:
    semantic_type: str | None
    additivity: str | None = None
    split_by: tuple[str, ...] = field(default_factory=tuple)
    distinct_values: str | None = None  # rango ("2", "3-10", ">500"…)
    distinct_count: int | None = None  # cantidad exacta (solo en el motor; la IA ve el rango)


def grouping_columns(operation: str, columns: list[str], group_by: list[str], meta: dict[str, ColumnMeta]) -> list[str]:
    """Columnas por las que agrupa la operación (mismo criterio que el motor)."""
    if operation in ("group_by", "compare_groups"):
        return group_by or [c for c in columns if (meta.get(c) and meta[c].semantic_type) != "quantitative"]
    if operation == "time_series":
        temporal = [c for c in group_by + columns if meta.get(c) and meta[c].semantic_type == "temporal"]
        return ([temporal[0]] + [c for c in group_by if c != temporal[0]]) if temporal else list(group_by)
    if operation == "frequency":
        return group_by or columns
    return list(group_by)


def value_columns(operation: str, columns: list[str], group_by: list[str], meta: dict[str, ColumnMeta]) -> list[str]:
    groups = grouping_columns(operation, columns, group_by, meta)
    if operation in ("count", "frequency", "distinct_count"):
        return []
    return [c for c in columns if c not in groups]


def _kind(meta: ColumnMeta | None) -> str:
    return KIND.get((meta.semantic_type if meta else None) or "unknown", "sin interpretación")


def operation_problem(operation: str, columns: list[str], group_by: list[str], meta: dict[str, ColumnMeta]) -> str | None:
    """Motivo comprensible por el que la operación no tiene sentido con esas columnas, o None."""
    if operation in FIXED_SHAPE:
        return _fixed_shape_problem(operation, columns, group_by, meta)

    groups = grouping_columns(operation, columns, group_by, meta)
    values = value_columns(operation, columns, group_by, meta)

    for column in groups:
        m = meta.get(column)
        if m is None:
            continue
        if m.semantic_type == "quantitative" and m.distinct_values not in FEW_VALUES:
            return f"no se agrupa por «{column}», que es una cantidad con muchos valores (para su distribución, usá un histograma)"
        if m.semantic_type == "text" or m.distinct_values in TOO_MANY_GROUPS:
            return f"«{column}» tiene demasiados valores distintos para agrupar"

    if operation in AGGREGATES:
        if not values:
            return "no indica ninguna columna cuantitativa para calcular"
    if operation in ("group_by", "compare_groups") and not groups:
        return "no indica por qué columna agrupar"
    if operation == "time_series" and not (groups and meta.get(groups[0]) and meta[groups[0]].semantic_type == "temporal"):
        return "una evolución en el tiempo requiere una columna temporal validada (fecha, mes, trimestre o año)"
    if operation == "frequency" and not groups:
        return "las frecuencias requieren al menos una columna"
    if operation == "distinct_count" and not columns:
        return "no indica columnas"

    for column in values:
        m = meta.get(column)
        if m is None or m.semantic_type != "quantitative":
            return f"«{column}» es una columna {_kind(m)}: la operación requiere una columna cuantitativa"
    if operation == "sum":
        non_additive = [c for c in values if meta[c].additivity == "non_additive"]
        if non_additive:
            return (f"«{non_additive[0]}» no es aditiva (tasa, porcentaje, promedio, índice o stock): sumarla no tiene sentido; "
                    "usá promedio, mediana, mínimo o máximo")
    if operation == "compare_groups":
        if len(values) > 1:
            return "la comparación entre grupos usa una sola medida"
        if values and meta[values[0]].additivity == "non_additive":
            return f"«{values[0]}» no es aditiva: su participación porcentual sobre un total no tiene sentido"
    return None


def _fixed_shape_problem(operation: str, columns: list[str], group_by: list[str], meta: dict[str, ColumnMeta]) -> str | None:
    arity = FIXED_SHAPE[operation]
    if len(columns) != arity or group_by:
        return f"necesita exactamente {arity} columna(s) y ninguna agrupación"
    found = [meta.get(c) for c in columns]
    if any(m is None for m in found):
        return None  # columna inexistente: se informa aparte
    if operation in ("histogram", "scatter"):
        wrong = [(c, m) for c, m in zip(columns, found) if m.semantic_type != "quantitative"]
        if wrong:
            return f"«{wrong[0][0]}» es una columna {_kind(wrong[0][1])}: solo admite columnas cuantitativas"
    if operation == "roc_curve":
        label, score = found
        if label.distinct_count is not None and label.distinct_count != 2:
            return f"«{columns[0]}» tiene {label.distinct_count} clases: la curva ROC requiere exactamente 2 (no es binaria)"
        if label.distinct_values not in (None, "2"):
            return f"la etiqueta «{columns[0]}» no es binaria (tiene {label.distinct_values} valores distintos)"
        if score.semantic_type != "quantitative":
            return f"«{columns[1]}» es una columna {_kind(score)}: no es una puntuación numérica"
    mixed = [c for c, m in zip(columns, found) if m.split_by and m.semantic_type == "quantitative"]
    if mixed:
        depends = ", ".join(meta[mixed[0]].split_by)
        return (f"«{mixed[0]}» mide cosas distintas según «{depends}»: un {operation} mezclaría magnitudes "
                "incompatibles (agrupá por esa columna con otra operación)")
    return None
