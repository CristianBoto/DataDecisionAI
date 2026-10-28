"""Motor de análisis con Pandas (Fases 4A y 4C: motor generalista).

Principio: **Pandas calcula, la IA interpreta y propone, el usuario confirma.**

Este módulo ejecuta los planes que la IA propuso, el backend validó y el
usuario aprobó. No interpreta texto ni ejecuta código: cada operación del
catálogo cerrado se resuelve con una función de Python escrita acá
(`OPERATIONS`). No hay `eval`, `exec`, SQL ni código del modelo.

Es GENERALISTA: no conoce nombres de columnas ni temáticas. Todo sale de la
interpretación revisada por la persona (`ColumnMapping`):
- tipo semántico (cuantitativa, categórica, temporal, código, texto);
- unidad, aditividad (se puede sumar o no) y columnas que definen qué mide cada
  valor (`split_by`, por ejemplo un "indicador" en un archivo de formato largo);
- marcadores de faltantes decididos por la persona.

Flujo de `execute_analysis`:
1. Leer cada archivo con `read_dataset` (los mismos controles que el perfilado).
2. Por cada plan aprobado: verificar la fuente y que todas sus columnas existan.
3. Por cada operación: aplicar las reglas estadísticas (`operation_rules`) y calcular.
4. Devolver tablas (dimensiones + medidas) y errores parciales comprensibles.

Reglas de agregación:
- Una medida que depende de otra columna (`split_by`) se agrupa SIEMPRE también por
  esa columna: valores de distintos indicadores o unidades nunca se suman entre sí.
- Una medida no aditiva (tasa, %, promedio, índice, stock) nunca se suma: si una
  agrupación reúne varias filas, se informa el promedio y se avisa.
- Una suma de un grupo sin ningún valor es "sin dato", no cero.
- Los períodos se agrupan con su granularidad natural (año, semestre, trimestre o mes);
  los datos diarios se resumen por mes.

Los DataFrames viven solo en memoria durante el pedido: no se modifican los
archivos originales ni se guarda nada.
"""

from __future__ import annotations

import math
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Callable

import numpy as np
import pandas as pd
from sklearn.metrics import roc_auc_score, roc_curve

from app.schemas.ai_plan import AIOperation, AIPlan
from app.schemas.analysis import (
    ColumnMapping,
    ExecutionRequest,
    ExecutionResponse,
    Measure,
    OperationResult,
    PlanResult,
    ResultRow,
    SourceRead,
)
from app.services.column_semantics import SUSPECTED_MISSING_TOKENS
from app.services.dataset_profiler import read_dataset
from app.services.measure_hints import UNIT_TOKENS
from app.services.operation_rules import ColumnMeta, grouping_columns, operation_problem, value_columns
from app.services.value_parsing import (
    GRANULARITY_LABELS,
    coarser,
    parse_decorated,
    parse_number,
    parse_periods,
    period_labels,
)

__all__ = ["parse_number", "to_dates", "execute_analysis", "OPERATIONS"]

# Filas máximas por resultado (una tabla más larga no es útil para revisar y pesa en la respuesta).
MAX_RESULT_ROWS = 500
# Si una serie tiene más períodos que esto, se agrupa con una granularidad más gruesa.
MAX_PERIODS = 60
MISSING_GROUP = "(sin dato)"
# Histograma: regla de Sturges (k = ⌈log2 n⌉ + 1), con un máximo de intervalos legible.
MAX_HISTOGRAM_BINS = 30
# Dispersión: puntos máximos a mostrar y semilla fija para que el muestreo sea reproducible.
MAX_SCATTER_POINTS = 2000
SCATTER_SEED = 42
# Unidades que no se suman entre filas aunque la medida sea aditiva en otras categorías.
NON_ADDITIVE_UNITS = frozenset({"%", "‰", "porcentaje", "tasa", "indice", "índice", "puntos", "pp"})


class PlanError(ValueError):
    """Error que impide ejecutar un plan completo (fuente o columnas inexistentes)."""


class OperationError(ValueError):
    """Error comprensible de una operación; las demás operaciones siguen."""


# --- Conversión de texto a números y fechas -----------------------------------

def to_numbers(texts: pd.Series) -> tuple[pd.Series, int, str | None]:
    """Serie de texto → números (float), cantidad de valores no convertibles y unidad común de las celdas.

    Se convierte cada valor DISTINTO una sola vez (`map` sobre los únicos): es
    equivalente a recorrer todas las filas y mucho más rápido.
    """
    present = texts.dropna()
    lookup = {value: parse_decorated(value) for value in present.unique()}
    numbers = texts.map(lambda v: lookup[v][0] if isinstance(v, str) else None).astype("float64")
    invalid = int(present.map(lambda v: lookup[v][0] is None).sum())
    units = {u for _, u in lookup.values() if u}
    return numbers, invalid, (units.pop() if len(units) == 1 else None)


def to_dates(texts: pd.Series) -> tuple[pd.Series, int]:
    """Serie de texto → inicio de cada período o fecha, y cuántos valores no se pudieron leer."""
    parsed = parse_periods(texts)
    return parsed.starts, parsed.invalid


def distinct_range(count: int) -> str:
    if count <= 2:
        return str(max(count, 1))
    if count <= 10:
        return "3-10"
    if count <= 50:
        return "11-50"
    return "51-500" if count <= 500 else ">500"


# --- Fuente preparada ------------------------------------------------------------

@dataclass
class PreparedSource:
    """Un archivo leído y la correspondencia entre los nombres del plan y sus columnas."""

    alias: str
    df: pd.DataFrame
    columns: dict[str, ColumnMapping]
    _cache: dict = field(default_factory=dict)

    def mapping(self, name: str) -> ColumnMapping:
        column = self.columns.get(name)
        if column is None:
            raise OperationError(f"La columna «{name}» no está entre las columnas autorizadas de la fuente {self.alias}.")
        return column

    def texts(self, name: str) -> pd.Series:
        """Valores como texto, con las celdas faltantes como NaN.

        Política de faltantes: la celda vacía siempre es faltante. Los marcadores
        como "NA" solo se tratan como faltantes si el usuario lo decidió en la revisión,
        igual que los valores que declaró como faltantes (por ejemplo, "-99").
        """
        key = ("texts", name)
        if key not in self._cache:
            column = self.mapping(name)
            series = self.df[column.original].astype(str).str.strip()
            missing = series.eq("")
            if column.missing_markers == "treat_as_missing":
                missing |= series.str.lower().isin(SUSPECTED_MISSING_TOKENS)
            if column.missing_values:
                missing |= series.isin({v.strip() for v in column.missing_values})
            self._cache[key] = series.mask(missing)
        return self._cache[key]

    def semantic(self, name: str) -> str | None:
        return self.mapping(name).semantic_type

    def meta(self, names: list[str]) -> dict[str, ColumnMeta]:
        """Metadatos para las reglas estadísticas (los mismos que ve la validación de la IA)."""
        result = {}
        for name in names:
            column = self.columns.get(name)
            if column is not None:
                distinct = int(self.texts(name).nunique())
                result[name] = ColumnMeta(
                    column.semantic_type, column.additivity, tuple(column.split_by), distinct_range(distinct), distinct,
                )
        return result

    def unit(self, name: str) -> str | None:
        """Unidad de la medida: la del usuario o la de las celdas. Nunca una única si depende de otra columna."""
        column = self.mapping(name)
        if column.split_by:
            return None
        if column.unit:
            return column.unit
        return self._cache.get(("numbers", name), (None, 0, None))[2]

    def numbers(self, name: str, warnings: list[str]) -> pd.Series:
        """Columna cuantitativa como números. Respeta la interpretación de la revisión."""
        semantic = self.semantic(name)
        if semantic == "identifier":
            raise OperationError(f"«{name}» es un código o identificador: no se suma ni se promedia (se puede contar o agrupar).")
        if semantic != "quantitative":
            kind = {"categorical": "categórica", "temporal": "temporal", "text": "de texto"}.get(semantic or "", "sin interpretación cuantitativa")
            raise OperationError(f"«{name}» es una columna {kind}: esta operación requiere una columna cuantitativa.")
        key = ("numbers", name)
        if key not in self._cache:
            self._cache[key] = to_numbers(self.texts(name))
        numbers, invalid, _ = self._cache[key]
        if invalid:
            hint = "" if self.mapping(name).missing_markers != "pending" else " (hay marcadores de ausencia sin decidir en la revisión)"
            warnings.append(f"«{name}»: {invalid} valores no numéricos se excluyeron del cálculo{hint}.")
        if numbers.notna().sum() == 0:
            raise OperationError(f"«{name}» no tiene valores numéricos válidos.")
        return numbers

    def group_keys(self, name: str, warnings: list[str]) -> tuple[pd.Series, str | None, bool]:
        """Etiquetas para agrupar por la columna `name`: (etiquetas, granularidad, ¿se resumieron períodos?).

        - Temporal → período con su granularidad natural (año, semestre, trimestre o mes; los días,
          por mes). Si hay demasiados períodos, se usa una granularidad más gruesa y se avisa.
        - Otras (categóricas, códigos) → el valor tal cual.
        Los faltantes y las fechas ilegibles se agrupan como "(sin dato)".
        """
        texts = self.texts(name)
        if self.semantic(name) != "temporal":
            return texts.fillna(MISSING_GROUP), None, False
        parsed = parse_periods(texts)
        if parsed.granularity is None:
            raise OperationError(f"«{name}» no tiene fechas ni períodos válidos (año, mes, trimestre o fecha) para agrupar.")
        if parsed.invalid:
            warnings.append(f"«{name}»: {parsed.invalid} fechas inválidas quedaron en el grupo «{MISSING_GROUP}».")
        if parsed.mixed:
            warnings.append(f"«{name}» mezcla períodos de distinta granularidad: se agrupó por {GRANULARITY_LABELS[parsed.granularity]}.")
        natural = parsed.granularity
        granularity = "month" if natural == "day" else natural
        while (labels := period_labels(parsed.starts, granularity)).nunique() > MAX_PERIODS and coarser(granularity):
            granularity = coarser(granularity)
        if granularity not in (natural, "month"):
            warnings.append(f"«{name}» tiene demasiados períodos: se agrupó por {GRANULARITY_LABELS[granularity]}.")
        return labels.fillna(MISSING_GROUP), granularity, granularity != natural


# --- Cálculos --------------------------------------------------------------------

def _clean(value) -> float | None:
    if value is None:
        return None
    number = float(value)
    return None if math.isnan(number) else round(number, 6)


def _table(op: AIOperation, dimensions: list[str], measures: list[Measure], frame: pd.DataFrame,
           rows_used: int, period: str | None, warnings: list[str], *,
           temporal_dimension: str | None = None, split_dimensions: list[str] | None = None) -> OperationResult:
    """Convierte un DataFrame de resultados (índice = grupos) en la tabla de respuesta."""
    rows: list[ResultRow] = []
    if dimensions:
        for keys, values in frame.iterrows():
            keys = keys if isinstance(keys, tuple) else (keys,)
            rows.append(ResultRow(keys=[str(k) for k in keys], values=[_clean(v) for v in values.tolist()]))
    else:
        rows.append(ResultRow(keys=[], values=[_clean(v) for v in frame.iloc[0].tolist()]))
    if len(rows) > MAX_RESULT_ROWS:
        warnings.append(f"Se muestran los primeros {MAX_RESULT_ROWS} grupos de {len(rows)}.")
        rows = rows[:MAX_RESULT_ROWS]
    return OperationResult(
        operation=op.operation, description=op.description, columns=op.columns, group_by=op.group_by,
        status="ok", dimensions=dimensions, measures=measures, rows=rows, period=period,
        temporal_dimension=temporal_dimension, split_dimensions=split_dimensions or [],
        rows_used=rows_used, warnings=warnings,
    )


def _non_additive_unit(values: tuple) -> bool:
    """¿La categoría de una medida dependiente indica una unidad que no se suma (%, tasa, índice)?"""
    for value in values:
        words = set(str(value).lower().replace("(", " ").replace(")", " ").split())
        if words & NON_ADDITIVE_UNITS or str(value).strip() in NON_ADDITIVE_UNITS:
            return True
    return False


def _grouped(src: PreparedSource, op: AIOperation, group_cols: list[str], value_cols: list[str],
             aggregate: str, warnings: list[str], *, implicit: bool = False) -> OperationResult:
    """Agregación general: `aggregate` de cada columna de `value_cols`, por los grupos de `group_cols`.

    `implicit=True` cuando la operación no pidió una función concreta (agrupación, serie
    temporal): una medida no aditiva se promedia en lugar de sumarse. Con aggregate="count"
    cuenta registros. Usa `DataFrame.groupby(...)`: agrupa las filas por las etiquetas y
    aplica la función a cada grupo.
    """
    # Columnas que definen qué mide cada valor: se agregan a la agrupación (nunca se combinan).
    splits: list[str] = []
    if aggregate != "count":
        for column in value_cols:
            for split in src.mapping(column).split_by:
                if split not in group_cols and split not in splits:
                    splits.append(split)
        if splits:
            names = ", ".join(f"«{s}»" for s in splits)
            warnings.append(f"Se separó por {names}: cada categoría mide algo distinto y sus valores no se combinan entre sí.")
    groups = list(group_cols) + splits

    data = pd.DataFrame(index=src.df.index)
    period, temporal_dim, summarized = None, None, False
    for column in groups:
        data[f"g:{column}"], granularity, coarse = src.group_keys(column, warnings)
        if granularity and period is None:
            period, temporal_dim, summarized = granularity, column, coarse
    group_keys = [f"g:{c}" for c in groups]

    if aggregate == "count":
        if group_keys:
            result = data.groupby(group_keys, sort=True).size().to_frame("v:registros")
        else:
            result = pd.DataFrame({"v:registros": [len(data)]})
        return _table(op, groups, [Measure(column="registros", aggregate="count")], result, int(len(data)), period, warnings,
                      temporal_dimension=temporal_dim, split_dimensions=splits)

    measures: list[Measure] = []
    columns: dict[str, pd.Series] = {}
    used = pd.Series(False, index=data.index)
    for column in value_cols:
        numbers = src.numbers(column, warnings)
        used |= numbers.notna()
        mapping = src.mapping(column)
        if mapping.split_by and mapping.unit:
            warnings.append(f"«{column}» tiene unidades distintas según {', '.join(mapping.split_by)}: no se aplica la unidad única «{mapping.unit}».")
        agg = aggregate
        if aggregate == "sum" and mapping.additivity == "non_additive" and implicit:
            agg = "mean"
        if not group_keys:
            value = getattr(numbers, agg)() if agg != "sum" else numbers.sum(min_count=1)
            columns[f"v:{column}"] = pd.Series([value])
            measures.append(Measure(column=column, aggregate=agg, unit=src.unit(column)))
            continue
        grouped = numbers.groupby([data[k] for k in group_keys], sort=True)
        counts = grouped.count()
        values = grouped.sum(min_count=1) if agg == "sum" else grouped.agg(agg)
        averaged: list[str] = []
        if agg == "sum" and splits:
            # Categorías cuya unidad no se suma (por ejemplo, "%"): promedio si el grupo reúne varias filas.
            split_positions = [groups.index(s) for s in splits]
            means = grouped.mean()
            for key in values.index:
                key_tuple = key if isinstance(key, tuple) else (key,)
                if counts[key] > 1 and _non_additive_unit(tuple(key_tuple[i] for i in split_positions)):
                    values[key] = means[key]
                    averaged.append(" / ".join(str(key_tuple[i]) for i in split_positions))
        if averaged:
            listed = ", ".join(sorted(set(averaged))[:5])
            warnings.append(f"Para {listed} se informa el promedio y no la suma: sus valores son porcentajes, tasas o índices.")
        if agg == "mean" and aggregate == "sum" and (counts > 1).any():
            warnings.append(f"«{column}» no es aditiva (tasa, porcentaje, promedio o stock): se informa el promedio de cada grupo, no la suma.")
        if summarized and mapping.additivity == "non_additive" and agg == "mean":
            warnings.append(f"«{column}»: cada período agrupado muestra el promedio de los datos originales.")
        if implicit and (counts <= 1).all():
            agg = "value"  # cada grupo tiene un solo dato: es el valor tal cual, sin agregar
        columns[f"v:{column}"] = values
        measures.append(Measure(column=column, aggregate=agg, unit=src.unit(column)))
    result = pd.DataFrame(columns)
    return _table(op, groups, measures, result, int(used.sum()), period, warnings,
                  temporal_dimension=temporal_dim, split_dimensions=splits)


def op_count(src: PreparedSource, op: AIOperation, warnings: list[str]) -> OperationResult:
    """Conteo de registros (filas), total o por grupos."""
    return _grouped(src, op, op.group_by, [], "count", warnings)


def _simple_aggregate(aggregate: str) -> Callable:
    def run(src: PreparedSource, op: AIOperation, warnings: list[str]) -> OperationResult:
        """Suma, promedio, mediana, mínimo o máximo de columnas cuantitativas (total o por grupos)."""
        values = value_columns(op.operation, op.columns, op.group_by, src.meta(op.columns + op.group_by))
        return _grouped(src, op, op.group_by, values, aggregate, warnings)
    return run


def _groups_and_values(src: PreparedSource, op: AIOperation) -> tuple[list[str], list[str]]:
    meta = src.meta(op.columns + op.group_by)
    return (grouping_columns(op.operation, op.columns, op.group_by, meta),
            value_columns(op.operation, op.columns, op.group_by, meta))


def op_group_by(src: PreparedSource, op: AIOperation, warnings: list[str]) -> OperationResult:
    """Agrupación por categorías: suma de las medidas por grupo (promedio si no son aditivas; conteo si no hay)."""
    groups, values = _groups_and_values(src, op)
    return _grouped(src, op, groups, values, "sum" if values else "count", warnings, implicit=True)


def op_compare_groups(src: PreparedSource, op: AIOperation, warnings: list[str]) -> OperationResult:
    """Comparación entre grupos: total por grupo y su participación (%) sobre el total.

    Si la medida depende de otra columna (indicador, unidad), la participación se calcula
    dentro de cada categoría de esa columna: nunca sobre un total que mezcle magnitudes.
    """
    result = op_group_by(src, op, warnings)
    if result.rows and result.measures:
        split_positions = [result.dimensions.index(s) for s in result.split_dimensions]
        totals: dict[tuple, float] = {}
        for row in result.rows:
            key = tuple(row.keys[i] for i in split_positions)
            totals[key] = totals.get(key, 0.0) + (row.values[0] or 0)
        for row in result.rows:
            total = totals[tuple(row.keys[i] for i in split_positions)]
            row.values.append(round((row.values[0] or 0) / total * 100, 4) if total else None)
        result.measures.append(Measure(column=result.measures[0].column, aggregate="share_pct", unit="%"))
        groups = len(result.rows) / max(len(totals), 1)
        if groups < 2:
            result.warnings.append("Hay un solo grupo: no hay con qué comparar.")
    return result


def op_time_series(src: PreparedSource, op: AIOperation, warnings: list[str]) -> OperationResult:
    """Serie temporal: medidas por período (con su granularidad natural), en orden cronológico."""
    groups, values = _groups_and_values(src, op)
    return _grouped(src, op, groups, values, "sum" if values else "count", warnings, implicit=True)


def op_frequency(src: PreparedSource, op: AIOperation, warnings: list[str]) -> OperationResult:
    """Frecuencias: cantidad de registros por cada valor (o combinación de valores)."""
    groups = op.group_by or op.columns
    return _grouped(src, op, groups, [], "count", warnings)


def op_distinct_count(src: PreparedSource, op: AIOperation, warnings: list[str]) -> OperationResult:
    """Cantidad de valores distintos de cada columna (sin contar faltantes), total o por grupos."""
    values = [c for c in op.columns if c not in op.group_by]
    measures = [Measure(column=c, aggregate="distinct_count") for c in values]
    if not op.group_by:
        counts = {f"v:{c}": src.texts(c).nunique() for c in values}
        return _table(op, [], measures, pd.DataFrame([counts]), int(len(src.df)), None, warnings)
    period, temporal_dim = None, None
    keys = []
    for column in op.group_by:
        labels, granularity, _ = src.group_keys(column, warnings)
        keys.append(labels)
        if granularity and period is None:
            period, temporal_dim = granularity, column
    result = pd.DataFrame({f"v:{c}": src.texts(c).groupby(keys, sort=True).nunique() for c in values})
    return _table(op, list(op.group_by), measures, result, int(len(src.df)), period, warnings, temporal_dimension=temporal_dim)


def _number_label(value: float) -> str:
    return f"{value:.6g}"


def _arity(op: AIOperation, n: int) -> list[str]:
    if len(op.columns) != n or op.group_by:
        raise OperationError(f"La operación necesita exactamente {n} columna(s) y ninguna agrupación.")
    return op.columns


def op_histogram(src: PreparedSource, op: AIOperation, warnings: list[str]) -> OperationResult:
    """Histograma: frecuencia de una columna cuantitativa en intervalos de igual ancho.

    Cantidad de intervalos por la regla de Sturges, k = ⌈log2 n⌉ + 1 (máximo 30), y
    conteo con `numpy.histogram`, que asigna cada valor a su intervalo [a, b)
    (el último incluye el máximo). Los faltantes se excluyen.
    """
    (column,) = _arity(op, 1)
    values = src.numbers(column, warnings).dropna()
    n = int(len(values))
    low, high = float(values.min()), float(values.max())
    if low == high:
        warnings.append(f"«{column}» tiene un único valor ({_number_label(low)}): el histograma tiene un solo intervalo.")
        counts, edges = np.array([n]), np.array([low, high])
    else:
        bins = min(MAX_HISTOGRAM_BINS, int(np.ceil(np.log2(n))) + 1)
        counts, edges = np.histogram(values.to_numpy(), bins=bins, range=(low, high))
    rows = []
    for i, count in enumerate(counts):
        closing = "]" if i == len(counts) - 1 else ")"
        label = f"[{_number_label(edges[i])}, {_number_label(edges[i + 1])}{closing}" if low != high else _number_label(low)
        rows.append(ResultRow(keys=[label], values=[float(count)]))
    return OperationResult(
        operation=op.operation, description=op.description, columns=op.columns, group_by=op.group_by, status="ok",
        dimensions=[column], measures=[Measure(column=column, aggregate="count")], rows=rows, rows_used=n,
        stats={"bins": int(len(counts)), "bin_width": float(edges[1] - edges[0]) if low != high else 0.0,
               "min": low, "max": high, "rule": "Sturges"},
        warnings=warnings,
    )


def op_scatter(src: PreparedSource, op: AIOperation, warnings: list[str]) -> OperationResult:
    """Dispersión entre dos columnas cuantitativas, con correlación de Pearson y de Spearman.

    - Pares completos: se descartan las filas con faltantes en alguna de las dos.
    - Correlación con `Series.corr` sobre TODOS los pares: Pearson mide asociación lineal y
      Spearman, monótona (por rangos). Ninguna implica causalidad.
    - Puntos: hasta 2.000, con `DataFrame.sample(random_state=42)` si hay más (reproducible).
    Los puntos solo viajan del backend al navegador; nunca a la IA.
    """
    x_col, y_col = _arity(op, 2)
    pairs = pd.DataFrame({"x": src.numbers(x_col, warnings), "y": src.numbers(y_col, warnings)}).dropna()
    n = int(len(pairs))
    if n < 2:
        raise OperationError("Se necesitan al menos 2 filas con valores en ambas columnas.")
    excluded = int(len(src.df)) - n
    if excluded:
        warnings.append(f"Se excluyeron {excluded} filas con valores faltantes o no numéricos en alguna de las dos columnas.")
    pearson = pairs["x"].corr(pairs["y"], method="pearson")
    spearman = pairs["x"].corr(pairs["y"], method="spearman")
    if pd.isna(pearson) or pd.isna(spearman):
        warnings.append("Una de las columnas es constante: la correlación no está definida.")
    shown = pairs if n <= MAX_SCATTER_POINTS else pairs.sample(n=MAX_SCATTER_POINTS, random_state=SCATTER_SEED)
    if n > MAX_SCATTER_POINTS:
        warnings.append(
            f"Se muestran {MAX_SCATTER_POINTS} de {n} puntos (muestra aleatoria reproducible, semilla {SCATTER_SEED}); "
            "las correlaciones usan todos los pares."
        )
    warnings.append("La correlación mide asociación (lineal en Pearson, monótona en Spearman); no implica causalidad.")
    shown = shown.sort_values(["x", "y"])
    return OperationResult(
        operation=op.operation, description=op.description, columns=op.columns, group_by=op.group_by, status="ok",
        dimensions=[], rows=[ResultRow(keys=[], values=[_clean(x), _clean(y)]) for x, y in shown.itertuples(index=False)],
        measures=[Measure(column=x_col, aggregate="value", unit=src.unit(x_col)),
                  Measure(column=y_col, aggregate="value", unit=src.unit(y_col))],
        rows_used=n,
        stats={"pearson": _clean(pearson), "spearman": _clean(spearman), "n": n, "shown": int(len(shown)),
               "sampled": n > MAX_SCATTER_POINTS},
        warnings=warnings,
    )


def op_roc_curve(src: PreparedSource, op: AIOperation, warnings: list[str]) -> OperationResult:
    """Curva ROC y AUC de un clasificador existente (no se entrena ningún modelo).

    Requiere una columna de etiquetas reales con exactamente dos clases, una columna de
    puntuaciones numéricas y la clase positiva elegida por el usuario. Usa
    `sklearn.metrics.roc_curve` (tasas de falsos y verdaderos positivos para cada
    umbral) y `sklearn.metrics.roc_auc_score` (área bajo la curva).
    """
    label_col, score_col = _arity(op, 2)
    labels = src.texts(label_col)
    classes = sorted(labels.dropna().unique().tolist())
    if len(classes) != 2:
        raise OperationError(f"«{label_col}» tiene {len(classes)} clases: la curva ROC requiere exactamente 2.")
    positive = src.mapping(label_col).positive_label
    if positive is None:
        raise OperationError(f"Elegí la clase positiva de «{label_col}» antes de ejecutar la curva ROC.")
    if positive not in classes:
        raise OperationError(f"La clase positiva elegida no es ninguna de las dos clases de «{label_col}».")
    data = pd.DataFrame({"label": labels, "score": src.numbers(score_col, warnings)}).dropna()
    excluded = int(len(src.df)) - int(len(data))
    if excluded:
        warnings.append(f"Se excluyeron {excluded} filas sin etiqueta o sin puntuación numérica.")
    y_true = (data["label"] == positive).astype(int)
    if y_true.nunique() < 2:
        raise OperationError("Después de excluir faltantes queda una sola clase: la curva ROC no está definida.")
    fpr, tpr, _ = roc_curve(y_true, data["score"])
    auc = float(roc_auc_score(y_true, data["score"]))
    points = list(zip(fpr.tolist(), tpr.tolist()))
    if len(points) > MAX_RESULT_ROWS:
        # Se conservan los extremos y puntos equiespaciados de la curva.
        keep = np.unique(np.linspace(0, len(points) - 1, MAX_RESULT_ROWS).round().astype(int))
        points = [points[i] for i in keep]
        warnings.append(f"La curva tiene muchos umbrales: se muestran {len(points)} puntos (el AUC usa todos).")
    if auc < 0.5:
        warnings.append("AUC menor que 0,5: las puntuaciones podrían estar invertidas respecto de la clase positiva elegida.")
    warnings.append("La curva evalúa puntuaciones existentes: DataDecision AI no entrenó ningún modelo.")
    negative = classes[0] if classes[1] == positive else classes[1]
    return OperationResult(
        operation=op.operation, description=op.description, columns=op.columns, group_by=op.group_by, status="ok",
        dimensions=[], rows=[ResultRow(keys=[], values=[_clean(f), _clean(t)]) for f, t in points],
        measures=[Measure(column="tasa de falsos positivos", aggregate="fpr"),
                  Measure(column="tasa de verdaderos positivos", aggregate="tpr")],
        rows_used=int(len(data)),
        stats={"auc": round(auc, 6), "positives": int(y_true.sum()), "negatives": int((1 - y_true).sum()),
               "positive_label": positive, "negative_label": negative, "n": int(len(data))},
        warnings=warnings,
    )


# Catálogo cerrado: operación del plan → función de cálculo. Debe coincidir con
# SUPPORTED_OPERATIONS (ai_plan.py), que es lo único que la IA puede proponer.
OPERATIONS: dict[str, Callable[[PreparedSource, AIOperation, list[str]], OperationResult]] = {
    "count": op_count,
    "sum": _simple_aggregate("sum"),
    "mean": _simple_aggregate("mean"),
    "median": _simple_aggregate("median"),
    "min": _simple_aggregate("min"),
    "max": _simple_aggregate("max"),
    "group_by": op_group_by,
    "compare_groups": op_compare_groups,
    "time_series": op_time_series,
    "frequency": op_frequency,
    "distinct_count": op_distinct_count,
    "histogram": op_histogram,
    "scatter": op_scatter,
    "roc_curve": op_roc_curve,
}


def run_operation(src: PreparedSource, op: AIOperation) -> OperationResult:
    warnings: list[str] = []
    runner = OPERATIONS.get(op.operation)
    try:
        if runner is None:
            raise OperationError(f"La operación «{op.operation}» todavía no está disponible en el motor de cálculo.")
        for column in op.columns + op.group_by:
            src.mapping(column)
        # Mismas reglas que validaron el plan de la IA: última barrera antes de calcular.
        problem = operation_problem(op.operation, op.columns, op.group_by, src.meta(op.columns + op.group_by))
        if problem:
            raise OperationError(problem[0].upper() + problem[1:] + ".")
        return runner(src, op, warnings)
    except OperationError as exc:
        return OperationResult(
            operation=op.operation, description=op.description, columns=op.columns, group_by=op.group_by,
            status="error", warnings=warnings, error=str(exc),
        )


def _plan_columns(plan: AIPlan) -> set[str]:
    used = set(plan.columns_needed)
    for op in plan.operations:
        used |= set(op.columns) | set(op.group_by)
    return used


def _timed_out(op: AIOperation, limit: float) -> OperationResult:
    return OperationResult(
        operation=op.operation, description=op.description, columns=op.columns, group_by=op.group_by, status="error",
        error=f"No se calculó: se alcanzó el tiempo máximo de procesamiento ({limit:g} s). Reducí la cantidad de "
        "operaciones o el tamaño del archivo.",
    )


def run_plan(plan_id: str, plan: AIPlan, sources: dict[str, PreparedSource], *,
             deadline: float | None = None, time_limit: float | None = None, clock=time.monotonic) -> PlanResult:
    """Ejecuta un plan aprobado sobre SU fuente. Nunca une ni relaciona fuentes.

    Con `deadline`, las operaciones que empezarían después de ese instante no se calculan (tiempo máximo
    cooperativo: una operación en curso no se interrumpe, pero no empieza ninguna más).
    """
    charts = [c.model_dump() for c in plan.charts]
    src = sources.get(plan.source_alias)
    if src is None:
        return PlanResult(plan_id=plan_id, source_alias=plan.source_alias, title=plan.title, status="error",
                          operations=[], charts=charts,
                          warnings=[f"No se recibió el archivo de la fuente {plan.source_alias}."])
    missing = sorted(_plan_columns(plan) - set(src.columns))
    if missing:
        return PlanResult(plan_id=plan_id, source_alias=plan.source_alias, title=plan.title, status="error",
                          operations=[], charts=charts,
                          warnings=[f"El plan usa columnas que ya no están autorizadas: {', '.join(missing)}."])
    operations = [
        _timed_out(op, time_limit or 0) if deadline is not None and clock() > deadline else run_operation(src, op)
        for op in plan.operations
    ]
    failed = sum(op.status == "error" for op in operations)
    status = "ok" if failed == 0 else ("error" if failed == len(operations) else "partial")
    return PlanResult(plan_id=plan_id, source_alias=plan.source_alias, title=plan.title, status=status,
                      operations=operations, charts=charts, warnings=list(plan.limitations))


def prepare_source(alias: str, content: bytes, filename: str, columns: list[ColumnMapping], *,
                   max_bytes: int | None = None, max_cells: int | None = None) -> PreparedSource:
    """Lee el archivo (mismos controles que el perfilado) y verifica la correspondencia de columnas."""
    df, *_ = read_dataset(content, filename, max_bytes=max_bytes, max_cells=max_cells)
    mapping = {c.name: c for c in columns}
    absent = sorted({c.original for c in columns} - set(df.columns))
    if absent:
        raise PlanError(f"El archivo de la fuente {alias} no tiene las columnas {', '.join(absent)}: ¿se cargó otro archivo?")
    return PreparedSource(alias=alias, df=df, columns=mapping)


def execute_analysis(request: ExecutionRequest, plans: list[tuple[str, AIPlan]],
                     files: dict[str, tuple[bytes, str]], *, max_bytes: int | None = None,
                     max_cells: int | None = None, max_total_cells: int | None = None,
                     time_limit_seconds: float | None = None, clock=time.monotonic) -> dict:
    """Punto de entrada del motor: planes aprobados + archivos + correspondencias → resultados.

    `max_total_cells` acota la suma de celdas de todos los archivos de una ejecución (memoria) y
    `time_limit_seconds`, el tiempo de procesamiento (las operaciones pendientes se informan como no calculadas).
    """
    start = clock()
    mappings = {s.alias: s.columns for s in request.sources}
    sources: dict[str, PreparedSource] = {}
    total_cells = 0
    for alias, (content, filename) in files.items():
        if alias in mappings:
            sources[alias] = prepare_source(alias, content, filename, mappings[alias],
                                            max_bytes=max_bytes, max_cells=max_cells)
            total_cells += int(sources[alias].df.size)
            if max_total_cells is not None and total_cells > max_total_cells:
                limit = f"{max_total_cells:,}".replace(",", ".")
                raise PlanError(f"Los archivos de este análisis suman más de {limit} celdas, el máximo por ejecución. "
                                "Ejecutá los planes de cada fuente por separado o usá archivos más chicos.")
    deadline = start + time_limit_seconds if time_limit_seconds else None
    results = [run_plan(plan_id, plan, sources, deadline=deadline, time_limit=time_limit_seconds, clock=clock)
               for plan_id, plan in plans]
    return ExecutionResponse(
        executed_at=datetime.now(timezone.utc).isoformat(timespec="seconds"),
        sources=[SourceRead(alias=a, rows=int(s.df.shape[0]), columns=int(s.df.shape[1])) for a, s in sources.items()],
        results=results,
        notes=[
            "Calculado con Pandas en el backend de DataDecision AI, sobre una copia en memoria de cada archivo, que se descarta al terminar.",
            "La IA no participó del cálculo ni recibió los datos.",
            "Cada plan usa una sola fuente: las fuentes no se unieron ni relacionaron.",
        ],
    ).model_dump(mode="json")
