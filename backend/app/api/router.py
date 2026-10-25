
"""Router principal: agrupa los routers de cada recurso bajo el prefijo /api."""

from fastapi import APIRouter

from app.api.routes import health
from app.api.routes.ai import router as ai_router
from app.api.routes.datasets import router as datasets_router

api_router = APIRouter()

# Ruta de salud existente
api_router.include_router(health.router, tags=["salud"])

# Nuevo módulo de Ciencia de Datos
api_router.include_router(datasets_router)

# Frontera de privacidad para la IA (sin llamadas externas en la Fase 3B.1)
api_router.include_router(ai_router)

# Próximos routers:
# projects -> /api/projects
# assistant -> asistente inteligente
# analysis -> procesamiento y resultados
