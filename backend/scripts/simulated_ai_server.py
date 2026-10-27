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
