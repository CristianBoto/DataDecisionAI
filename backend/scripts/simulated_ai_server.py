"""Backend LOCAL con una IA SIMULADA, para probar el recorrido completo sin consumir créditos.

Uso (desde backend/, con el entorno activado):
    python scripts/simulated_ai_server.py

- No lee `backend/.env`: nunca usa la clave real de OpenAI ni la base real.
- Base SQLite temporal; crea una invitación y muestra el código para ingresar.
- La "IA" propone siempre el mismo tipo de plan a partir de los metadatos revisados
  (evolución de la primera medida por la primera categoría, un total y un histograma),
  así se ve también cómo se descartan las operaciones incompatibles.
- Solo escucha en 127.0.0.1. Se niega a arrancar en producción o en Render.

Todo lo demás es real: perfilado, revisión, validación de planes, motor Pandas y dashboard.
"""

from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

if os.environ.get("RENDER") or os.environ.get("ENVIRONMENT") == "production":
    sys.exit("Este servidor de prueba no se usa en producción.")

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import uvicorn  # noqa: E402

from app.core.config import Settings  # noqa: E402
from app.main import create_app  # noqa: E402
from app.schemas.ai_plan import AIAssistantReply  # noqa: E402
from app.schemas.interpretation import AIInterpretation  # noqa: E402
from app.services.openai_provider import ProviderResult  # noqa: E402


class SimulatedProvider:
    """Responde sin red. Solo usa los metadatos que la persona autorizó (como la IA real)."""

    implemented = True

    def send(self, context, settings) -> ProviderResult:
        source = context.sources[0]
        cols = {c.name: c for c in source.columns}
        temporal = [n for n, c in cols.items() if c.semantic_type == "temporal"]
        measures = [n for n, c in cols.items() if c.semantic_type == "quantitative"]
        if not measures:
            reply = {"message": "No encuentro una medida cuantitativa: ¿cuál querés analizar? (respuesta simulada)",
                     "interpreted_objective": context.objective, "source_relationship": "single",
                     "questions": [{"question": "¿Qué columna querés medir?", "reason": "No hay columnas cuantitativas.",
                                    "source_alias": source.alias, "column": None}], "plans": [], "warnings": []}
            return ProviderResult(AIAssistantReply.model_validate(reply), 900, 200)
        measure = measures[0]
        categories = [n for n, c in cols.items() if c.semantic_type == "categorical" and n not in cols[measure].split_by]
        operations = []
        if temporal:
            operations.append({"operation": "time_series", "columns": [temporal[0], measure], "group_by": categories[:1],
                               "description": f"Evolución de {measure}"})
        elif categories:
            operations.append({"operation": "group_by", "columns": [measure], "group_by": categories[:1],
                               "description": f"{measure} por {categories[0]}"})
        operations += [
            {"operation": "sum", "columns": [measure], "group_by": [], "description": "Total"},
            {"operation": "histogram", "columns": [measure], "group_by": [], "description": "Distribución"},
        ]
        reply = {
            "message": "Propuesta SIMULADA para verificar el recorrido (no proviene de OpenAI).",
            "interpreted_objective": context.objective, "source_relationship": "single", "questions": [], "warnings": [],
            "plans": [{"source_alias": source.alias, "title": "Plan de verificación", "rationale": "Respuesta simulada.",
                       "columns_needed": [measure, *temporal[:1], *categories[:1]], "operations": operations,
                       "charts": [], "limitations": ["Plan generado por la IA simulada de pruebas."]}],
        }
        return ProviderResult(AIAssistantReply.model_validate(reply), 1200, 400)


    def interpret(self, context, settings) -> ProviderResult:
        """Interpretación SIMULADA con claims. Incluye a propósito una atribución a otra categoría, un porcentaje
        erróneo y una frase causal, para que se vea cómo los descarta la verificación del backend."""
        ok = [o for o in context.operations if o.status == "ok"]
        failed = [o for o in context.operations if o.status == "error"]
        items, wrong = [], []
        series = next((o for o in ok if o.temporal_dimension and o.rows), None)
        if series:
            t = series.dimensions.index(series.temporal_dimension)
            others = [i for i in range(len(series.dimensions)) if i != t]
            first = series.rows[0]
            group = [r for r in series.rows if all(r.keys[i] == first.keys[i] for i in others)]
            group.sort(key=lambda r: r.keys[t])
            a, b = group[0], group[-1]
            keys = [{"dimension": series.dimensions[i], "value": a.keys[i]} for i in others]
            name = ", ".join(a.keys[i] for i in others)
            m = series.measures[0]
            unit = m.unit
            change = b.values[0] - a.values[0]
            claim = {"ref": series.ref, "measure": m.column, "keys": keys, "period_from": a.keys[t], "period_to": b.keys[t],
                     "unit": unit}
            items.append({"text": f"{name}: pasó de {a.values[0]:g} a {b.values[0]:g}{f' {unit}' if unit else ''} entre "
                                  f"{a.keys[t]} y {b.keys[t]}.",
                          "evidence": [series.ref],
                          "claims": [{**claim, "kind": "value", "keys": keys + [{"dimension": series.temporal_dimension, "value": a.keys[t]}],
                                      "period_from": None, "period_to": None, "value": a.values[0]},
                                     {**claim, "kind": "value", "keys": keys + [{"dimension": series.temporal_dimension, "value": b.keys[t]}],
                                      "period_from": None, "period_to": None, "value": b.values[0]}]})
            other = next((r for r in series.rows if any(r.keys[i] != a.keys[i] for i in others)), None)
            if other is not None:
                wrong.append({"text": f"{', '.join(other.keys[i] for i in others)} creció {change:g}{f' {unit}' if unit else ''} "
                                      f"entre {a.keys[t]} y {b.keys[t]}.",
                              "evidence": [series.ref], "claims": [{**claim, "kind": "change", "value": change}]})
            wrong.append({"text": f"{name} creció un 37 % entre {a.keys[t]} y {b.keys[t]}.", "evidence": [series.ref],
                          "claims": [{**claim, "kind": "change_pct", "unit": "%", "value": 37}]})
            wrong.append({"text": f"El aumento de {name} se debe a la publicidad.", "evidence": [series.ref], "claims": []})
        reply = {
            "executive_summary": [{"text": "Interpretación SIMULADA (no proviene de OpenAI).", "evidence": [o.ref for o in ok[:1]],
                                   "claims": []}] + items[:1],
            "findings": items + wrong,
            "trends": [],
            "recommendations": [{"text": "Revisar los resultados de cada operación antes de decidir.",
                                 "evidence": [o.ref for o in ok[:1]], "claims": []}],
            "limitations": ["Respuesta generada por la IA simulada de pruebas."]
            + [f"No se pudo calcular {o.ref}: {o.error}" for o in failed],
            "data_quality": [w for o in context.operations for w in o.warnings][:3],
        }
        return ProviderResult(AIInterpretation.model_validate(reply), 1500, 500)


def main() -> None:
    tmp = Path(tempfile.mkdtemp(prefix="ddai-simulada-"))
    settings = Settings(
        _env_file=None, environment="development", ai_enabled=True, openai_api_key="sk-simulada-no-real",
        database_url=f"sqlite:///{(tmp / 'prueba.db').as_posix()}", ai_legacy_usage_file=(tmp / "ninguno.json").as_posix(),
    )
    app = create_app(settings)
    app.state.ai_provider = SimulatedProvider()
    _, code = app.state.auth.create_invitation("Prueba con IA simulada", days=1)
    print(f"\nCódigo de invitación (solo para esta prueba local): {code}\n")
    uvicorn.run(app, host="127.0.0.1", port=int(os.environ.get("PORT", "8000")))


if __name__ == "__main__":
    main()
