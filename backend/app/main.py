"""Punto de entrada de la API de DataDecision AI.

Ejecutar en desarrollo (desde la carpeta backend/):
    uvicorn app.main:app --reload
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.router import api_router
from app.core.config import get_settings
from app.core.upload_guard import UploadGuardMiddleware
from app.services.ai_gateway import AIRequestStore, NotImplementedProvider
from app.services.dataset_profiler import MAX_FILE_BYTES

# Margen para el encabezado y los separadores de multipart sobre el límite del archivo.
MULTIPART_OVERHEAD_BYTES = 1024 * 1024
UPLOAD_PATHS = ("/api/datasets/profile",)
AI_PATH_PREFIX = "/api/ai/"
AI_MAX_BODY_BYTES = 64 * 1024


def create_app() -> FastAPI:
    """Crea y configura la aplicación FastAPI."""
    settings = get_settings()

    app = FastAPI(
        title=settings.app_name,
        version=settings.app_version,
        description="API de DataDecision AI: datasets, asistente de requisitos, análisis e informes.",
    )

    # Frontera de IA: solicitudes preparadas en memoria y proveedor sin red (Fase 3B.1).
    app.state.ai_store = AIRequestStore()
    app.state.ai_provider = NotImplementedProvider()

    # Mismo control de origen para la IA, con un cuerpo pequeño (solo metadatos revisados).
    app.add_middleware(
        UploadGuardMiddleware,
        path_prefixes=(AI_PATH_PREFIX,),
        methods=("POST", "DELETE"),
        max_body_bytes=AI_MAX_BODY_BYTES,
        allowed_origins=settings.cors_origins,
        origin_message="Origen no autorizado para solicitudes de IA.",
    )

    # Control de origen y tamaño de las cargas, antes de leer el cuerpo.
    # Se agrega antes que CORS para quedar "adentro": sus errores llevan los
    # encabezados CORS y el frontend autorizado puede mostrarlos.
    app.add_middleware(
        UploadGuardMiddleware,
        paths=UPLOAD_PATHS,
        max_body_bytes=MAX_FILE_BYTES + MULTIPART_OVERHEAD_BYTES,
        allowed_origins=settings.cors_origins,
    )

    # CORS para que el frontend de Vite (localhost:5173) pueda llamar a la API en desarrollo.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=False,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
        allow_headers=["*"],
        expose_headers=["Content-Disposition"],
    )

    app.include_router(api_router, prefix="/api")
    return app


app = create_app()
