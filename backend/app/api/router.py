
"""Router principal: agrupa los routers de cada recurso bajo el prefijo /api."""

from fastapi import APIRouter

from app.api.routes import health
from app.api.routes.ai import router as ai_router
from app.api.routes.analysis import router as analysis_router
from app.api.routes.auth import router as auth_router
from app.api.routes.datasets import router as datasets_router

api_router = APIRouter()

# Ruta de salud existente
api_router.include_router(health.router, tags=["salud"])

# Acceso por invitación (beta pública). El resto de los routers exige sesión.
api_router.include_router(auth_router)

# Nuevo módulo de Ciencia de Datos
api_router.include_router(datasets_router)

# Frontera de privacidad y conexión con la IA (Fases 3B.1 y 3B.2)
api_router.include_router(ai_router)

# Motor de análisis con Pandas: ejecuta planes aprobados (Fase 4A)
api_router.include_router(analysis_router)

# Próximos routers:
# projects -> /api/projects
