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

ValueFormat = Literal["numeric", "text", "date", "boolean", "unknown"]
SemanticType = Literal["quantitative", "categorical", "identifier", "temporal", "text", "unknown"]
Confidence = Literal["high", "medium", "low"]
# Tamaño aproximado, solo si el usuario lo incluye: nunca la cantidad exacta.
SizeRange = Literal["<1k", "1k-10k", "10k-100k", "100k-1M", ">1M"]

MAX_SOURCES = 3
MAX_COLUMNS_PER_SOURCE = 250
MAX_OBJECTIVE_CHARS = 2000


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class ColumnContext(_Strict):
    # Nombre revisado por el usuario (original o renombrado); no un valor de la columna.
    name: str = Field(min_length=1, max_length=120)
    format: ValueFormat
    semantic_type: SemanticType | None = None
    semantic_confidence: Confidence | None = None

    @field_validator("name")
    @classmethod
    def no_control_characters(cls, value: str) -> str:
        if any(ord(ch) < 32 for ch in value):
            raise ValueError("El nombre de columna contiene caracteres no permitidos.")
        return value


class SourceContext(_Strict):
    alias: Literal["A", "B", "C"]
    columns: list[ColumnContext] = Field(min_length=1, max_length=MAX_COLUMNS_PER_SOURCE)
    size_range: SizeRange | None = None


class AIContext(_Strict):
    version: Literal[1] = 1
    objective: str = Field(min_length=3, max_length=MAX_OBJECTIVE_CHARS)
    sources: list[SourceContext] = Field(min_length=1, max_length=MAX_SOURCES)

    @model_validator(mode="after")
    def unique_aliases(self) -> AIContext:
        aliases = [s.alias for s in self.sources]
        if len(set(aliases)) != len(aliases):
            raise ValueError("Cada fuente debe tener un alias distinto.")
        return self


class PreparedRequest(BaseModel):
    """Lo que el usuario debe ver y aprobar: el contenido exacto y su huella."""

    request_id: str
    payload: AIContext
    payload_sha256: str
    expires_in_seconds: int
    ai_enabled: bool
    external_calls_implemented: bool


class AuthorizeRequest(_Strict):
    # El usuario aprueba ESTE contenido: si cambia un solo carácter, la huella no coincide.
    payload_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    confirm: Literal[True]


class AIStatus(BaseModel):
    ai_enabled: bool
    provider_configured: bool
    external_calls_implemented: bool
