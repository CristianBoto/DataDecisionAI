"""Sugerencias sobre las MEDIDAS de un dataset: unidad, si se pueden sumar, de qué columna depende su
significado y qué valores podrían ser marcadores de ausencia.

Todo son SUGERENCIAS con su motivo: el usuario las confirma o corrige en la revisión, y
solo sus decisiones se usan para calcular. Las reglas son generales (estructura del
archivo, símbolos de los valores, escalas y vocabulario estadístico común), no
nombres de columnas de un dataset en particular.

- Unidad: símbolo en las celdas ("$ 1.200", "12 %"), unidad entre paréntesis en el
  encabezado ("Gasto (USD)") o una columna de unidad constante.
- Aditividad: una cantidad aditiva (importes, unidades vendidas, personas) se puede
  sumar entre grupos y períodos. Tasas, porcentajes, promedios, índices, precios y
  stocks NO: su suma no significa nada.
- Dependencia ("formato largo"): cuando una columna categórica dice QUÉ mide cada
  fila (indicador, variable, unidad), los valores de distintas categorías no se
  pueden combinar. Se detecta por estructura (la categoría es parte de la clave de
  la fila) junto con otra evidencia: unidades distintas, escalas muy distintas o un
  nombre del tipo "indicador" o "variable".
- Marcadores numéricos de ausencia: -99, 999, 9999… cuando están fuera del rango
  del resto de los valores.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

import pandas as pd

from app.services.column_semantics import name_words
from app.services.value_parsing import parse_decorated

# Vocabulario estadístico general (no de un dataset): evidencia, nunca regla definitiva.
NON_ADDITIVE_WORDS = frozenset({
    "tasa", "rate", "porcentaje", "porc", "pct", "percent", "percentage", "ratio", "proporcion", "proportion",
    "indice", "index", "promedio", "prom", "average", "avg", "media", "mean", "precio", "price", "tipo",
    "stock", "saldo", "balance", "existencias", "nivel", "temperatura", "temperature", "edad", "age",
    "densidad", "density", "probabilidad", "probability", "score", "puntaje", "variacion", "share",
})
MEASURE_DEFINING_WORDS = frozenset({
    "indicador", "indicator", "variable", "serie", "series", "concepto", "medida", "measure", "metrica",
    "metric", "magnitud", "unidad", "unidades", "unit", "units",
})
UNIT_TOKENS = frozenset({
    "%", "$", "€", "usd", "ars", "eur", "brl", "pesos", "peso", "dolares", "dolar", "euros",
    "kg", "g", "t", "tn", "ton", "toneladas", "km", "m", "m2", "m3", "ha", "hectareas", "l", "litros",
    "kwh", "mwh", "gwh", "mw", "personas", "habitantes", "hab", "unidades", "u", "horas", "dias", "anos",
    "millones", "miles", "mill", "porcentaje", "puntos", "pp", "indice", "tasa", "cantidad", "casos",
})
SENTINELS = frozenset({"-1", "-9", "-99", "-999", "-9999", "999", "9999", "99999", "999999"})
# Escalas que difieren más de este factor entre categorías sugieren magnitudes distintas.
SCALE_RATIO = 50
MAX_KEY_COLUMNS = 12
MAX_SPLIT_DISTINCT = 50


@dataclass
class MeasureHints:
    unit: str | None = None
    unit_reason: str | None = None
    additivity: str | None = None  # additive | non_additive
    additivity_reason: str | None = None
    split_by: list[str] = field(default_factory=list)
    split_reason: str | None = None
    missing_values: list[str] = field(default_factory=list)
    # Signo de los valores: positive | negative | mixed (con mixed, una suma es neta).
    value_sign: str | None = None


def _unit_from_values(values: pd.Series) -> str | None:
    """Unidad común a casi todas las celdas ("$ 1.200" → "$"), o None.

    Se interpreta cada valor DISTINTO una sola vez (ponderado por su frecuencia): mismo
    resultado que recorrer todas las celdas, sin repetir el trabajo en cada fila.
    """
    counts = values.value_counts()
    units = {value: parse_decorated(value)[1] for value in counts.index}
    present = sum(int(n) for value, n in counts.items() if units[value] is not None)
    distinct = {unit for unit in units.values() if unit is not None}
    if present >= 0.9 * len(values) and len(distinct) == 1:
        return str(distinct.pop())
    return None


_HEADER_UNIT = re.compile(r"[\(\[]\s*([^\(\)\[\]]{1,16}?)\s*[\)\]]\s*$")


def _unit_from_name(name: str) -> str | None:
    match = _HEADER_UNIT.search(name)
    if match:
        return match.group(1)
    if name_words(name) & {"porcentaje", "pct", "percent", "percentage"} or name.strip().endswith("%"):
        return "%"
    return None


def _looks_like_unit(value: str) -> bool:
    words = set(re.split(r"[^a-z0-9%$€²³]+", value.lower().replace("ñ", "n")))
    return bool(words & UNIT_TOKENS) or value.strip() in UNIT_TOKENS


def _unit_column_ratio(values: pd.Series) -> float:
    distinct = values.dropna().unique()
    if len(distinct) == 0:
        return 0.0
    return sum(_looks_like_unit(v) for v in distinct) / len(distinct)


def _numbers(values: pd.Series) -> pd.Series:
    lookup = {v: parse_decorated(v)[0] for v in values.dropna().unique() if isinstance(v, str)}
    return values.map(lookup).astype("float64")


def _sentinels(texts: pd.Series, numbers: pd.Series) -> list[str]:
    stripped = texts.str.strip()
    found = []
    for token in sorted(SENTINELS, key=len):
        mask = stripped.eq(token)
        if mask.sum() < 2:
            continue
        rest = numbers[~mask & numbers.notna()]
        if rest.empty:
            continue
        value = float(token)
        if value < 0 and rest.min() >= 0:
            found.append(token)
        elif value > 0 and value > rest.max() * 3:
            found.append(token)
    return found


def measure_hints(df: pd.DataFrame, semantics: dict[str, str]) -> dict[str, MeasureHints]:
    """Sugerencias para cada columna cuantitativa. `semantics`: columna → tipo semántico sugerido."""
    texts = {c: df[c].astype(str).str.strip().replace("", pd.NA) for c in df.columns}
    quantitative = [c for c, t in semantics.items() if t == "quantitative"]
    categorical = [c for c, t in semantics.items() if t == "categorical"]
    key_columns = [
        c for c, t in semantics.items()
        if t in ("temporal", "categorical", "identifier") and texts[c].nunique() >= 2
    ][:MAX_KEY_COLUMNS]
    key_unique = bool(key_columns) and not df[key_columns].duplicated().any()
    unit_columns = [c for c in categorical if _unit_column_ratio(texts[c]) >= 0.8]

    hints: dict[str, MeasureHints] = {}
    for q in quantitative:
        h = MeasureHints()
        values = texts[q].dropna()
        numbers = _numbers(texts[q])
        valid = numbers.dropna()
        if (valid > 0).any() and (valid < 0).any():
            h.value_sign = "mixed"
        elif (valid < 0).any():
            h.value_sign = "negative"
        elif len(valid):
            h.value_sign = "positive"

        # Unidad: de las celdas, del encabezado o de una columna de unidad con un solo valor.
        if unit := _unit_from_values(values):
            h.unit, h.unit_reason = unit, f"Las celdas incluyen el símbolo «{unit}»."
        elif unit := _unit_from_name(q):
            h.unit, h.unit_reason = unit, "El encabezado indica la unidad."
        else:
            constant_units = [c for c in unit_columns if texts[c].nunique() == 1]
            if len(constant_units) == 1 and len(quantitative) == 1:
                h.unit = str(texts[constant_units[0]].dropna().iloc[0])
                h.unit_reason = f"La columna «{constant_units[0]}» indica la misma unidad en todas las filas."

        # Dependencia: columnas categóricas que dicen qué mide cada fila.
        reasons = []
        for c in categorical:
            distinct = texts[c].nunique()
            if not 2 <= distinct <= MAX_SPLIT_DISTINCT:
                continue
            if c in unit_columns:
                h.split_by.append(c)
                reasons.append(f"«{c}» indica unidades distintas")
                continue
            if not key_unique or c not in key_columns:
                continue
            # Sin la categoría ni sus atributos (columnas que dependen de ella, como la unidad de cada indicador).
            rest = [k for k in key_columns if k != c and df.groupby(texts[c])[k].nunique().max() > 1]
            repeats = df[rest].duplicated().mean() if rest else 1.0
            if repeats < 0.5:
                continue  # la categoría no forma parte de la clave de la fila
            medians = numbers.abs().groupby(texts[c]).median().dropna()
            medians = medians[medians > 0]
            heterogeneous = len(medians) >= 2 and medians.max() / medians.min() >= SCALE_RATIO
            named = bool(name_words(c) & MEASURE_DEFINING_WORDS)
            if heterogeneous or named:
                h.split_by.append(c)
                why = "escalas muy distintas entre sus categorías" if heterogeneous else "su nombre indica qué se mide"
                reasons.append(f"cada fila mide algo distinto según «{c}» ({why})")
        if h.split_by:
            h.split_reason = "; ".join(reasons).capitalize() + ": los valores de distintas categorías no se combinan."

        # Aditividad.
        words = name_words(q)
        present = numbers.dropna()
        if h.unit in ("%", "‰"):
            h.additivity, h.additivity_reason = "non_additive", "Es un porcentaje: no se suma."
        elif words & NON_ADDITIVE_WORDS:
            h.additivity = "non_additive"
            h.additivity_reason = "El nombre sugiere una tasa, promedio, índice, precio o stock: no se suma."
        elif not present.empty and present.between(0, 1).all() and (present % 1 != 0).any():
            h.additivity, h.additivity_reason = "non_additive", "Valores entre 0 y 1: parece una proporción o probabilidad."
        else:
            h.additivity = "additive"
            h.additivity_reason = "Se asume que se puede sumar (importes, cantidades, conteos). Corregilo si es una tasa o un stock."

        h.missing_values = _sentinels(texts[q].fillna(""), numbers)
        hints[q] = h
    return hints
