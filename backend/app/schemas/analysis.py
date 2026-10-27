"""Contratos del motor de análisis (Fase 4A).

Pedido: qué planes aprobados ejecutar y cómo se corresponden los nombres que
vio la IA con las columnas reales de cada archivo (el usuario pudo renombrarlas
o reinterpretarlas en la revisión). Los archivos viajan aparte, en el mismo
envío multipart, y no se guardan.

Respuesta: resultados numéricos en forma de tabla (dimensiones + medidas),
listos para que el frontend los muestre en tablas o gráficos. No hay texto
generado ni conclusiones: solo lo que calculó Pandas.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.schemas.ai_context import MAX_SOURCES, MAX_SPLIT_COLUMNS, Additivity, MarkerDecision, SemanticType


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class ColumnMapping(_Strict):
    # Nombre que vio la IA (y que usa el plan).
    name: str = Field(min_length=1, max_length=120)
    # Nombre real de la columna en el archivo.
    original: str = Field(min_length=1, max_length=250)
    # Interpretación final de la revisión (la del usuario si la corrigió).
    semantic_type: SemanticType | None = None
    # Decisión del usuario sobre marcadores como "NA".
    missing_markers: MarkerDecision | None = None
    # Unidad indicada por el usuario (por ejemplo, "ARS"). Si la medida depende de otra
    # columna (split_by), no se aplica una unidad única: la indica cada categoría.
    unit: str | None = Field(default=None, max_length=24)
    # ¿Se puede sumar entre filas? None = sin decidir (se trata como aditiva).
    additivity: Additivity | None = None
    # Columnas que definen qué mide cada valor: los valores de distintas categorías nunca se combinan.
    split_by: list[str] = Field(default_factory=list, max_length=MAX_SPLIT_COLUMNS)
    # Valores que el usuario declaró como faltantes (por ejemplo, "-99"). Son valores del
    # dataset: viajan solo a este backend, nunca a la IA.
    missing_values: list[str] = Field(default_factory=list, max_length=20)
    # Clase positiva elegida por el usuario para una columna de etiquetas (curva ROC).
    # Es un valor del dataset: viaja solo a este backend, nunca a la IA.
    positive_label: str | None = Field(default=None, min_length=1, max_length=250)


class SourceMapping(_Strict):
    alias: Literal["A", "B", "C"]
    columns: list[ColumnMapping] = Field(min_length=1, max_length=250)

    @model_validator(mode="after")
    def split_columns_exist(self) -> SourceMapping:
        names = {c.name for c in self.columns}
        for column in self.columns:
            if any(n not in names or n == column.name for n in column.split_by):
                raise ValueError(f"«{column.name}» depende de columnas que no están en la fuente {self.alias}.")
            if any(len(v) > 50 for v in column.missing_values):
                raise ValueError("Un valor faltante declarado es demasiado largo.")
        return self


class ExecutionRequest(_Strict):
    plan_ids: list[str] = Field(min_length=1, max_length=6)
    sources: list[SourceMapping] = Field(min_length=1, max_length=MAX_SOURCES)

    @model_validator(mode="after")
    def unique(self) -> ExecutionRequest:
        if len(set(self.plan_ids)) != len(self.plan_ids):
            raise ValueError("Hay planes repetidos.")
        aliases = [s.alias for s in self.sources]
        if len(set(aliases)) != len(aliases):
            raise ValueError("Cada fuente debe tener un alias distinto.")
        return self


class Measure(BaseModel):
    column: str
    # count | sum | mean | median | min | max | distinct_count | share_pct | value | fpr | tpr
    aggregate: str
    unit: str | None = None


class ResultRow(BaseModel):
    # Valores de las dimensiones (por ejemplo, ["2026-01"] o ["Tecnologia"]).
    keys: list[str]
    # Un valor por medida, en el mismo orden que `measures`.
    values: list[float | None]


class OperationResult(BaseModel):
    operation: str
    description: str
    columns: list[str]
    group_by: list[str]
    status: Literal["ok", "error"]
    dimensions: list[str] = []
    measures: list[Measure] = []
    rows: list[ResultRow] = []
    # Período de las agrupaciones temporales (si hubo) y qué dimensión es la temporal.
    period: Literal["day", "month", "quarter", "semester", "year"] | None = None
    temporal_dimension: str | None = None
    # Dimensiones que definen QUÉ se mide (indicador, unidad): no se mezclan en un mismo eje.
    split_dimensions: list[str] = []
    # Filas que entraron en el cálculo.
    rows_used: int | None = None
    # Estadísticos de la operación (correlaciones, AUC, cantidad de intervalos…), si corresponde.
    stats: dict[str, float | int | str | bool | None] | None = None
    warnings: list[str] = []
    error: str | None = None


class PlanResult(BaseModel):
    plan_id: str
    source_alias: str
    title: str
    status: Literal["ok", "partial", "error"]
    operations: list[OperationResult]
    # Gráficos sugeridos en el plan aprobado (no se inventan otros).
    charts: list[dict]
    warnings: list[str] = []


class SourceRead(BaseModel):
    alias: str
    rows: int
    columns: int


class ExecutionResponse(BaseModel):
    engine: Literal["pandas"] = "pandas"
    executed_at: str
    sources: list[SourceRead]
    results: list[PlanResult]
    notes: list[str]
