"""Informe de análisis e interpretación (Fase 4C).

Tres piezas, todas sobre los resultados que YA calculó el motor Pandas (no se
vuelve a calcular nada ni se relee ningún archivo):

1. `ExecutionStore`: guarda en memoria, con dueño y vencimiento, el contexto AGREGADO y
   acotado de cada ejecución (no el resultado completo: memoria acotada), para poder
   interpretarlo después. Otro visitante no lo ve (404).
2. `descriptive_summary`: resumen DETERMINÍSTICO, sin IA: totales, primer y último
   período, variaciones, máximos, mínimos, correlaciones y AUC, cada uno con la
   operación de la que sale. Nunca suma medidas de distintas unidades ni de
   distintas categorías de las columnas que definen la medida (formato largo).
3. Interpretación con IA: `build_context` arma el contexto AGREGADO (sin filas
   originales ni puntos de dispersión o ROC); la persona lo ve y lo autoriza; la
   respuesta pasa por `verify_interpretation`, que descarta afirmaciones con
   cifras que no están en los resultados, con lenguaje causal o que se apoyan en
   operaciones fallidas o inexistentes.
"""

from __future__ import annotations

import json
import re
import secrets
import threading
import time
from collections import OrderedDict
from dataclasses import dataclass
from itertools import groupby

from app.core.config import Settings
from app.schemas.interpretation import (
    AIInterpretation,
    Claim,
    ContextFacts,
    ContextMeasure,
    ContextOperation,
    ContextRow,
    ContextSource,
    InterpretationContext,
    InterpretationItem,
)
from app.services.ai_budget import AIBudget, cost_usd, estimate_tokens, model_prices
from app.services.ai_errors import AIGatewayError
from app.services.ai_gateway import AIProvider, AIRequestStore, check_sendable, metered_call
from app.services.openai_provider import INTERPRETATION_INSTRUCTIONS, build_input

EXECUTION_TTL_SECONDS = 6 * 3600
# El frontend interpreta solo la última ejecución; se conservan dos por visitante.
MAX_EXECUTIONS_PER_OWNER = 2
MAX_STORED_EXECUTIONS = 100
# Etiquetas (categorías, períodos) que viajan a la IA: sin caracteres de control y con largo acotado.
MAX_LABEL_CHARS = 80
# Filas agregadas por operación que pueden viajar a la IA (las series temporales conservan más períodos).
MAX_CONTEXT_ROWS = 40
MAX_CONTEXT_TEMPORAL_ROWS = 120
# Series y combinaciones de categorías descriptas por operación en el resumen.
MAX_SUMMARY_SERIES = 6
MAX_SUMMARY_SPLITS = 8
# Hechos del resumen ejecutivo descriptivo (uno por operación calculada).
MAX_EXECUTIVE_FACTS = 6
# Tamaño aproximado del esquema de respuesta (con los claims), que también cuenta como entrada.
INTERPRETATION_SCHEMA_CHARS = 2400

AGGREGATE_LABELS = {
    "count": "Cantidad de registros",
    "sum": "Suma de {c}",
    "mean": "Promedio de {c}",
    "median": "Mediana de {c}",
    "min": "Mínimo de {c}",
    "max": "Máximo de {c}",
    "distinct_count": "Valores distintos de {c}",
    "share_pct": "Participación sobre el total",
    "value": "{c}",
}


# --- Almacén de ejecuciones ------------------------------------------------------------

class ExecutionStore:
    """Resultados de Pandas en memoria del proceso, con dueño y vencimiento (como los planes)."""

    def __init__(self, clock=time.monotonic) -> None:
        self._clock = clock
        self._entries: OrderedDict[str, dict] = OrderedDict()
        self._lock = threading.Lock()

    def save(self, result: dict, summary: dict, objective: str | None, owner: str) -> str:
        # Se guarda solo lo que necesita la interpretación (≈ decenas de KB), no el resultado completo
        # (que con dispersiones y agrupaciones grandes ocupa ~15 MB en memoria).
        context = build_context({"result": result, "summary": summary, "objective": objective})
        with self._lock:
            now = self._clock()
            for eid in [k for k, v in self._entries.items() if v["expires_at"] <= now]:
                del self._entries[eid]
            mine = [k for k, v in self._entries.items() if v["owner"] == owner]
            for eid in mine[: max(0, len(mine) - MAX_EXECUTIONS_PER_OWNER + 1)]:
                del self._entries[eid]
            execution_id = secrets.token_urlsafe(16)
            self._entries[execution_id] = {"context": context, "owner": owner, "expires_at": now + EXECUTION_TTL_SECONDS}
            while len(self._entries) > MAX_STORED_EXECUTIONS:
                self._entries.popitem(last=False)
            return execution_id

    def get(self, execution_id: str, owner: str) -> dict | None:
        entry = self._entries.get(execution_id)
        if entry is None or not secrets.compare_digest(entry["owner"], owner) or entry["expires_at"] <= self._clock():
            return None
        return entry


# --- Formato --------------------------------------------------------------------------

def fmt(value: float | None, decimals: int = 2) -> str:
    """Número con el formato de la interfaz (es-AR): 69.060 · 12,5 · 0,87."""
    if value is None:
        return "—"
    text = f"{value:,.{decimals}f}".replace(",", "\x00").replace(".", ",").replace("\x00", ".")
    if "," in text:
        text = text.rstrip("0").rstrip(",")
    return "0" if text in ("-0", "") else text


def measure_label(m: dict) -> str:
    return AGGREGATE_LABELS.get(m["aggregate"], "{c}").format(c=m["column"])


def with_unit(value: float | None, m: dict) -> str:
    if m["aggregate"] == "share_pct":
        return f"{fmt(value)} %"
    unit = m.get("unit")
    if unit and m["aggregate"] not in ("count", "distinct_count"):
        return f"{fmt(value)} {unit}"
    return fmt(value)


def operation_title(op: dict) -> str:
    description = (op.get("description") or "").strip()
    if description and description not in ("—", "-"):
        return description
    return measure_label(op["measures"][0]) if op.get("measures") else op["operation"]


# --- Resumen descriptivo (sin IA) --------------------------------------------------------

def _indexes(op: dict, names: list[str]) -> list[int]:
    return [op["dimensions"].index(n) for n in names if n in op["dimensions"]]


def _label(keys: list[str], idx: list[int], op: dict) -> str:
    return ", ".join(f"{op['dimensions'][i]} = {keys[i]}" for i in idx)


def _split_groups(op: dict) -> list[tuple[str, list[dict]]]:
    """Filas agrupadas por las dimensiones que definen la medida: cada grupo es una magnitud aparte."""
    split_idx = _indexes(op, op.get("split_dimensions") or [])
    rows = op["rows"]
    if not split_idx:
        return [("", rows)]
    key = lambda r: tuple(r["keys"][i] for i in split_idx)  # noqa: E731
    return [
        (", ".join(f"{op['dimensions'][i]} = {v}" for i, v in zip(split_idx, k)), list(g))
        for k, g in groupby(sorted(rows, key=key), key=key)
    ]


def _scalar_facts(op: dict) -> list[str]:
    facts = []
    for prefix, rows in _split_groups(op)[:MAX_SUMMARY_SPLITS]:
        for row in rows[:1]:
            for m, v in zip(op["measures"], row["values"]):
                facts.append(f"{f'{prefix}: ' if prefix else ''}{measure_label(m)}: {with_unit(v, m)}.")
    return facts


def _temporal_facts(op: dict) -> list[str]:
    t_idx = op["dimensions"].index(op["temporal_dimension"])
    split_idx = _indexes(op, op.get("split_dimensions") or [])
    series_idx = [i for i in range(len(op["dimensions"])) if i != t_idx and i not in split_idx]
    m = op["measures"][0]
    key = lambda r: tuple(r["keys"][i] for i in split_idx + series_idx)  # noqa: E731
    groups = [(k, sorted(g, key=lambda r: r["keys"][t_idx])) for k, g in groupby(sorted(op["rows"], key=key), key=key)]
    # Las series con mayor magnitud primero; el resto se informa como cantidad.
    groups.sort(key=lambda kg: -sum(abs(r["values"][0] or 0) for r in kg[1]))
    facts = []
    for k, rows in groups[:MAX_SUMMARY_SERIES]:
        points = [(r["keys"][t_idx], r["values"][0]) for r in rows if r["values"][0] is not None]
        if not points:
            continue
        name = ", ".join(f"{op['dimensions'][i]} = {v}" for i, v in zip(split_idx + series_idx, k))
        head = f"{measure_label(m)}{f' ({name})' if name else ''}"
        (first_p, first_v), (last_p, last_v) = points[0], points[-1]
        if len(points) == 1:
            facts.append(f"{head}: {with_unit(first_v, m)} en {first_p} (un solo período).")
            continue
        change = last_v - first_v
        pct = f" ({'+' if change >= 0 else ''}{fmt(change / abs(first_v) * 100, 1)} %)" if first_v else ""
        high = max(points, key=lambda p: p[1])
        low = min(points, key=lambda p: p[1])
        facts.append(
            f"{head}: pasó de {with_unit(first_v, m)} en {first_p} a {with_unit(last_v, m)} en {last_p}; "
            f"variación de {'+' if change >= 0 else ''}{with_unit(change, m)}{pct}. "
            f"Máximo: {with_unit(high[1], m)} en {high[0]}; mínimo: {with_unit(low[1], m)} en {low[0]}."
        )
    if len(groups) > MAX_SUMMARY_SERIES:
        facts.append(f"Se describen las {MAX_SUMMARY_SERIES} series de mayor magnitud de {len(groups)}.")
    return facts


def _grouped_facts(op: dict) -> list[str]:
    split_idx = _indexes(op, op.get("split_dimensions") or [])
    group_idx = [i for i in range(len(op["dimensions"])) if i not in split_idx]
    measures = op["measures"]
    main = 0
    share = next((i for i, m in enumerate(measures) if m["aggregate"] == "share_pct"), None)
    facts = []
    splits = _split_groups(op)
    for prefix, rows in splits[:MAX_SUMMARY_SPLITS]:
        valued = [r for r in rows if r["values"][main] is not None]
        if not valued:
            continue
        top = max(valued, key=lambda r: r["values"][main])
        bottom = min(valued, key=lambda r: r["values"][main])
        m = measures[main]
        lead = f"{prefix}: " if prefix else ""
        text = f"{lead}{measure_label(m)} en {len(valued)} grupos. Mayor: {_label(top['keys'], group_idx, op)} con {with_unit(top['values'][main], m)}"
        if share is not None and top["values"][share] is not None:
            text += f" ({with_unit(top['values'][share], measures[share])} del total)"
        if len(valued) > 1:
            text += f"; menor: {_label(bottom['keys'], group_idx, op)} con {with_unit(bottom['values'][main], m)}"
        facts.append(text + ".")
    if len(splits) > MAX_SUMMARY_SPLITS:
        facts.append(f"Se describen {MAX_SUMMARY_SPLITS} de {len(splits)} categorías de {', '.join(op['split_dimensions'])}.")
    return facts


def _histogram_facts(op: dict) -> list[str]:
    valued = [r for r in op["rows"] if r["values"][0] is not None]
    if not valued:
        return []
    mode = max(valued, key=lambda r: r["values"][0])
    column = op["columns"][0] if op.get("columns") else op["dimensions"][0]
    return [
        f"{fmt(op.get('rows_used'), 0)} valores de {column} distribuidos en {len(valued)} intervalos, "
        f"de {valued[0]['keys'][0]} a {valued[-1]['keys'][0]}. "
        f"Intervalo con más registros: {mode['keys'][0]} ({fmt(mode['values'][0], 0)} registros)."
    ]


def _strength(r: float) -> str:
    a = abs(r)
    return "débil" if a < 0.3 else "moderada" if a < 0.7 else "fuerte"


def _scatter_facts(op: dict) -> list[str]:
    stats = op.get("stats") or {}
    pearson, spearman = stats.get("pearson"), stats.get("spearman")
    x, y = (op.get("columns") or ["X", "Y"])[:2]
    if pearson is None or spearman is None:
        return [f"La correlación entre {x} y {y} no está definida (una de las columnas es constante)."]
    sign = "positiva" if pearson >= 0 else "negativa"
    return [
        f"Correlación de Pearson entre {x} y {y}: {fmt(pearson, 3)} (asociación lineal {_strength(pearson)}, {sign}); "
        f"Spearman: {fmt(spearman, 3)}; {fmt(stats.get('n'), 0)} pares. Una correlación no implica causalidad."
    ]


def _roc_facts(op: dict) -> list[str]:
    stats = op.get("stats") or {}
    auc = stats.get("auc")
    if auc is None:
        return []
    quality = ("sin capacidad de discriminación" if auc < 0.6 else "pobre" if auc < 0.7
               else "aceptable" if auc < 0.8 else "buena" if auc < 0.9 else "excelente")
    return [
        f"AUC: {fmt(auc, 3)} (discriminación {quality}, según la escala habitual de 0,5 a 1) con "
        f"{fmt(stats.get('positives'), 0)} casos positivos y {fmt(stats.get('negatives'), 0)} negativos. "
        "Evalúa puntuaciones existentes: no se entrenó ningún modelo."
    ]


def operation_facts(op: dict) -> list[str]:
    if op["status"] != "ok" or (not op.get("rows") and op["operation"] not in ("scatter", "roc_curve")):
        return []
    if op["operation"] == "scatter":
        return _scatter_facts(op)
    if op["operation"] == "roc_curve":
        return _roc_facts(op)
    if op["operation"] == "histogram":
        return _histogram_facts(op)
    free = [d for d in op["dimensions"] if d not in (op.get("split_dimensions") or [])]
    if not free:
        return _scalar_facts(op)
    if op.get("temporal_dimension") in op["dimensions"]:
        return _temporal_facts(op)
    return _grouped_facts(op)


def _refs(result: dict):
    for p, plan in enumerate(result["results"], start=1):
        for o, op in enumerate(plan["operations"], start=1):
            yield f"P{p}.O{o}", plan, op


def _net_labels(facts: list[str], op: dict) -> list[str]:
    """Una suma de valores positivos y negativos se nombra «suma neta» (no es un saldo de cuenta ni un total de gastos o ingresos)."""
    for column in op.get("signed_measures") or []:
        facts = [f.replace(f"Suma de {column}", f"Suma neta de {column}") for f in facts]
    return facts


def descriptive_summary(result: dict) -> dict:
    """Resumen verificable de los resultados de Pandas. No usa IA ni calcula nada que el motor no haya devuelto."""
    items = []
    for ref, plan, op in _refs(result):
        error = op.get("error") if op["status"] == "error" else None
        items.append({
            "ref": ref,
            "plan_title": plan["title"],
            "source_alias": plan["source_alias"],
            "title": operation_title(op),
            "operation": op["operation"],
            "status": op["status"],
            "facts": _net_labels(operation_facts(op), op) + [
                f"«{column}» tiene valores positivos y negativos: su suma es neta (no es el saldo de una cuenta ni un total de "
                "gastos o de ingresos). Sin saber qué significa el signo en los datos, no se distinguen ingresos de egresos."
                for column in op.get("signed_measures") or []
            ],
            "warnings": list(op.get("warnings") or []),
            "error": error,
        })
    failed = [i for i in items if i["status"] == "error"]
    plan_errors = [w for plan in result["results"] if not plan["operations"] for w in plan.get("warnings", [])]
    notes = ["Resumen generado automáticamente a partir de los resultados de Pandas, sin intervención de la IA."]
    if failed:
        notes.append(
            f"{len(failed)} de {len(items)} operaciones no se pudieron calcular: se informan como limitaciones y no "
            "se extraen conclusiones de ellas."
        )
    notes += plan_errors
    status = "empty" if not items or len(failed) == len(items) else "partial" if failed or plan_errors else "complete"
    # Resumen ejecutivo descriptivo: el primer hecho de cada operación calculada, sin redacción de la IA.
    computed = len(items) - len(failed)
    executive = [f"Se calcularon {computed} de {len(items)} operaciones con Pandas."]
    executive += [i["facts"][0] for i in items if i["facts"]][:MAX_EXECUTIVE_FACTS]
    if failed:
        executive.append(f"Sin resultados: {', '.join(i['ref'] for i in failed)} (ver limitaciones).")
    return {"generated_by": "pandas", "status": status, "executive": executive, "items": items, "notes": notes}


# --- Contexto para la IA ---------------------------------------------------------------

CONTROL_CHARS = re.compile(r"[\x00-\x1f\x7f]")


def _safe_label(value: str) -> str:
    """Etiqueta de un resultado para la IA: es un dato, no una instrucción (sin saltos de línea y acotada)."""
    return CONTROL_CHARS.sub(" ", str(value))[:MAX_LABEL_CHARS]


SAFE_STATS = ("pearson", "spearman", "n", "auc", "positives", "negatives", "bins", "rule", "sampled", "shown")


def build_context(entry: dict) -> InterpretationContext:
    """Contexto AGREGADO a partir de la ejecución guardada. Lo arma el backend: el navegador no puede alterarlo."""
    result, summary = entry["result"], entry["summary"]
    facts = {i["ref"]: i["facts"] for i in summary["items"]}
    operations = []
    for ref, plan, op in _refs(result):
        points = op["operation"] in ("scatter", "roc_curve")  # puntos casi individuales: nunca viajan
        rows = [] if points else op["rows"]
        limit = MAX_CONTEXT_TEMPORAL_ROWS if op.get("temporal_dimension") else MAX_CONTEXT_ROWS
        if len(rows) > limit:
            if not op.get("temporal_dimension") and op["operation"] != "histogram":
                rows = sorted(rows, key=lambda r: -(r["values"][0] or 0))
            rows = rows[:limit]
        # Tantos grupos como registros usados: cada grupo sería un registro individual. No se envían.
        withheld = bool(rows) and bool(op.get("dimensions")) and len(op["rows"]) >= (op.get("rows_used") or 0) > 1
        if withheld:
            rows = []
        stats = {k: v for k, v in (op.get("stats") or {}).items() if k in SAFE_STATS} or None
        rows = [{"keys": [_safe_label(k) for k in r["keys"]], "values": r["values"]} for r in rows]
        operations.append(ContextOperation(
            ref=ref, plan_title=plan["title"], source_alias=plan["source_alias"], operation=op["operation"],
            description=operation_title(op), status=op["status"], dimensions=op.get("dimensions") or [],
            split_dimensions=op.get("split_dimensions") or [], temporal_dimension=op.get("temporal_dimension"),
            period=op.get("period"), measures=[ContextMeasure(**m) for m in op.get("measures") or []],
            rows=[ContextRow(keys=r["keys"], values=r["values"]) for r in rows], rows_total=len(op.get("rows") or []),
            rows_withheld=withheld, rows_used=op.get("rows_used"), signed_measures=list(op.get("signed_measures") or []), stats=stats, warnings=list(op.get("warnings") or []), error=op.get("error"),
        ))
    return InterpretationContext(
        objective=entry.get("objective"),
        sources=[ContextSource(**s) for s in result["sources"]],
        operations=operations,
        descriptive_summary=[ContextFacts(ref=r, facts=f) for r, f in facts.items() if f],
    )


def estimate_interpretation(context: InterpretationContext, settings: Settings) -> tuple[int, float | None]:
    tokens = estimate_tokens(INTERPRETATION_INSTRUCTIONS, build_input(context)) + INTERPRETATION_SCHEMA_CHARS // 3
    prices = model_prices(settings.openai_model, settings.openai_price_input_per_1m, settings.openai_price_output_per_1m)
    return tokens, (cost_usd(prices, tokens, settings.ai_max_output_tokens) if prices else None)


# --- Verificación de la respuesta ------------------------------------------------------
#
# Determinística y conservadora. Cada cifra de la IA debe venir declarada como un `Claim`
# (operación, medida, categorías e indicador, período, unidad, tipo y valor) y se RECALCULA
# sobre las filas de Pandas que recibió la IA. Después se exige que el texto esté atado a sus
# claims: nombra sus categorías y períodos, no nombra otras categorías de esas operaciones,
# cada cifra escrita coincide con un claim verificado (valor y unidad) y la dirección
# («crece», «cae») coincide con el signo de la variación. Lo que no cumple se descarta.
# Las afirmaciones sin cifras no se pueden verificar: se conservan marcadas como no verificadas.

NUMBER_RE = re.compile(r"(?<![\w.,])[-+]?\d+(?:[.,]\d+)*")
REF_RE = re.compile(r"\bP\d+\.O\d+\b")
CAUSAL_RE = re.compile(
    r"\b(causa(?:n|ron|do|da)?|caus[óo]|provoca\w*|provoc[óo]|se deben? a|debido a|a causa de|gracias a|"
    r"es responsable|son responsables|como consecuencia|es consecuencia|por efecto de|se explica(?:n)? por|"
    r"impulsad[oa]s? por|explica(?:n)? (?:el|la|los|las) (?:aumento|caída|crecimiento|baja|suba))\b",
    re.IGNORECASE,
)
DISCLAIMER_RE = re.compile(r"causalidad|\bno (?:implica|demuestra|prueba|permite)", re.IGNORECASE)
RISE_RE = re.compile(r"\b(crec\w*|aument\w*|sub(?:e|en|ió|ieron|a|ida)|alza|increment\w*)\b", re.IGNORECASE)
FALL_RE = re.compile(r"\b(cae|caen|cay[óo]|cayeron|caída|baj(?:a|ó|aron)|disminu\w*|descen\w*|reduj\w*|reducción|retroce\w*)\b",
                     re.IGNORECASE)
SENTENCE_RE = re.compile(r"(?<=[.!?])\s+")
# Palabras que presentan una cifra como flujo de un solo sentido (gasto, ingreso, cobro, pago) o como saldo de una cuenta.
FLOW_RE = re.compile(r"\b(gast\w*|egres\w*|ingres\w*|cobr\w*|pagu[eé]|pagaste|pagó|pagaron|desembols\w*|ganancia\w*|gan[oó]|saldo\w*)\b",
                     re.IGNORECASE)
# Números chicos sin unidad («dos series», «3 rubros») que no son cifras de los resultados.
FREE_INTEGERS = set(range(0, 13))
STATISTICS = ("pearson", "spearman", "auc", "n", "positives", "negatives")
COUNT_AGGREGATES = ("count", "distinct_count")
MAX_REJECTION_NOTES = 12


def _readings(token: str) -> list[tuple[float, int]]:
    """Interpretaciones posibles de un número escrito (formato es-AR o en-US) con su cantidad de decimales."""
    token = token.lstrip("+")
    sign = -1.0 if token.startswith("-") else 1.0
    token = token.lstrip("-")
    out = []
    for thousands, decimal in ((".", ","), (",", ".")):
        whole, _, fraction = token.partition(decimal)
        if decimal in fraction or thousands in fraction:
            continue
        groups = whole.split(thousands)
        # Separador de miles válido solo con grupos de 3 dígitos: "0,5" no es "05".
        if len(groups) > 1 and (not 1 <= len(groups[0]) <= 3 or any(len(g) != 3 for g in groups[1:])):
            continue
        out.append((sign * float("".join(groups) + (f".{fraction}" if fraction else "")), len(fraction)))
    return out


def _decimals(value: float) -> int:
    text = repr(float(value))
    if "e" in text or "." not in text:
        return 0 if "e" not in text else 6
    return min(len(text.split(".")[1].rstrip("0")), 6)


def _matches(written: float, decimals: int, actual: float | None) -> bool:
    """La cifra escrita es el valor real con esa precisión (o redondeado a ella)."""
    return actual is not None and abs(abs(written) - abs(actual)) <= 0.5 * 10 ** -decimals + 1e-9


def _norm(text: str | None) -> str:
    return (text or "").strip().casefold()


def _mentions(text: str, label: str) -> bool:
    return re.search(rf"(?<!\w){re.escape(label)}(?!\w)", text, re.IGNORECASE) is not None


@dataclass
class _Checked:
    claim: Claim
    actual: float
    unit: str | None
    # Categorías, indicador y períodos que la afirmación debe nombrar.
    labels: list[str]


def _effective_unit(op: ContextOperation, aggregate: str, unit: str | None, keys: dict[str, str]) -> str | None:
    if aggregate == "share_pct":
        return "%"
    if aggregate in COUNT_AGGREGATES:
        return None
    if unit:
        return unit
    # Formato largo: la unidad la indica la categoría de la columna «unidad» que define la medida.
    for dimension in op.split_dimensions:
        if any(w in _norm(dimension) for w in ("unidad", "unit")):
            return keys.get(dimension)
    return None


def _unit_ok(claimed: str | None, expected: str | None) -> bool:
    if expected is None:
        return _norm(claimed) in ("", "registros", "casos")
    return _norm(claimed) == _norm(expected)


def check_claim(claim: Claim, ops: dict[str, ContextOperation]) -> tuple[_Checked | None, str | None]:
    """Recalcula un claim sobre las filas de Pandas. Devuelve (claim verificado, None) o (None, motivo)."""
    op = ops.get(claim.ref)
    if op is None:
        return None, f"cita {claim.ref}, que no existe"
    if op.status != "ok":
        return None, f"cita {claim.ref}, que no se pudo calcular"
    if claim.kind == "statistic":
        actual = (op.stats or {}).get(_norm(claim.measure)) if _norm(claim.measure) in STATISTICS else None
        if not isinstance(actual, (int, float)) or isinstance(actual, bool):
            return None, f"{claim.ref} no tiene el estadístico «{claim.measure}»"
        if claim.unit:
            return None, f"el estadístico «{claim.measure}» no tiene unidad"
        if not _matches(claim.value, _decimals(claim.value), actual):
            return None, f"valor incorrecto de {claim.measure} en {claim.ref}: el resultado es {fmt(actual, 3)}"
        return _Checked(claim, float(actual), None, []), None
    if op.rows_withheld or not op.rows:
        return None, f"{claim.ref} no tiene resultados agregados que permitan verificar la cifra"

    want_share = claim.kind == "share_pct"
    index = next((i for i, m in enumerate(op.measures)
                  if _norm(m.column) == _norm(claim.measure) and (m.aggregate == "share_pct") == want_share), None)
    if index is None:
        return None, f"{claim.ref} no tiene la medida «{claim.measure}»" + (" como participación" if want_share else "")
    measure = op.measures[index]
    dims = {_norm(d): d for d in op.dimensions}
    keys: dict[str, str] = {}
    for key in claim.keys:
        dimension = dims.get(_norm(key.dimension))
        if dimension is None:
            return None, f"{claim.ref} no tiene la dimensión «{key.dimension}»"
        keys[dimension] = key.value
    position = {d: i for i, d in enumerate(op.dimensions)}

    def same(row: ContextRow, wanted: dict[str, str]) -> bool:
        return all(_norm(row.keys[position[d]]) == _norm(v) for d, v in wanted.items())

    if claim.kind in ("change", "change_pct"):
        temporal = op.temporal_dimension
        if temporal not in position:
            return None, f"{claim.ref} no es una serie temporal: no admite variaciones"
        if set(keys) != set(op.dimensions) - {temporal}:
            return None, "la variación no identifica todas sus categorías (indicador, grupo o unidad)"
        series = {_norm(r.keys[position[temporal]]): (r.keys[position[temporal]], r.values[index])
                  for r in op.rows if same(r, keys)}
        start, end = series.get(_norm(claim.period_from)), series.get(_norm(claim.period_to))
        if start is None or end is None or start[1] is None or end[1] is None:
            return None, f"{claim.ref} no tiene los períodos «{claim.period_from}» y «{claim.period_to}» para esas categorías"
        if claim.kind == "change":
            actual, unit = end[1] - start[1], _effective_unit(op, measure.aggregate, measure.unit, keys)
        else:
            if start[1] == 0:
                return None, "la variación porcentual no está definida (el valor inicial es 0)"
            actual, unit = (end[1] - start[1]) / abs(start[1]) * 100, "%"
        labels = [*keys.values(), start[0], end[0]]
    else:
        if set(keys) != set(op.dimensions):
            return None, "la cifra no identifica todas sus categorías (indicador, grupo, período o unidad)"
        row = next((r for r in op.rows if same(r, keys)), None)
        if row is None or row.values[index] is None:
            return None, f"{claim.ref} no tiene un resultado para {', '.join(f'{d} = {v}' for d, v in keys.items())}"
        actual = row.values[index]
        unit = _effective_unit(op, measure.aggregate, measure.unit, keys)
        labels = [row.keys[position[d]] for d in op.dimensions]
    if not _unit_ok(claim.unit, unit):
        return None, f"unidad incorrecta en {claim.ref}: corresponde {unit or 'sin unidad'}, no {claim.unit or 'sin unidad'}"
    if not _matches(claim.value, _decimals(claim.value), actual):
        return None, f"valor incorrecto en {claim.ref}: el resultado es {fmt(actual)}{f' {unit}' if unit else ''}"
    # El signo también cuenta: una caída no es un aumento.
    if claim.kind in ("change", "change_pct") and actual != 0 and claim.value * actual < 0:
        return None, f"signo incorrecto de la variación en {claim.ref}"
    return _Checked(claim, float(actual), unit, labels), None


def _labels_of(ops: list[ContextOperation]) -> set[str]:
    """Categorías y períodos de las operaciones citadas (para detectar atribuciones a otro grupo)."""
    return {k for op in ops for row in op.rows for k in row.keys if len(k.strip()) >= 2}


def _units_of(ops: list[ContextOperation]) -> set[str]:
    units = {m.unit for op in ops for m in op.measures if m.unit}
    for op in ops:
        for d in op.split_dimensions:
            if any(w in _norm(d) for w in ("unidad", "unit")):
                units |= {r.keys[op.dimensions.index(d)] for r in op.rows}
    return units


def _check_text(text: str, checked: list[_Checked], ops: list[ContextOperation]) -> str | None:
    """Ata el texto a sus claims verificados. Devuelve el motivo si no se puede afirmar así."""
    bare = REF_RE.sub(" ", text)
    if CAUSAL_RE.search(bare) and not DISCLAIMER_RE.search(bare):
        return "atribuye causas que los resultados no permiten establecer"
    required = {_norm(label): label for c in checked for label in c.labels}
    for label in required.values():
        if not _mentions(bare, label):
            return f"no nombra «{label}», al que corresponde su cifra"
    labels = _labels_of(ops)
    for label in labels:
        if _norm(label) not in required and _mentions(bare, label) and checked:
            return f"nombra «{label}», que no corresponde a las cifras que declara"
    # Los nombres de categorías y períodos con dígitos («2025-01») no son cifras.
    for label in sorted(labels, key=len, reverse=True):
        bare = re.sub(rf"(?<!\w){re.escape(label)}(?!\w)", " ", bare, flags=re.IGNORECASE)
    units = _units_of(ops) | {"%"}
    for match in NUMBER_RE.finditer(bare):
        after = bare[match.end():match.end() + 16].lstrip()
        unit = "%" if after.startswith("%") else next(
            (u for u in sorted(units, key=len, reverse=True) if re.match(rf"{re.escape(u)}(?!\w)", after, re.IGNORECASE)), None
        )
        readings = _readings(match.group())
        if unit is None and any(v.is_integer() and abs(v) in FREE_INTEGERS for v, _ in readings):
            continue
        bound = any(
            _matches(value, decimals, c.actual) and (unit is None or _norm(unit) == _norm(c.unit))
            for value, decimals in readings for c in checked
        )
        if not bound:
            return f"la cifra «{match.group()}{f' {unit}' if unit else ''}» no corresponde a ninguna cifra verificada"
    # Una suma neta (de positivos y negativos) no es un gasto, un ingreso ni un saldo: no se la presenta así.
    signed = {(op.ref, m) for op in ops for m in op.signed_measures}
    if FLOW_RE.search(bare) and any((c.claim.ref, c.claim.measure) in signed for c in checked):
        return "presenta una suma neta (valores positivos y negativos) como si fuera un gasto, un ingreso o un saldo"
    changes = [c for c in checked if c.claim.kind in ("change", "change_pct")]
    if changes and RISE_RE.search(bare) and all(c.actual < 0 for c in changes):
        return "describe como aumento una variación negativa"
    if changes and FALL_RE.search(bare) and all(c.actual > 0 for c in changes):
        return "describe como caída una variación positiva"
    return None


def _verify_item(item: InterpretationItem, ops: dict[str, ContextOperation]) -> tuple[dict | None, str | None]:
    refs = list(dict.fromkeys([*item.evidence, *(c.ref for c in item.claims)]))
    cited = [ops[r] for r in refs if r in ops and ops[r].status == "ok"]
    if not cited:
        return None, "no se apoya en ninguna operación calculada"
    if any(r in ops and ops[r].status != "ok" for r in refs):
        return None, "se apoya en una operación que no se pudo calcular"
    checked = []
    for claim in item.claims:
        result, reason = check_claim(claim, ops)
        if reason:
            return None, reason
        checked.append(result)
    if not checked:
        # Sin cifras declaradas: solo se conserva si tampoco escribe cifras, y se marca como no verificada.
        bare = REF_RE.sub(" ", item.text)
        for label in sorted(_labels_of(cited), key=len, reverse=True):
            bare = re.sub(rf"(?<!\w){re.escape(label)}(?!\w)", " ", bare, flags=re.IGNORECASE)
        if CAUSAL_RE.search(bare) and not DISCLAIMER_RE.search(bare):
            return None, "atribuye causas que los resultados no permiten establecer"
        if any(not (v.is_integer() and abs(v) in FREE_INTEGERS) for t in NUMBER_RE.findall(bare) for v, _ in _readings(t)):
            return None, "escribe cifras sin declararlas para su verificación"
        return {"text": item.text, "evidence": [c.ref for c in cited], "status": "unverified", "claims": []}, None
    reason = _check_text(item.text, checked, cited)
    if reason:
        return None, reason
    return {
        "text": item.text,
        "evidence": [c.ref for c in cited],
        "status": "verified",
        "claims": [
            {**c.claim.model_dump(mode="json"), "value": c.actual, "unit": c.unit} for c in checked
        ],
    }, None


def allowed_numbers(context: InterpretationContext) -> list[float]:
    """Cifras presentes en el contexto (para limitaciones y calidad de datos, que citan advertencias del motor)."""
    text = json.dumps(context.model_dump(mode="json"), ensure_ascii=False)
    values = set()
    for token in NUMBER_RE.findall(text):
        for value, _ in _readings(token):
            values.add(abs(value))
    return sorted(values)


def _verified(token: str, allowed: list[float]) -> bool:
    for value, decimals in _readings(token):
        if value.is_integer() and abs(value) in FREE_INTEGERS:
            return True
        if any(_matches(value, decimals, a) for a in allowed):
            return True
    return False


def _clean_notes(values: list[str], allowed: list[float], rejected: list[str], section: str) -> list[str]:
    """Limitaciones y calidad de datos: sin causas y solo con cifras que figuran en los resultados o advertencias."""
    kept = []
    for text in values:
        bare = REF_RE.sub(" ", text)
        if CAUSAL_RE.search(bare) and not DISCLAIMER_RE.search(bare):
            rejected.append(f"{section}: atribuye causas que los resultados no permiten establecer")
        elif not all(_verified(t, allowed) for t in NUMBER_RE.findall(bare)):
            rejected.append(f"{section}: cita cifras que no figuran en los resultados")
        else:
            kept.append(text)
    return kept


SECTIONS = {
    "executive_summary": "resumen ejecutivo",
    "findings": "hallazgo",
    "trends": "tendencia",
    "recommendations": "recomendación",
}


def verify_interpretation(reply: AIInterpretation, context: InterpretationContext) -> tuple[dict, list[str]]:
    """Recalcula cada cifra y descarta lo que no está respaldado. Devuelve la interpretación verificada y las notas."""
    ops = {op.ref: op for op in context.operations}
    rejected: list[str] = []
    verified: dict = {}
    for key, section in SECTIONS.items():
        kept = []
        for item in getattr(reply, key):
            result, reason = _verify_item(item, ops)
            if result is None:
                rejected.append(f"{section}: {reason}")
            else:
                kept.append(result)
        verified[key] = kept
    allowed = allowed_numbers(context)
    verified["limitations"] = _clean_notes(reply.limitations, allowed, rejected, "limitación")
    verified["data_quality"] = _clean_notes(reply.data_quality, allowed, rejected, "calidad de datos")

    notes = []
    if rejected:
        notes.append(f"Se descartaron {len(rejected)} afirmaciones que no se pudieron verificar contra los resultados:")
        notes += [f"Descartada ({r})." for r in rejected[:MAX_REJECTION_NOTES]]
        if len(rejected) > MAX_REJECTION_NOTES:
            notes.append(f"Y {len(rejected) - MAX_REJECTION_NOTES} más.")
    unverified = sum(i["status"] == "unverified" for key in SECTIONS for i in verified[key])
    if unverified:
        notes.append(f"{unverified} afirmaciones sin cifras se muestran como no verificadas automáticamente.")
    failed = sorted(op.ref for op in context.operations if op.status != "ok")
    if failed:
        notes.append(f"Operaciones sin resultados (no se interpretan): {', '.join(failed)}.")
    return verified, notes


# --- Flujo: preparar → autorizar → enviar → verificar -----------------------------------

def prepare_interpretation(executions: ExecutionStore, store: AIRequestStore, *, execution_id: str, owner: str,
                           settings: Settings, provider: AIProvider) -> dict:
    entry = executions.get(execution_id, owner)
    if entry is None:
        raise AIGatewayError(404, "Los resultados ya no están disponibles (por ejemplo, se reinició el backend). Ejecutá el análisis de nuevo.")
    context: InterpretationContext = entry["context"]
    tokens, max_cost = estimate_interpretation(context, settings)
    if tokens > settings.ai_max_input_tokens:
        raise AIGatewayError(413, "Los resultados superan el tamaño máximo permitido para la IA. No se envió nada.")
    request_id, sha = store.prepare(context, owner)
    return {
        "request_id": request_id,
        "payload": context.model_dump(mode="json"),
        "payload_sha256": sha,
        "expires_in_seconds": store.ttl_seconds,
        "ai_enabled": settings.ai_enabled,
        "external_calls_implemented": bool(getattr(provider, "interpret", None)) and provider.implemented,
        "estimated_input_tokens": tokens,
        "estimated_max_cost_usd": round(max_cost, 6) if max_cost is not None else None,
    }


def authorize_interpretation(store: AIRequestStore, provider: AIProvider, budget: AIBudget, *, settings: Settings,
                             request_id: str, approved_sha256: str, owner: str) -> dict:
    if not settings.ai_enabled:
        store.cancel(request_id, owner)
        raise AIGatewayError(403, "La IA externa está deshabilitada (AI_ENABLED=false). No se envió nada.")
    context: InterpretationContext = store.consume(request_id, approved_sha256, owner)  # uso único desde aquí
    interpret = getattr(provider, "interpret", None)
    if interpret is None:
        raise AIGatewayError(501, "La interpretación con IA no está disponible. No se envió nada.")
    prices = check_sendable(provider, settings)
    tokens, max_cost = estimate_interpretation(context, settings)
    if tokens > settings.ai_max_input_tokens:
        raise AIGatewayError(413, "Los resultados superan el tamaño máximo permitido para la IA. No se envió nada.")
    result, cost = metered_call(
        lambda: interpret(context, settings), budget=budget, settings=settings, owner=owner, max_cost=max_cost, prices=prices
    )
    if not isinstance(result.reply, AIInterpretation):
        raise AIGatewayError(502, f"{result.problem or 'La respuesta de la IA no tenía el formato esperado.'} Se registró el consumo.")
    verified, notes = verify_interpretation(result.reply, context)
    if not verified["executive_summary"] and not verified["findings"]:
        raise AIGatewayError(
            502, "La interpretación de la IA no superó la verificación contra los resultados y se descartó. " + " ".join(notes[:2])
        )
    return {
        "interpretation": verified,
        "notes": notes,
        "usage": {
            "model": settings.openai_model,
            "input_tokens": result.input_tokens,
            "output_tokens": result.output_tokens,
            "cost_usd": round(cost, 6),
            "remaining_usd": budget.status(owner).remaining_usd,
        },
    }
