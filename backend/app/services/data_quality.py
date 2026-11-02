"""Diagnóstico de calidad de un dataset (Fase 5), calculado con Pandas y sin IA.

Complementa al perfilado (`dataset_profiler`) con lo que afecta a los cálculos:
- estadísticas descriptivas de las columnas cuantitativas (n, media, desvío, cuartiles);
- errores de conversión (texto en una columna numérica);
- valores atípicos con el criterio de Tukey (IQR): fuera de [Q1 − 1,5·IQR, Q3 + 1,5·IQR];
- categorías que solo difieren en mayúsculas, tildes o espacios («Local», «local »);
- fechas ilegibles o ambiguas (día/mes intercambiables, como 03/04/2025);
- duplicados exactos y duplicados lógicos (iguales al ignorar mayúsculas y espacios).

Cada problema se informa con su impacto en el análisis. NADA se corrige: no se eliminan
duplicados, no se unifican categorías, no se imputan faltantes ni se reemplazan por cero.
El archivo original no se modifica. Las reglas solo usan el tipo semántico de cada columna,
nunca su nombre ni un dataset concreto.
"""

from __future__ import annotations

import re
import unicodedata

import pandas as pd

from app.services.column_semantics import suspected_missing_mask
from app.services.value_parsing import parse_decorated, parse_periods

# Para cada tipo de problema, cuántos ejemplos (variantes de una categoría) se muestran como máximo.
MAX_VARIANT_GROUPS = 5
MAX_VARIANTS = 4
# Valores con día y mes intercambiables (los dos ≤ 12) en formato numérico con barra, guion o punto.
AMBIGUOUS_DATE = re.compile(r"^\s*(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})\s*$")
MIN_VALUES_FOR_OUTLIERS = 8
# Más de esta proporción de valores fuera del rango IQR no son «atípicos»: la distribución es asimétrica o mezcla grupos.
SKEWED_SHARE = 0.1
# Una columna se diagnostica como numérica o de fechas si al menos esta proporción de sus valores lo es.
MOSTLY = 0.6


def _is_number(value: str) -> bool:
    return parse_decorated(value)[0] is not None


def _is_period(value: str) -> bool:
    return parse_periods(pd.Series([value])).invalid == 0


def _share(values: pd.Series, test) -> float:
    """Proporción de valores (sin marcadores de ausencia) que cumplen `test`, evaluando cada valor distinto una vez."""
    present = values.loc[~suspected_missing_mask(values)]
    if present.empty:
        return 0.0
    counts = present.value_counts()
    return float(sum(count for value, count in counts.items() if test(value)) / counts.sum())


def _canonical(text: str) -> str:
    """Forma comparable de un texto: sin tildes, sin mayúsculas y con los espacios normalizados."""
    plain = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    return " ".join(plain.casefold().split())


def _round(value) -> float | None:
    if value is None or pd.isna(value):
        return None
    return round(float(value), 6)


def numeric_profile(values: pd.Series) -> dict | None:
    """Estadísticas de una columna cuantitativa (valores presentes como texto)."""
    present = values.loc[~suspected_missing_mask(values)]
    lookup = {v: parse_decorated(v)[0] for v in present.unique()}
    numbers = present.map(lookup).dropna().astype("float64")
    errors = int(len(present) - len(numbers))
    if numbers.empty:
        return {"count": 0, "conversion_errors": errors}
    q1, median, q3 = (float(numbers.quantile(q)) for q in (0.25, 0.5, 0.75))
    iqr = q3 - q1
    low, high = q1 - 1.5 * iqr, q3 + 1.5 * iqr
    outliers = int(((numbers < low) | (numbers > high)).sum()) if len(numbers) >= MIN_VALUES_FOR_OUTLIERS and iqr > 0 else 0
    return {
        "count": int(len(numbers)),
        "mean": _round(numbers.mean()),
        "std": _round(numbers.std()) if len(numbers) > 1 else None,
        "min": _round(numbers.min()),
        "q1": _round(q1),
        "median": _round(median),
        "q3": _round(q3),
        "max": _round(numbers.max()),
        "zeros": int((numbers == 0).sum()),
        "negatives": int((numbers < 0).sum()),
        "conversion_errors": errors,
        "outliers": outliers,
        "outlier_bounds": [_round(low), _round(high)] if outliers else None,
    }


def category_variants(values: pd.Series) -> list[dict]:
    """Grupos de valores distintos que representan, probablemente, la misma categoría."""
    distinct = pd.Series(values.unique())
    if distinct.empty:
        return []
    keys = distinct.map(_canonical)
    groups = []
    for _, variants in distinct.groupby(keys):
        if len(variants) > 1:
            listed = sorted(variants.tolist(), key=lambda v: (v != v.strip(), v))
            groups.append({
                "variants": listed[:MAX_VARIANTS],
                "rows": int(values.isin(variants).sum()),
                # Si solo cambian los espacios de los extremos, el motor ya los ignora al agrupar.
                "only_spaces": len({v.strip() for v in variants}) == 1,
            })
    groups.sort(key=lambda g: -g["rows"])
    return groups[:MAX_VARIANT_GROUPS]


def date_profile(values: pd.Series) -> dict:
    """Fechas o períodos: cuántos no se pudieron leer, rango y valores con día y mes intercambiables."""
    parsed = parse_periods(values)
    starts = parsed.starts.dropna()
    ambiguous, day_first_evidence = 0, False
    for value, count in values.value_counts().items():
        match = AMBIGUOUS_DATE.match(value)
        if not match:
            continue
        first, second = int(match.group(1)), int(match.group(2))
        if first > 12:
            day_first_evidence = True
        if first <= 12 and second <= 12 and first != second:
            ambiguous += int(count)
    return {
        "invalid": parsed.invalid,
        "granularity": parsed.granularity,
        "mixed": parsed.mixed,
        "first": starts.min().date().isoformat() if not starts.empty else None,
        "last": starts.max().date().isoformat() if not starts.empty else None,
        # Sin ningún día mayor que 12 no se puede confirmar el orden día/mes.
        "ambiguous": 0 if day_first_evidence else ambiguous,
    }


def logical_duplicates(df: pd.DataFrame) -> int:
    """Filas que son iguales a otra al ignorar mayúsculas, tildes y espacios, pero no idénticas."""
    if df.empty:
        return 0
    # Se normaliza cada valor DISTINTO una sola vez (equivalente y mucho más rápido que celda por celda).
    canonical = df.astype(str).apply(lambda column: column.map({v: _canonical(v) for v in column.unique()}))
    return max(int(canonical.duplicated().sum()) - int(df.duplicated().sum()), 0)


def _num(value: float) -> str:
    """Número con el formato de la interfaz (es-AR), hasta dos decimales: 1.234,5."""
    text = f"{value:,.2f}".replace(",", "_").replace(".", ",").replace("_", ".")
    return text.rstrip("0").rstrip(",") if "," in text else text


def _count(n: int, singular: str, plural: str) -> str:
    """«1 valor vacío» / «3 valores vacíos»."""
    return f"{n} {singular if n == 1 else plural}"


def _pct(part: int, total: int) -> str:
    return f"{part / total * 100:.1f}".replace(".", ",") + " %" if total else "0 %"


def quality_report(df: pd.DataFrame, columns: list[dict]) -> dict:
    """Agrega a cada columna su diagnóstico y devuelve los problemas con su impacto.

    `columns` son los perfiles de `profile_dataset` (se completan con `stats`, `category_variants`
    y `dates`). Devuelve {"logical_duplicate_rows", "issues"}; cada problema tiene
    severidad (alta, media, baja), columna, tipo, descripción e impacto en el análisis.
    """
    rows = int(len(df))
    issues: list[dict] = []

    def add(severity: str, column: str | None, kind: str, message: str, impact: str) -> None:
        issues.append({"severity": severity, "column": column, "kind": kind, "message": message, "impact": impact})

    for profile in columns:
        name = profile["name"]
        series = df[name].astype(str)
        present = series.loc[~series.str.strip().eq("")]
        semantic = profile.get("semantic_type")
        profile["stats"], profile["category_variants"], profile["dates"] = None, [], None

        missing = profile.get("missing", 0)
        if missing:
            share = missing / rows if rows else 0
            add("alta" if share >= 0.2 else "media" if share >= 0.05 else "baja", name, "missing",
                f"{_count(missing, 'valor vacío', 'valores vacíos')} ({_pct(missing, rows)} de las filas).",
                "Los cálculos usan solo los valores presentes: no se reemplazan por cero ni se completan.")
        if rows and profile.get("distinct", 0) == 1 and not missing:
            add("baja", name, "constant", "Tiene un único valor en todas las filas.",
                "No aporta variación: no sirve para comparar ni para agrupar.")

        # Una columna mayormente numérica o de fechas con algunos errores no se interpreta como tal:
        # se diagnostica igual, para mostrar qué valores lo impiden.
        numeric_like = semantic in ("text", "categorical", "unknown") and _share(present, _is_number) >= MOSTLY
        date_like = semantic in ("text", "categorical", "unknown") and not numeric_like and _share(present, _is_period) >= MOSTLY
        if numeric_like:
            add("alta", name, "mixed_numeric",
                "Parece numérica, pero tiene valores que no son números: por eso no se interpretó como cuantitativa.",
                "No se puede sumar ni promediar hasta corregir esos valores en el archivo o marcarlos como faltantes "
                "en la revisión.")
        if date_like:
            add("alta", name, "mixed_dates",
                "Parece una columna de fechas, pero tiene valores ilegibles: por eso no se interpretó como temporal.",
                "No se puede analizar su evolución en el tiempo hasta corregir esos valores.")

        if semantic == "quantitative" or numeric_like:
            stats = numeric_profile(present)
            profile["stats"] = stats
            if stats and stats["conversion_errors"]:
                add("media", name, "conversion",
                    f"{_count(stats['conversion_errors'], 'valor no se puede', 'valores no se pueden')} leer como números.",
                    "Esos valores se excluyen de sumas, promedios y gráficos (se informa en cada resultado).")
            if stats and stats.get("outliers"):
                low, high = stats["outlier_bounds"]
                if stats["outliers"] / stats["count"] > SKEWED_SHARE:
                    add("baja", name, "outliers",
                        f"{stats['outliers']} de {stats['count']} valores quedan fuera del rango típico IQR "
                        f"({_num(low)} a {_num(high)}).",
                        "Son demasiados para ser errores aislados: la distribución es asimétrica o mezcla grupos de "
                        "magnitudes distintas (por ejemplo, categorías). Conviene comparar por grupo o usar la mediana.")
                else:
                    add("media", name, "outliers",
                        f"{_count(stats['outliers'], 'valor atípico', 'valores atípicos')} según el criterio IQR (fuera de {_num(low)} a {_num(high)}).",
                        "Pueden distorsionar promedios, desvíos y la escala de los gráficos; la mediana es más robusta. "
                        "No se eliminan: revisá si son errores de carga o casos reales.")
        elif semantic == "temporal" or date_like:
            dates = date_profile(present)
            profile["dates"] = dates
            if dates["invalid"]:
                add("alta" if rows and dates["invalid"] / rows >= 0.1 else "media", name, "invalid_dates",
                    f"{_count(dates['invalid'], 'fecha o período no se puede', 'fechas o períodos no se pueden')} leer.",
                    "En las evoluciones en el tiempo quedan en el grupo «(sin dato)».")
            if dates["ambiguous"]:
                add("media", name, "ambiguous_dates",
                    f"{_count(dates['ambiguous'], 'fecha tiene', 'fechas tienen')} día y mes intercambiables (por ejemplo, 03/04).",
                    "Se leen como día/mes/año. Si el archivo usa mes/día/año, los períodos quedarían mal asignados.")
        if semantic in ("categorical", "identifier") and not date_like:
            variants = category_variants(present)
            profile["category_variants"] = variants
            for group in variants:
                listed = ", ".join(f"«{v}»" for v in group["variants"])
                if group["only_spaces"]:
                    add("baja", name, "spaces", f"Valores que solo difieren en espacios: {listed}.",
                        "El análisis ya ignora los espacios al inicio y al final: se agrupan juntos.")
                else:
                    add("media", name, "inconsistent_categories",
                        f"Valores que podrían ser la misma categoría: {listed} ({group['rows']} filas).",
                        "Se cuentan como categorías distintas. No se unifican automáticamente: corregilos en el "
                        "archivo si son la misma.")

    exact = int(df.duplicated().sum())
    logical = logical_duplicates(df)
    if exact:
        add("media", None, "duplicates", f"{_count(exact, 'fila idéntica', 'filas idénticas')} a otra.",
            "Si representan el mismo registro, inflan totales y conteos. No se eliminan automáticamente.")
    if logical:
        add("baja", None, "logical_duplicates",
            f"{_count(logical, 'fila igual', 'filas iguales')} a otra salvo mayúsculas, tildes o espacios.",
            "Podrían ser el mismo registro cargado dos veces. No se eliminan automáticamente.")
    order = {"alta": 0, "media": 1, "baja": 2}
    issues.sort(key=lambda i: order[i["severity"]])
    return {"logical_duplicate_rows": logical, "issues": issues}
