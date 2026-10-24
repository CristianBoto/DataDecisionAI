"""Router principal: agrupa los routers de cada recurso bajo el prefijo /api."""

from fastapi import APIRouter

from app.api.routes import health

api_router = APIRouter()
api_router.include_router(health.router, tags=["salud"])

# Próximos routers (ver docs/API_CONTRACT.md):
#   datasets  -> /api/datasets
#   projects  -> /api/projects (mensajes, propuesta, análisis, resultados, exportaciones)
