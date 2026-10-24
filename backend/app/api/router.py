
"""Router principal: agrupa los routers de cada recurso bajo el prefijo /api."""

from fastapi import APIRouter

from app.api.routes import health
from app.api.routes.datasets import router as datasets_router

api_router = APIRouter()

# Ruta de salud existente
api_router.include_router(health.router, tags=["salud"])

# Nuevo módulo de Ciencia de Datos
api_router.include_router(datasets_router)

# Próximos routers:
# projects -> /api/projects
# assistant -> asistente inteligente
# analysis -> procesamiento y resultados
