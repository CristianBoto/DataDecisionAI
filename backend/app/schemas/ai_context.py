"""Contrato del contexto que podría enviarse a la IA externa (Fase 3B.1).

Es una LISTA BLANCA: `extra="forbid"` rechaza cualquier campo no previsto
(nombre de archivo, ejemplos, filas, vistas previas, estadísticas). Así, aunque
el navegador enviara más información, el backend no la aceptaría.

Los metadatos también pueden ser sensibles: los nombres de columna llegan acá
después de que el usuario los revisó (puede ocultarlos o renombrarlos) y el
objetivo solo después de mostrarlo para revisión.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

# "integer" y "decimal" solo aparecen cuando el usuario corrige el formato detectado.
ValueFormat = Literal["numeric", "integer", "decimal", "text", "date", "boolean", "unknown"]
SemanticType = Literal["quantitative", "categorical", "identifier", "temporal", "text", "unknown"]
Confidence = Literal["high", "medium", "low"]
# Decisión del usuario sobre marcadores como "NA" (se registra; no se aplica todavía).
MarkerDecision = Literal["pending", "treat_as_missing", "valid_value"]
# Cantidad aproximada de valores distintos de una columna (rango, nunca los valores):
# permite a la IA distinguir binarias, categorías chicas y columnas casi únicas.
DistinctRange = Literal["1", "2", "3-10", "11-50", "51-500", ">500"]
# Si una medida se puede sumar entre filas (importes, cantidades) o no (tasas, %, promedios, stocks).
Additivity = Literal["additive", "non_additive"]
MAX_SPLIT_COLUMNS = 5
# Tamaño aproximado, solo si el usuario lo incluye: nunca la cantidad exacta.
SizeRange = Literal["<1k", "1k-10k", "10k-100k", "100k-1M", ">1M"]

MAX_SOURCES = 3
MAX_COLUMNS_PER_SOURCE = 250
MAX_OBJECTIVE_CHARS = 2000
MAX_HISTORY_TURNS = 8


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class ColumnContext(_Strict):
    # Nombre revisado por el usuario (original o renombrado); no un valor de la columna.
    name: str = Field(min_length=1, max_length=120)
    format: ValueFormat
    semantic_type: SemanticType | None = None
    semantic_confidence: Confidence | None = None
    # El usuario corrigió el formato o el significado sugeridos.
    user_corrected: bool = False
    # Presente solo si la columna tiene posibles marcadores de ausencia; nunca sus valores.
    missing_markers: MarkerDecision | None = None
    # Valores distintos, por rango (aproximado y visible en la revisión de privacidad).
    distinct_values: DistinctRange | None = None
    # Metadatos de las medidas, revisados por el usuario (no son valores del dataset):
    # unidad ("ARS", "%"), si se puede sumar y de qué columnas depende su significado
    # (por ejemplo, una columna "indicador": valores de distintos indicadores no se combinan).
    unit: str | None = Field(default=None, min_length=1, max_length=24)
    additivity: Additivity | None = None
    split_by: list[str] = Field(default_factory=list, max_length=MAX_SPLIT_COLUMNS)

    @field_validator("unit")
    @classmethod
    def plain_unit(cls, value: str | None) -> str | None:
        if value is not None and any(ord(ch) < 32 for ch in value):
            raise ValueError("La unidad contiene caracteres no permitidos.")
        return value

    @field_validator("name")
    @classmethod
    def no_control_characters(cls, value: str) -> str:
        if any(ord(ch) < 32 for ch in value):
            raise ValueError("El nombre de columna contiene caracteres no permitidos.")
        return value


class HistoryTurn(_Strict):
    """Turno anterior de la conversación con la IA real (texto ya visto por el usuario)."""

    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=MAX_OBJECTIVE_CHARS)


class SourceContext(_Strict):
    alias: Literal["A", "B", "C"]
    columns: list[ColumnContext] = Field(min_length=1, max_length=MAX_COLUMNS_PER_SOURCE)
    size_range: SizeRange | None = None

    @model_validator(mode="after")
    def split_columns_exist(self) -> SourceContext:
        names = {c.name for c in self.columns}
        for column in self.columns:
            unknown = [n for n in column.split_by if n not in names or n == column.name]
            if unknown:
                raise ValueError(f"«{column.name}» depende de columnas que no se comparten: {', '.join(unknown)}.")
        return self


class AIContext(_Strict):
    version: Literal[1] = 1
    objective: str = Field(min_length=3, max_length=MAX_OBJECTIVE_CHARS)
    # Mensaje del chat que se autoriza enviar (cada mensaje requiere su propia autorización).
    message: str | None = Field(default=None, min_length=1, max_length=MAX_OBJECTIVE_CHARS)
    sources: list[SourceContext] = Field(min_length=1, max_length=MAX_SOURCES)
    # Turnos previos con la IA real: forman parte del contenido revisado y aprobado.
    history: list[HistoryTurn] = Field(default_factory=list, max_length=MAX_HISTORY_TURNS)

    @model_validator(mode="after")
    def unique_aliases(self) -> AIContext:
        aliases = [s.alias for s in self.sources]
        if len(set(aliases)) != len(aliases):
            raise ValueError("Cada fuente debe tener un alias distinto.")
        return self

    @model_validator(mode="after")
    def no_duplicated_objective(self) -> AIContext:
        # El primer mensaje suele ser el propio objetivo: no se envía dos veces.
        if self.message is not None and self.message == self.objective:
            self.message = None
        return self


class PreparedRequest(BaseModel):
    """Lo que el usuario debe ver y aprobar: el contenido exacto y su huella."""

    request_id: str
    payload: AIContext
    payload_sha256: str
    expires_in_seconds: int
    ai_enabled: bool
    external_calls_implemented: bool
    # Estimación previa (puede diferir del consumo real informado por el proveedor).
    estimated_input_tokens: int
    estimated_max_cost_usd: float | None


class AuthorizeRequest(_Strict):
    # El usuario aprueba ESTE contenido: si cambia un solo carácter, la huella no coincide.
    payload_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    confirm: Literal[True]
    # "message": solo este envío (por defecto). "conversation": además, los próximos
    # mensajes de esta conversación, con vencimiento y atados a esta frontera de privacidad.
    scope: Literal["message", "conversation"] = "message"


class AIStatus(BaseModel):
    ai_enabled: bool
    # Solo indica si hay clave configurada; nunca su valor.
    provider_configured: bool
    external_calls_implemented: bool
    model: str
    budget_usd: float
    spent_usd: float
    remaining_usd: float
    requests_used: int
    max_requests: int
    max_output_tokens: int
    conversation_ttl_minutes: int
    conversation_max_messages: int
