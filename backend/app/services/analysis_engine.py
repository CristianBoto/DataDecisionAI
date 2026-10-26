"""Motor de análisis con Pandas (Fase 4A).

Principio: **Pandas calcula, la IA interpreta y propone, el usuario confirma.**

Este módulo ejecuta los planes que la IA propuso, el backend validó y el
usuario aprobó. No interpreta texto ni ejecuta código: cada operación del
catálogo cerrado se resuelve con una función de Python escrita acá
(`OPERATIONS`). No hay `eval`, `exec`, SQL ni código del modelo.

Flujo de `execute_analysis`:
1. Leer cada archivo con `read_dataset` (los mismos controles que el perfilado).
2. Por cada plan aprobado: verificar la fuente y que todas sus columnas existan.
3. Por cada operación: validar tipos y decisiones de la revisión, y calcular.
4. Devolver tablas (dimensiones + medidas) y errores parciales comprensibles.

Los DataFrames viven solo en memoria durante el pedido: no se modifican los
archivos originales ni se guarda nada.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Callable

import pandas as pd

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

# Filas máximas por resultado (una tabla más larga no es útil para revisar y pesa en la respuesta).
MAX_RESULT_ROWS = 500
# Si las fechas abarcan más de este número de meses, las series se agrupan por año.
MAX_MONTHS_FOR_MONTHLY = 36
# Formatos de fecha aceptados (se elige el que interpreta más valores).
DATE_FORMATS = ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%Y/%m/%d", "%Y-%m", "%m/%Y", "%Y-%m-%d %H:%M:%S", "%d/%m/%Y %H:%M")
MISSING_GROUP = "(sin dato)"

# Patrones numéricos: "15000", "-3.5", "15.000" (miles), "1.234,56", "1,234.56".
_THOUSANDS_DOT = re.compile(r"[-+]?\d{1,3}(?:\.\d{3})+")
_THOUSANDS_COMMA = re.compile(r"[-+]?\d{1,3}(?:,\d{3})+")
_PLAIN = re.compile(r"[-+]?\d+(?:[.,]\d+)?")
_MIXED = re.compile(r"[-+]?\d{1,3}(?:[.,]\d{3})*[.,]\d+")


class PlanError(ValueError):
    """Error que impide ejecutar un plan completo (fuente o columnas inexistentes)."""


class OperationError(ValueError):
    """Error comprensible de una operación; las demás operaciones siguen."""


# --- Conversión de texto a números y fechas -----------------------------------

def parse_number(text: str) -> float | None:
    """Convierte un texto a número aceptando separadores de miles y decimales.

    "15000" → 15000; "15.000" → 15000 (miles); "1.234,56" → 1234.56;
    "1,234.56" → 1234.56; "3,5" → 3.5. Devuelve None si no es un número.
    """
    value = text.strip().replace(" ", "")
    if not value:
        return None
    if _THOUSANDS_DOT.fullmatch(value):
        return float(value.replace(".", ""))
    if _THOUSANDS_COMMA.fullmatch(value):
        return float(value.replace(",", ""))
    if _MIXED.fullmatch(value) and "." in value and "," in value:
        # El último separador es el decimal; el otro, de miles.
        decimal = "," if value.rfind(",") > value.rfind(".") else "."
        thousands = "." if decimal == "," else ","
        return float(value.replace(thousands, "").replace(decimal, "."))
    if _PLAIN.fullmatch(value):
        return float(value.replace(",", "."))
    return None


def to_numbers(texts: pd.Series) -> tuple[pd.Series, int]:
    """Serie de texto → serie numérica (float). Devuelve también cuántos valores no se pudieron convertir.

    Se convierte cada valor DISTINTO una sola vez (`map` sobre los únicos): es
    equivalente a recorrer todas las filas y mucho más rápido.
    """
    present = texts.dropna()
    lookup = {value: parse_number(value) for value in present.unique()}
    numbers = texts.map(lambda v: lookup.get(v) if isinstance(v, str) else None).astype("float64")
    invalid = int(present.map(lambda v: lookup[v] is None).sum())
    return numbers, invalid


def to_dates(texts: pd.Series) -> tuple[pd.Series, int]:
    """Serie de texto → fechas (`pd.to_datetime` con formato explícito).

    Se prueba cada formato de `DATE_FORMATS` y se usa el que interpreta más
    valores; los que no coinciden quedan como NaT y se informan.
    """
    present = texts.dropna()
    best, best_ok = pd.Series(pd.NaT, index=texts.index, dtype="datetime64[ns]"), -1
    for fmt in DATE_FORMATS:
        parsed = pd.to_datetime(texts, format=fmt, errors="coerce")
        ok = int(parsed.notna().sum())
        if ok > best_ok:
            best, best_ok = parsed, ok
        if ok == len(present):
            break
    return best, len(present) - max(best_ok, 0)


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
        como "NA" solo se tratan como faltantes si el usuario lo decidió en la revisión.
        """
        key = ("texts", name)
        if key not in self._cache:
            column = self.mapping(name)
            series = self.df[column.original].astype(str).str.strip()
            missing = series.eq("")
            if column.missing_markers == "treat_as_missing":
                missing |= series.str.lower().isin(SUSPECTED_MISSING_TOKENS)
            self._cache[key] = series.mask(missing)
        return self._cache[key]

    def semantic(self, name: str) -> str | None:
        return self.mapping(name).semantic_type

    def unit(self, name: str) -> str | None:
        return self.mapping(name).unit

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
        numbers, invalid = self._cache[key]
        if invalid:
            hint = "" if self.mapping(name).missing_markers != "pending" else " (hay marcadores de ausencia sin decidir en la revisión)"
            warnings.append(f"«{name}»: {invalid} valores no numéricos se excluyeron del cálculo{hint}.")
        if numbers.notna().sum() == 0:
            raise OperationError(f"«{name}» no tiene valores numéricos válidos.")
        return numbers

    def group_keys(self, name: str, warnings: list[str]) -> tuple[pd.Series, str | None]:
        """Etiquetas para agrupar por la columna `name`.

        - Temporal con fechas → período "AAAA-MM" (o "AAAA" si abarca muchos años).
        - Temporal con años enteros (por ejemplo, 2024) → el año.
        - Otras (categóricas, texto, códigos) → el valor tal cual.
        Los faltantes se agrupan como "(sin dato)".
        """
        texts = self.texts(name)
        if self.semantic(name) != "temporal":
            return texts.fillna(MISSING_GROUP), None
        years = texts.str.fullmatch(r"\d{4}")
        if years.fillna(False).sum() == texts.notna().sum():
            return texts.fillna(MISSING_GROUP), "year"
        dates, invalid = to_dates(texts)
        if dates.notna().sum() == 0:
            raise OperationError(f"«{name}» no tiene fechas válidas para agrupar por período.")
        if invalid:
            warnings.append(f"«{name}»: {invalid} fechas inválidas quedaron en el grupo «{MISSING_GROUP}».")
        months = (dates.max().year - dates.min().year) * 12 + dates.max().month - dates.min().month + 1
        period = "year" if months > MAX_MONTHS_FOR_MONTHLY else "month"
        labels = dates.dt.strftime("%Y" if period == "year" else "%Y-%m")
        return labels.where(dates.notna(), MISSING_GROUP), period


# --- Cálculos --------------------------------------------------------------------

def _clean(value) -> float | None:
    if value is None:
        return None
    number = float(value)
    return None if math.isnan(number) else round(number, 6)


def _table(op: AIOperation, dimensions: list[str], measures: list[Measure], frame: pd.DataFrame,
           rows_used: int, period: str | None, warnings: list[str]) -> OperationResult:
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
        rows_used=rows_used, warnings=warnings,
    )


def _grouped(src: PreparedSource, op: AIOperation, group_cols: list[str], value_cols: list[str],
             aggregate: str, warnings: list[str]) -> OperationResult:
    """Agregación general: `aggregate` de cada columna de `value_cols`, por los grupos de `group_cols`.

    Con aggregate="count" cuenta registros. Usa `DataFrame.groupby(...).agg(...)`:
    agrupa las filas por las etiquetas y aplica la función a cada grupo.
    """
    data = pd.DataFrame(index=src.df.index)
    period = None
    for column in group_cols:
        data[f"g:{column}"], column_period = src.group_keys(column, warnings)
        period = period or column_period
    measures: list[Measure] = []
    if aggregate == "count":
        data["v:registros"] = 1
        measures.append(Measure(column="registros", aggregate="count"))
    else:
        for column in value_cols:
            data[f"v:{column}"] = src.numbers(column, warnings)
            measures.append(Measure(column=column, aggregate=aggregate, unit=src.unit(column)))
    value_keys = [c for c in data.columns if c.startswith("v:")]
    group_keys = [c for c in data.columns if c.startswith("g:")]
    rows_used = int(len(data)) if aggregate == "count" else int(data[value_keys].notna().any(axis=1).sum())

    if group_keys:
        result = data.groupby(group_keys, sort=True)[value_keys].agg(aggregate)
    else:
        result = data[value_keys].agg(aggregate).to_frame().T
    return _table(op, group_cols, measures, result, rows_used, period, warnings)


def _quantitative(src: PreparedSource, columns: list[str]) -> list[str]:
    return [c for c in columns if src.semantic(c) == "quantitative"]


def op_count(src: PreparedSource, op: AIOperation, warnings: list[str]) -> OperationResult:
    """Conteo de registros (filas), total o por grupos."""
    return _grouped(src, op, op.group_by, [], "count", warnings)


def _simple_aggregate(aggregate: str) -> Callable:
    def run(src: PreparedSource, op: AIOperation, warnings: list[str]) -> OperationResult:
        """Suma, promedio, mediana, mínimo o máximo de columnas cuantitativas (total o por grupos)."""
        values = [c for c in op.columns if c not in op.group_by]
        if not values:
            raise OperationError("La operación no indica ninguna columna cuantitativa para calcular.")
        return _grouped(src, op, op.group_by, values, aggregate, warnings)
    return run


def op_group_by(src: PreparedSource, op: AIOperation, warnings: list[str]) -> OperationResult:
    """Agrupación por categorías: suma de las columnas cuantitativas por grupo (o conteo si no hay)."""
    groups = op.group_by or [c for c in op.columns if src.semantic(c) != "quantitative"]
    if not groups:
        raise OperationError("La agrupación no indica por qué columna agrupar.")
    values = _quantitative(src, [c for c in op.columns if c not in groups])
    ignored = [c for c in op.columns if c not in groups and c not in values]
    if ignored:
        warnings.append(f"No se agregan columnas no cuantitativas: {', '.join(ignored)}.")
    return _grouped(src, op, groups, values, "sum" if values else "count", warnings)


def op_compare_groups(src: PreparedSource, op: AIOperation, warnings: list[str]) -> OperationResult:
    """Comparación entre grupos: total por grupo y su participación (%) sobre el total."""
    result = op_group_by(src, op, warnings)
    if result.rows and result.measures:
        total = sum(row.values[0] or 0 for row in result.rows)
        for row in result.rows:
            row.values.append(round((row.values[0] or 0) / total * 100, 4) if total else None)
        result.measures.append(Measure(column=result.measures[0].column, aggregate="share_pct", unit="%"))
        if len(result.rows) < 2:
            result.warnings.append("Hay un solo grupo: no hay con qué comparar.")
    return result


def op_time_series(src: PreparedSource, op: AIOperation, warnings: list[str]) -> OperationResult:
    """Serie temporal: suma de las columnas cuantitativas por período (mes o año), en orden cronológico."""
    candidates = op.group_by + [c for c in op.columns if c not in op.group_by]
    temporal = [c for c in candidates if src.semantic(c) == "temporal"]
    if not temporal:
        raise OperationError("La serie temporal requiere una columna temporal (fecha, mes o año).")
    groups = [temporal[0]] + [c for c in op.group_by if c != temporal[0]]
    values = _quantitative(src, [c for c in op.columns if c not in groups])
    return _grouped(src, op, groups, values, "sum" if values else "count", warnings)


def op_frequency(src: PreparedSource, op: AIOperation, warnings: list[str]) -> OperationResult:
    """Frecuencias: cantidad de registros por cada valor (o combinación de valores)."""
    groups = op.group_by or op.columns
    if not groups:
        raise OperationError("Las frecuencias requieren al menos una columna.")
    return _grouped(src, op, groups, [], "count", warnings)


def op_distinct_count(src: PreparedSource, op: AIOperation, warnings: list[str]) -> OperationResult:
    """Cantidad de valores distintos de cada columna (sin contar faltantes)."""
    if not op.columns:
        raise OperationError("La operación no indica columnas.")
    counts = {f"v:{c}": src.texts(c).nunique() for c in op.columns}
    measures = [Measure(column=c, aggregate="distinct_count") for c in op.columns]
    return _table(op, [], measures, pd.DataFrame([counts]), int(len(src.df)), None, warnings)


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
}


def run_operation(src: PreparedSource, op: AIOperation) -> OperationResult:
    warnings: list[str] = []
    runner = OPERATIONS.get(op.operation)
    try:
        if runner is None:
            raise OperationError(f"La operación «{op.operation}» todavía no está disponible en el motor de cálculo.")
        for column in op.columns + op.group_by:
            src.mapping(column)
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


def run_plan(plan_id: str, plan: AIPlan, sources: dict[str, PreparedSource]) -> PlanResult:
    """Ejecuta un plan aprobado sobre SU fuente. Nunca une ni relaciona fuentes."""
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
    operations = [run_operation(src, op) for op in plan.operations]
    failed = sum(op.status == "error" for op in operations)
    status = "ok" if failed == 0 else ("error" if failed == len(operations) else "partial")
    return PlanResult(plan_id=plan_id, source_alias=plan.source_alias, title=plan.title, status=status,
                      operations=operations, charts=charts, warnings=list(plan.limitations))


def prepare_source(alias: str, content: bytes, filename: str, columns: list[ColumnMapping]) -> PreparedSource:
    """Lee el archivo (mismos controles que el perfilado) y verifica la correspondencia de columnas."""
    df, *_ = read_dataset(content, filename)
    mapping = {c.name: c for c in columns}
    absent = sorted({c.original for c in columns} - set(df.columns))
    if absent:
        raise PlanError(f"El archivo de la fuente {alias} no tiene las columnas {', '.join(absent)}: ¿se cargó otro archivo?")
    return PreparedSource(alias=alias, df=df, columns=mapping)


def execute_analysis(request: ExecutionRequest, plans: list[tuple[str, AIPlan]],
                     files: dict[str, tuple[bytes, str]]) -> dict:
    """Punto de entrada del motor: planes aprobados + archivos + correspondencias → resultados."""
    mappings = {s.alias: s.columns for s in request.sources}
    sources: dict[str, PreparedSource] = {}
    for alias, (content, filename) in files.items():
        if alias in mappings:
            sources[alias] = prepare_source(alias, content, filename, mappings[alias])
    results = [run_plan(plan_id, plan, sources) for plan_id, plan in plans]
    return ExecutionResponse(
        executed_at=datetime.now(timezone.utc).isoformat(timespec="seconds"),
        sources=[SourceRead(alias=a, rows=int(s.df.shape[0]), columns=int(s.df.shape[1])) for a, s in sources.items()],
        results=results,
        notes=[
            "Calculado con Pandas en el backend local, sobre una copia en memoria de cada archivo.",
            "La IA no participó del cálculo ni recibió los datos.",
            "Cada plan usa una sola fuente: las fuentes no se unieron ni relacionaron.",
        ],
    ).model_dump(mode="json")
