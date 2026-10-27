"""Calidad de valores y tipo semántico de columnas (reglas generales y conservadoras).

Pandas lee todo como texto, así que el tipo técnico no dice qué *significa* una
columna. Acá se estima su rol estadístico (cuantitativa, categórica, código,
temporal o texto) con criterios explícitos sobre TODOS los valores de la columna.
Es una inferencia: siempre se devuelve con nivel de confianza y motivo, y nunca
se usa para modificar los datos.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass

import pandas as pd

from app.services.value_parsing import NUMBER_RE, PERIOD_RE, parse_decorated

# Marcadores textuales que PODRÍAN indicar ausencia. No se convierten en
# faltantes: "NA" puede ser un código válido (por ejemplo, Namibia).
SUSPECTED_MISSING_TOKENS = frozenset({
    "na", "n/a", "n.a.", "#n/a", "nan", "null", "none", "nil",
    "-", "--", "?", "s/d", "sin dato", "sin datos",
})

# Proporción mínima de valores con un mismo formato para considerarlo consistente.
CONSISTENT = 0.98
# Por debajo de esta proporción de valores numéricos la columna se trata como texto.
MOSTLY_NUMERIC = 0.5
# Mínimo de valores para aplicar reglas basadas en patrones (longitud fija, unicidad).
MIN_VALUES_FOR_PATTERNS = 20

PLAIN_NUMBER_RE = r"[-+]?(?:\d{1,3}(?:[.,]\d{3})+|\d+)(?:[.,]\d+)?"
INTEGER_RE = r"[-+]?\d+"
LEADING_ZERO_RE = r"0\d+"
DATE_RE = (
    r"(?:\d{4}[-/]\d{1,2}(?:[-/]\d{1,2})?|\d{1,2}[-/]\d{1,2}[-/]\d{2,4})"
    r"(?:[ T]\d{1,2}:\d{2}(?::\d{2})?)?"
)
BOOLEAN_TOKENS = frozenset({"true", "false", "si", "sí", "no", "yes", "verdadero", "falso"})

# Palabras del NOMBRE de la columna que aportan evidencia (no son reglas de un dataset).
YEAR_WORDS = frozenset({"anio", "ano", "anyo", "year", "ejercicio"})
MONTH_WORDS = frozenset({"mes", "month"})
TIME_WORDS = frozenset({"fecha", "date", "periodo", "dia", "day", "trimestre", "quarter", "semana", "week"})
CODE_WORDS = frozenset({"id", "codigo", "cod", "code", "clave", "key", "nro", "dni", "cuit", "cuil", "sku", "ean"})

LABELS = {
    "quantitative": "cuantitativa",
    "categorical": "categórica",
    "identifier": "identificador o código",
    "temporal": "temporal",
    "text": "texto libre",
    "unknown": "sin datos",
}


@dataclass(frozen=True)
class ColumnSemantics:
    value_kind: str  # numeric | date | boolean | text | mixed | empty (formato de los valores)
    semantic_type: str  # quantitative | categorical | identifier | temporal | text | unknown
    confidence: str  # high | medium | low
    reason: str
    ambiguity: str | None = None  # advertencia cuando la interpretación es dudosa


def name_words(name: str) -> set[str]:
    """Palabras del nombre, sin tildes ni mayúsculas: 'Año_Fiscal' -> {'ano', 'fiscal'}."""
    plain = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode().lower()
    return {word for word in re.split(r"[^a-z0-9]+", plain) if word}


def suspected_missing_mask(series: pd.Series) -> pd.Series:
    return series.str.strip().str.lower().isin(SUSPECTED_MISSING_TOKENS)


def _distinct(count: int) -> str:
    return "1 valor distinto" if count == 1 else f"{count} valores distintos"


def _pct(ratio: float) -> str:
    return f"{ratio * 100:.0f} %".replace(".", ",")


def classify_column(name: str, values: pd.Series) -> ColumnSemantics:
    """Clasifica una columna a partir de sus valores no vacíos y no sospechosos (texto)."""
    result = _classify(name, values)
    if result.value_kind != "empty" and values.str.strip().nunique() == 1:
        # Columna constante: se conserva el tipo, pero sin variación no hay evidencia firme.
        return ColumnSemantics(
            result.value_kind, result.semantic_type, "low",
            f"{result.reason} Todas las filas tienen el mismo valor.",
            "tiene un único valor en todas las filas (columna constante); no aporta variación para comparar.",
        )
    return result


def _classify(name: str, values: pd.Series) -> ColumnSemantics:
    # Los patrones se evalúan sobre valores distintos ponderados por su frecuencia:
    # mismo resultado que recorrer todas las filas, mucho más rápido.
    counts = values.str.strip().value_counts()
    total = int(counts.sum())
    if total == 0:
        return ColumnSemantics("empty", "unknown", "low", "La columna no tiene valores para analizar.")

    unique = pd.Series(counts.index, dtype=str)
    weights = counts.to_numpy()

    def share(mask: pd.Series) -> float:
        return float(weights[mask.to_numpy()].sum() / total)

    words = name_words(name)
    distinct = len(unique)

    if share(unique.str.lower().isin(BOOLEAN_TOKENS)) >= CONSISTENT:
        return ColumnSemantics("boolean", "categorical", "high", "Valores de tipo sí/no o verdadero/falso.")

    date_ratio = share(unique.str.fullmatch(DATE_RE) | unique.str.fullmatch(PERIOD_RE, flags=re.IGNORECASE))
    if date_ratio >= CONSISTENT:
        return ColumnSemantics(
            "date", "temporal", "high", f"El {_pct(date_ratio)} de los valores tiene formato de fecha o período (mes, trimestre, semestre)."
        )

    numeric_mask = unique.str.fullmatch(NUMBER_RE)
    numeric_ratio = share(numeric_mask)

    if numeric_ratio >= CONSISTENT:
        plain = unique[numeric_mask].str.fullmatch(PLAIN_NUMBER_RE)
        if share(numeric_mask & ~plain.reindex(unique.index, fill_value=False)) >= MOSTLY_NUMERIC:
            # "$ 1.200", "12,5 %", "USD 30": el símbolo indica una cantidad (con su unidad).
            symbols = sorted({parse_decorated(v)[1] or "" for v in unique[numeric_mask]} - {""})
            return ColumnSemantics(
                "numeric", "quantitative", "high",
                f"Valores numéricos con símbolo de moneda o porcentaje ({', '.join(symbols)}).",
            )
        return _classify_numeric(words, unique[numeric_mask], total, distinct)

    if numeric_ratio >= MOSTLY_NUMERIC:
        return ColumnSemantics(
            "mixed", "text", "low",
            f"Solo el {_pct(numeric_ratio)} de los valores es numérico.",
            f"mezcla valores numéricos ({_pct(numeric_ratio)}) y no numéricos; revisar formatos o marcadores antes de calcular.",
        )

    if words & CODE_WORDS:
        return ColumnSemantics("text", "identifier", "medium", "El nombre sugiere un identificador o código.")
    if total >= MIN_VALUES_FOR_PATTERNS and distinct == total:
        return ColumnSemantics("text", "identifier", "medium", "Todos los valores son distintos: se comporta como identificador.")
    if distinct <= 50 or distinct / total <= 0.05:
        return ColumnSemantics("text", "categorical", "medium", f"Texto con pocos valores distintos ({distinct}) que se repiten en las filas.")
    return ColumnSemantics("text", "text", "medium", f"Texto con muchos valores distintos ({distinct}).")


def _classify_numeric(words: set[str], values: pd.Series, total: int, distinct: int) -> ColumnSemantics:
    """`values`: valores numéricos distintos; `total`: cantidad de valores de la columna."""
    is_integer = bool(values.str.fullmatch(INTEGER_RE).all())

    if values.str.fullmatch(LEADING_ZERO_RE).any():
        return ColumnSemantics(
            "numeric", "identifier", "high",
            "Hay valores con ceros a la izquierda (por ejemplo, '001'): se comportan como códigos, no como cantidades.",
        )

    if not is_integer:
        return ColumnSemantics("numeric", "quantitative", "high", "Valores numéricos con decimales.")

    numbers = pd.to_numeric(values, errors="coerce")
    low, high = int(numbers.min()), int(numbers.max())
    digits = values.str.lstrip("+-").str.len()

    if words & YEAR_WORDS and 1800 <= low and high <= 2100:
        return ColumnSemantics("numeric", "temporal", "high", f"El nombre indica un año y los valores son enteros entre {low} y {high}.")
    if words & MONTH_WORDS and 1 <= low and high <= 12:
        return ColumnSemantics("numeric", "temporal", "high", f"El nombre indica un mes y los valores son enteros entre {low} y {high}.")
    if words & TIME_WORDS:
        return ColumnSemantics("numeric", "temporal", "medium", "El nombre sugiere una variable temporal y los valores son enteros.")
    if words & CODE_WORDS:
        return ColumnSemantics("numeric", "identifier", "medium", "El nombre sugiere un código y los valores son enteros.")

    if total >= MIN_VALUES_FOR_PATTERNS:
        # Distintos y casi consecutivos (1001, 1002…): numeración. Importes distintos pero dispersos no lo son.
        if distinct == total and high - low + 1 <= 2 * distinct:
            return ColumnSemantics(
                "numeric", "identifier", "medium",
                "Todos los valores son enteros distintos y casi consecutivos: se comporta como identificador.",
            )
        fixed_length = int(digits.iloc[0]) if digits.nunique() == 1 else None
        if fixed_length == 4 and 1800 <= low and high <= 2100:
            return ColumnSemantics(
                "numeric", "temporal", "low", f"Enteros de 4 dígitos entre {low} y {high}.",
                "podría ser un año; el nombre de la columna no lo confirma.",
            )
        if fixed_length is not None and fixed_length >= 4:
            return ColumnSemantics(
                "numeric", "identifier", "medium",
                f"Enteros de longitud fija ({fixed_length} dígitos): patrón habitual de códigos.",
                "podría ser un código; no conviene sumarla ni promediarla sin confirmarlo.",
            )
        if distinct <= 12:
            return ColumnSemantics(
                "numeric", "quantitative", "low", f"Enteros con solo {_distinct(distinct)}.",
                "podría ser una categoría codificada con números o una cantidad discreta.",
            )

    return ColumnSemantics("numeric", "quantitative", "medium", f"Valores enteros con {_distinct(distinct)}.")
