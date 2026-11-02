"""Contratos del informe interpretativo (Fase 4C).

- `InterpretationContext`: lo ÚNICO que puede viajar a la IA para interpretar
  resultados. Lo arma el backend a partir de la ejecución guardada (nunca el
  navegador): objetivo, tamaño de las fuentes y resultados AGREGADOS de Pandas.
  Nunca incluye archivos, filas originales, puntos de una dispersión ni de una
  curva ROC.
- `AIInterpretation`: la respuesta estructurada que se le pide a la IA. Cada
  afirmación cita las operaciones (`ref`) en las que se apoya y declara cada cifra
  como un `Claim` (operación, medida, categorías, período, unidad, tipo y valor). El
  backend recalcula cada claim sobre los resultados reales de Pandas antes de mostrarla.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, PrivateAttr


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ContextMeasure(_Strict):
    column: str
    aggregate: str
    unit: str | None = None


class ContextRow(_Strict):
    keys: list[str]
    values: list[float | None]


class ContextOperation(_Strict):
    # Referencia estable para citar la operación: "P1.O2" = plan 1, operación 2.
    ref: str
    plan_title: str
    source_alias: str
    operation: str
    description: str
    status: Literal["ok", "error"]
    dimensions: list[str] = []
    split_dimensions: list[str] = []
    temporal_dimension: str | None = None
    period: str | None = None
    measures: list[ContextMeasure] = []
    # Resultados agregados (grupos, períodos, intervalos). Vacío en dispersión y ROC: solo estadísticos.
    rows: list[ContextRow] = []
    rows_total: int = 0
    # true si los grupos son tantos como los registros usados (cada grupo sería un registro): no se envían.
    rows_withheld: bool = False
    rows_used: int | None = None
    stats: dict[str, float | int | str | bool | None] | None = None
    warnings: list[str] = []
    # Medidas sumadas con valores positivos y negativos: sus sumas son netas.
    signed_measures: list[str] = []
    error: str | None = None


class ContextSource(_Strict):
    alias: str
    rows: int
    columns: int


class ContextFacts(_Strict):
    ref: str
    facts: list[str]


class InterpretationContext(_Strict):
    version: Literal[1] = 1
    objective: str | None = None
    sources: list[ContextSource]
    operations: list[ContextOperation]
    # Resumen descriptivo determinístico (calculado sin IA): la IA puede citar sus cifras.
    descriptive_summary: list[ContextFacts]


class CompactOperation(_Strict):
    """Una operación en el contexto COMPACTO que viaja a la IA (versión 2).

    `rows` son arreglos: primero los valores de `dimensions` y después los de `measures`, en ese orden.
    `detail` dice qué tan completa va: "full" (todas las filas agregadas), "summary" (filas representativas,
    explicadas en `omitted`) o "facts" (solo los hechos verificados del resumen descriptivo).
    """

    ref: str
    operation: str
    description: str
    status: Literal["ok", "error"]
    detail: Literal["full", "summary", "facts"] = "full"
    dimensions: list[str] = []
    temporal_dimension: str | None = None
    split_dimensions: list[str] = []
    period: str | None = None
    measures: list[ContextMeasure] = []
    rows: list[list[str | float | None]] = []
    rows_total: int = 0
    rows_used: int | None = None
    # Medidas idénticas (mismas dimensiones y valores) a las de otra operación: no se repiten.
    repeated: dict[str, str] = {}
    # Operación idéntica a otra (por ejemplo, el mismo total en dos planes): solo se referencia.
    same_as: str | None = None
    # Qué se dejó afuera y qué no se puede evaluar por eso.
    omitted: str | None = None
    facts: list[str] = []
    stats: dict[str, float | int | str | bool | None] | None = None
    signed_measures: list[str] = []
    error: str | None = None


class CompactPlan(_Strict):
    ref: str
    title: str
    source_alias: str
    operations: list[CompactOperation]


class CompactWarning(_Strict):
    text: str
    refs: list[str]


class ContextCoverage(_Strict):
    operations: int
    full: int
    summarized: int
    facts_only: int
    plans_excluded: list[str] = []
    note: str


class CompactInterpretationContext(_Strict):
    """Lo ÚNICO que viaja a la IA para interpretar (versión 2): resultados agregados, compactos y sin repetir.

    El contexto completo (todas las filas agregadas) queda en el backend para VERIFICAR las cifras:
    `_verification` no se serializa, no se muestra ni se envía.
    """

    version: Literal[2] = 2
    objective: str | None = None
    sources: list[ContextSource]
    coverage: ContextCoverage
    plans: list[CompactPlan]
    # Advertencias de las operaciones, una sola vez cada una, con las operaciones a las que aplican.
    warnings: list[CompactWarning] = []
    _verification: InterpretationContext | None = PrivateAttr(default=None)

    def wire(self) -> dict:
        """Contenido exacto que se muestra y se envía (sin campos vacíos)."""
        return _prune(self.model_dump(mode="json"))

    @property
    def verification(self) -> InterpretationContext:
        if self._verification is None:  # pragma: no cover - siempre lo asigna compact_context
            raise ValueError("Falta el contexto de verificación.")
        return self._verification


def _prune(value):
    if isinstance(value, dict):
        return {k: _prune(v) for k, v in value.items() if v is not None and v != [] and v != {}}
    if isinstance(value, list):
        return [_prune(v) for v in value]
    return value


class PrepareInterpretation(_Strict):
    execution_id: str = Field(min_length=8, max_length=64)
    # Planes a interpretar (1 = P1); vacío o ausente = todos. Permite interpretar por partes.
    plans: list[int] | None = Field(default=None, max_length=20)


class AuthorizeInterpretation(_Strict):
    payload_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    confirm: Literal[True]


# --- Respuesta de la IA ------------------------------------------------------------

class _Out(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ClaimKey(_Out):
    # Dimensión del resultado (por ejemplo, "rubro") y su valor ("Alimentos").
    dimension: str
    value: str


ClaimKind = Literal["value", "share_pct", "change", "change_pct", "statistic"]


class Claim(_Out):
    """Una cifra de la interpretación, vinculada con el resultado exacto del que sale."""

    ref: str
    # Columna de la medida (`measures[].column`); en "statistic", el nombre del estadístico (pearson, spearman, auc, n).
    measure: str
    kind: ClaimKind
    # Valores de TODAS las dimensiones de la fila (salvo la temporal en "change" y "change_pct").
    keys: list[ClaimKey]
    # Solo en "change" y "change_pct": período inicial y final.
    period_from: str | None
    period_to: str | None
    value: float
    # Unidad de la cifra: la de la medida, "%" en participaciones y variaciones porcentuales, o null.
    unit: str | None


class InterpretationItem(_Out):
    text: str
    # Operaciones (`ref`) que respaldan la afirmación.
    evidence: list[str]
    # Cada cifra del texto, declarada para que el backend la recalcule.
    claims: list[Claim]


class AIInterpretation(_Out):
    executive_summary: list[InterpretationItem]
    findings: list[InterpretationItem]
    trends: list[InterpretationItem]
    # Qué cambia para el objetivo a partir de los hallazgos.
    implications: list[InterpretationItem]
    # Recomendaciones condicionadas y fundamentadas en los resultados.
    recommendations: list[InterpretationItem]
    # Explicaciones posibles a comprobar con otros datos: nunca se presentan como hechos.
    hypotheses: list[InterpretationItem]
    # Datos adicionales que permitirían decidir mejor.
    information_needed: list[str]
    # Conclusiones que estos datos no permiten (rentabilidad sin costos, causas, pronósticos…).
    not_supported: list[str]
    limitations: list[str]
    data_quality: list[str]
