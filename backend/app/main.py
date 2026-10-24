"""Punto de entrada de la API de DataDecision AI.

Ejecutar en desarrollo (desde la carpeta backend/):
    uvicorn app.main:app --reload
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.router import api_router
from app.core.config import get_settings


def create_app() -> FastAPI:
    """Crea y configura la aplicación FastAPI."""
    settings = get_settings()

    app = FastAPI(
        title=settings.app_name,
        version=settings.app_version,
        description="API de DataDecision AI: datasets, asistente de requisitos, análisis e informes.",
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
