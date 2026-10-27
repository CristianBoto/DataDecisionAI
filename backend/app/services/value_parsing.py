"""Lectura general de números y períodos escritos como texto (sin reglas de un dataset).

Las mismas funciones las usan el perfilador (para clasificar columnas) y el motor
(para calcular), así ambos interpretan cada celda igual.

Números: "15000", "15.000" (miles), "1.234,56", "1,234.56", "3,5", con símbolos
de moneda o porcentaje alrededor ("$ 1.200", "12,5 %", "USD 30", "(1.500)" negativo).
El símbolo no cambia el valor: se informa como unidad detectada.

Períodos: años ("2024"), semestres ("2024-S1", "1S 2024"), trimestres ("2024-Q1",
"T1-2024", "1T2024"), meses ("2024-01", "01/2024", "ene-2024", "enero 2024",
"Jan 2024") y fechas completas ("2024-01-15", "15/01/2024", con o sin hora). La
granularidad (año, semestre, trimestre, mes o día) sale de los propios valores:
"2019-01-01", "2020-01-01"… son datos ANUALES, no de enero.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass

import pandas as pd

# --- Números ------------------------------------------------------------------------

_THOUSANDS_DOT = re.compile(r"\d{1,3}(?:\.\d{3})+")
_THOUSANDS_COMMA = re.compile(r"\d{1,3}(?:,\d{3})+")
_PLAIN = re.compile(r"\d+(?:[.,]\d+)?")
_MIXED = re.compile(r"\d{1,3}(?:[.,]\d{3})*[.,]\d+")
# Moneda o unidad pegada al número: símbolos y códigos ISO de moneda frecuentes. No se aceptan
# letras cualesquiera: "ABC123" es un código de producto, no un importe.
CURRENCY_CODES = "USD|ARS|EUR|BRL|CLP|UYU|MXN|COP|PEN|PYG|BOB|GBP|JPY|CNY|CAD|AUD|CHF"
_PREFIX = rf"(?P<pre>US\$|U\$S|\$|€|£|¥|(?:{CURRENCY_CODES})(?=[\s\d]))?"
_SUFFIX = rf"(?P<suf>%|‰|\$|€|(?<=[\s\d])(?:{CURRENCY_CODES}))?"
_DECORATED = re.compile(rf"^\s*(?P<neg>-)?\s*{_PREFIX}\s*(?P<sign>[-+])?\s*(?P<num>[\d.,]+)\s*{_SUFFIX}\s*$")
_PARENTHESES = re.compile(r"^\s*\((?P<inner>[^()]+)\)\s*$")  # (1.500) = -1500 en notación contable

# Para clasificar columnas (perfilador): número con o sin símbolos.
NUMBER_RE = (
    rf"\s*\(?-?\s*(?:US\$|U\$S|\$|€|£|¥|(?:{CURRENCY_CODES})\s?)?\s*[-+]?\s*"
    rf"(?:\d{{1,3}}(?:[.,]\d{{3}})+|\d+)(?:[.,]\d+)?\s*(?:%|‰|\$|€|\s?(?:{CURRENCY_CODES}))?\s*\)?\s*"
)


def _plain_number(value: str) -> float | None:
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


def parse_decorated(text: str) -> tuple[float | None, str | None]:
    """(número, símbolo de unidad o moneda que lo acompañaba) o (None, None)."""
    value = text.strip().replace(" ", " ")
    negative = False
    parens = _PARENTHESES.fullmatch(value)
    if parens:
        value, negative = parens.group("inner"), True
    match = _DECORATED.fullmatch(value)
    if not match:
        return None, None
    pre, suf = match.group("pre"), match.group("suf")
    if pre and suf:
        return None, None  # "$ 10 %": ambiguo
    number = _plain_number(match.group("num"))
    if number is None:
        return None, None
    if match.group("neg") or match.group("sign") == "-":
        number = -number
    if negative:
        number = -abs(number)
    unit = pre or suf
    return number, ("$" if unit in ("US$", "U$S") else unit) if unit else None


def parse_number(text: str) -> float | None:
    """Convierte un texto a número (ver el docstring del módulo). None si no es un número."""
    return parse_decorated(text)[0]


# --- Períodos -------------------------------------------------------------------------

GRANULARITIES = ("day", "month", "quarter", "semester", "year")  # de más fina a más gruesa
GRANULARITY_LABELS = {"day": "día", "month": "mes", "quarter": "trimestre", "semester": "semestre", "year": "año"}

MONTH_NAMES = {
    "ene": 1, "enero": 1, "jan": 1, "january": 1,
    "feb": 2, "febrero": 2, "february": 2,
    "mar": 3, "marzo": 3, "march": 3,
    "abr": 4, "abril": 4, "apr": 4, "april": 4,
    "may": 5, "mayo": 5,
    "jun": 6, "junio": 6, "june": 6,
    "jul": 7, "julio": 7, "july": 7,
    "ago": 8, "agosto": 8, "aug": 8, "august": 8,
    "sep": 9, "set": 9, "sept": 9, "septiembre": 9, "setiembre": 9, "september": 9,
    "oct": 10, "octubre": 10, "october": 10,
    "nov": 11, "noviembre": 11, "november": 11,
    "dic": 12, "diciembre": 12, "dec": 12, "december": 12,
}
_MONTH_WORD = "|".join(sorted(MONTH_NAMES, key=len, reverse=True))

_YEAR = re.compile(r"(?P<y>\d{4})(?:\.0+)?")
_QUARTER = [
    re.compile(r"(?P<y>\d{4})\s*[-/ _.]?\s*[QT](?P<n>[1-4])", re.I),
    re.compile(r"[QT](?P<n>[1-4])\s*[-/ _.]?\s*(?P<y>\d{4})", re.I),
    re.compile(r"(?P<n>[1-4])\s*[QT]\s*[-/ _.]?\s*(?P<y>\d{4})", re.I),
]
_SEMESTER = [
    re.compile(r"(?P<y>\d{4})\s*[-/ _.]?\s*[SH](?P<n>[12])", re.I),
    re.compile(r"[SH](?P<n>[12])\s*[-/ _.]?\s*(?P<y>\d{4})", re.I),
    re.compile(r"(?P<n>[12])\s*[SH]\s*[-/ _.]?\s*(?P<y>\d{4})", re.I),
]
_MONTH_NUM = [
    # Sin "." como separador: "1500.25" es un número decimal, no un mes.
    re.compile(r"(?P<y>\d{4})[-/](?P<m>\d{1,2})"),
    re.compile(r"(?P<m>\d{1,2})[-/](?P<y>\d{4})"),
]
_MONTH_TEXT = [
    re.compile(rf"(?P<w>{_MONTH_WORD})\.?\s*[-/ ]?\s*(?:de\s+)?(?P<y>\d{{4}}|\d{{2}})", re.I),
    re.compile(rf"(?P<y>\d{{4}})\s*[-/ ]?\s*(?P<w>{_MONTH_WORD})\.?", re.I),
]
DATE_FORMATS = ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%Y/%m/%d", "%Y-%m-%d %H:%M:%S", "%d/%m/%Y %H:%M", "%Y-%m-%dT%H:%M:%S", "%d.%m.%Y")

# Regex para el perfilador: valores con forma de período (además de las fechas completas).
PERIOD_RE = (
    r"\s*(?:\d{4}\s*[-/ _.]?\s*[QqTtSsHh][1-4]|[QqTtSsHh][1-4]\s*[-/ _.]?\s*\d{4}|[1-4]\s*[QqTtSsHh]\s*[-/ _.]?\s*\d{4}"
    r"|\d{4}[-/]\d{1,2}|\d{1,2}[-/]\d{4}"
    rf"|(?:{_MONTH_WORD})\.?\s*[-/ ]?\s*(?:de\s+)?\d{{2,4}}|\d{{4}}\s*[-/ ]?\s*(?:{_MONTH_WORD})\.?)\s*"
)


def _plain_text(text: str) -> str:
    return unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode().strip().lower()


def _parse_one(text: str) -> tuple[pd.Timestamp, str] | None:
    """Un valor de período → (inicio del período, granularidad). Fechas completas: None (se leen aparte)."""
    value = _plain_text(text)
    if match := _YEAR.fullmatch(value):
        return pd.Timestamp(int(match["y"]), 1, 1), "year"
    for pattern in _QUARTER:
        if match := pattern.fullmatch(value):
            return pd.Timestamp(int(match["y"]), 3 * int(match["n"]) - 2, 1), "quarter"
    for pattern in _SEMESTER:
        if match := pattern.fullmatch(value):
            return pd.Timestamp(int(match["y"]), 6 * int(match["n"]) - 5, 1), "semester"
    for pattern in _MONTH_NUM:
        if (match := pattern.fullmatch(value)) and 1 <= int(match["m"]) <= 12:
            return pd.Timestamp(int(match["y"]), int(match["m"]), 1), "month"
    for pattern in _MONTH_TEXT:
        if match := pattern.fullmatch(value):
            year = int(match["y"]) + (2000 if len(match["y"]) == 2 else 0)
            return pd.Timestamp(year, MONTH_NAMES[match["w"]], 1), "month"
    return None


@dataclass
class ParsedPeriods:
    starts: pd.Series  # inicio de cada período (NaT si no se pudo leer)
    granularity: str | None  # granularidad natural de los datos
    invalid: int  # valores presentes que no se pudieron leer
    mixed: bool  # había valores de granularidades distintas


def _natural_granularity(dates: pd.Series) -> str:
    """Fechas completas: la granularidad que muestran los propios datos."""
    present = dates.dropna()
    if present.empty:
        return "day"
    if (present.dt.hour + present.dt.minute + present.dt.second != 0).any() or (present.dt.day != 1).any():
        return "day"
    months = set(present.dt.month.unique())
    if months == {1}:
        return "year"
    if months <= {1, 7} and len(months) > 1:
        return "semester"
    if months <= {1, 4, 7, 10} and len(months) > 1:
        return "quarter"
    return "month"


def parse_periods(texts: pd.Series) -> ParsedPeriods:
    """Serie de texto (NaN = faltante) → inicios de período y granularidad natural."""
    present = texts.dropna()
    lookup: dict[str, tuple[pd.Timestamp, str] | None] = {v: _parse_one(v) for v in present.unique()}
    granularities = {g for result in lookup.values() if result for _, g in [result]}
    starts = texts.map(lambda v: lookup[v][0] if isinstance(v, str) and lookup.get(v) else pd.NaT)
    starts = pd.to_datetime(starts, errors="coerce")

    unresolved = present[present.map(lambda v: lookup[v] is None)]
    if not unresolved.empty:
        # Fechas completas: se usa el formato que interpreta más valores.
        best, best_ok = None, -1
        for fmt in DATE_FORMATS:
            parsed = pd.to_datetime(unresolved, format=fmt, errors="coerce")
            ok = int(parsed.notna().sum())
            if ok > best_ok:
                best, best_ok = parsed, ok
            if ok == len(unresolved):
                break
        if best is not None and best_ok > 0:
            starts.loc[best.index] = starts.loc[best.index].fillna(best)
            granularities.add(_natural_granularity(best))

    invalid = int(len(present) - starts.loc[present.index].notna().sum())
    if not granularities:
        return ParsedPeriods(starts, None, invalid, False)
    # Con granularidades mezcladas se usa la más fina (y se avisa).
    granularity = min(granularities, key=GRANULARITIES.index)
    return ParsedPeriods(starts, granularity, invalid, len(granularities) > 1)


def period_labels(starts: pd.Series, granularity: str) -> pd.Series:
    """Etiqueta legible y ordenable de cada período: 2024 · 2024-S1 · 2024-T1 · 2024-01 · 2024-01-15."""
    year = starts.dt.year.astype("Int64").astype(str)
    if granularity == "year":
        labels = year
    elif granularity == "semester":
        labels = year + "-S" + ((starts.dt.month - 1) // 6 + 1).astype("Int64").astype(str)
    elif granularity == "quarter":
        labels = year + "-T" + ((starts.dt.month - 1) // 3 + 1).astype("Int64").astype(str)
    elif granularity == "month":
        labels = starts.dt.strftime("%Y-%m")
    else:
        labels = starts.dt.strftime("%Y-%m-%d")
    return labels.where(starts.notna())


def coarser(granularity: str) -> str | None:
    index = GRANULARITIES.index(granularity)
    return GRANULARITIES[index + 1] if index + 1 < len(GRANULARITIES) else None
