"""Punto de entrada de la API de DataDecision AI.

Ejecutar en desarrollo (desde la carpeta backend/):
    uvicorn app.main:app --reload
"""

from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.deps import ConcurrencyGate
from app.api.router import api_router
from app.api.routes.analysis import MAX_CONCURRENT_EXECUTIONS
from app.api.routes.datasets import MAX_PROFILES_PER_USER
from app.core.config import ConfigurationError, Settings, get_settings, validate_for_startup
from app.core.rate_limit import RateLimiter, RateLimitMiddleware
from app.core.security_headers import (
    HTTPSOnlyMiddleware,
    SafeErrorMiddleware,
    SecurityHeadersMiddleware,
    install_log_redaction,
)
from app.core.upload_guard import UploadGuardMiddleware
from app.services.ai_budget import AIBudget
from app.services.ai_gateway import AIConversationStore, AIPlanStore, AIRequestStore
from app.services.auth import AuthService, CloudflareTurnstile, DevelopmentTurnstile
from app.services.database import Database
from app.services.openai_provider import OpenAIProvider
from app.services.report import ExecutionStore

# Margen para el encabezado y los separadores de multipart sobre el límite del archivo.
MULTIPART_OVERHEAD_BYTES = 1024 * 1024
UPLOAD_PATHS = ("/api/datasets/profile",)
# Ejecución de análisis: hasta tres archivos (60 MB en total como máximo).
ANALYSIS_PATHS = ("/api/analysis/execute",)
ANALYSIS_MAX_BODY_BYTES = 60 * 1024 * 1024
AI_PATH_PREFIX = "/api/ai/"
AI_MAX_BODY_BYTES = 64 * 1024
AUTH_PATH_PREFIX = "/api/auth/"
AUTH_MAX_BODY_BYTES = 8 * 1024


def create_app(settings: Settings | None = None) -> FastAPI:
    """Crea y configura la aplicación FastAPI. Falla al arrancar si la configuración es insegura."""
    settings = settings or get_settings()
    validate_for_startup(settings)

    production = settings.is_production
    app = FastAPI(
        title=settings.app_name,
        version=settings.app_version,
        description="API de DataDecision AI: datasets, asistente de requisitos, análisis e informes.",
        # En producción no se publica el mapa de la API.
        docs_url=None if production else "/docs",
        redoc_url=None if production else "/redoc",
        openapi_url=None if production else "/openapi.json",
    )
    app.dependency_overrides[get_settings] = lambda: settings
    install_log_redaction()

    # Persistencia mínima y acceso por invitación (la autenticación no se puede desactivar).
    db = Database(settings.database_path, create_dir=not production)
    app.state.db = db
    app.state.auth = AuthService(
        db, session_ttl_seconds=settings.session_ttl_hours * 3600, max_sessions=settings.max_sessions_per_invitation
    )
    if settings.turnstile_secret_key:
        app.state.turnstile = CloudflareTurnstile(
            settings.turnstile_secret_key, expected_hostname=settings.turnstile_expected_hostname
        )
    elif production:  # pragma: no cover - validate_for_startup ya lo impide
        raise ConfigurationError("Turnstile es obligatorio en producción.")
    else:
        app.state.turnstile = DevelopmentTurnstile()
    app.state.rate_limiter = RateLimiter()

    # Frontera de IA: solicitudes, conversaciones y planes en memoria (con dueño);
    # proveedor OpenAI (solo tras una autorización de uso único); consumo en SQLite.
    app.state.ai_store = AIRequestStore()
    app.state.ai_provider = OpenAIProvider()
    app.state.ai_budget = AIBudget(
        db,
        budget_usd=settings.ai_budget_usd,
        user_budget_usd=settings.ai_user_budget_usd,
        user_daily_requests=settings.ai_user_daily_requests,
        global_daily_requests=settings.ai_global_daily_requests,
    )
    app.state.ai_budget.import_legacy_ledger(Path(settings.ai_legacy_usage_file))
    app.state.ai_plans = AIPlanStore()
    app.state.ai_conversations = AIConversationStore()
    # Fase 4C: resultados de Pandas para el informe y solicitudes de interpretación (separadas de las de planes).
    app.state.executions = ExecutionStore()
    app.state.interpretation_requests = AIRequestStore()
    # Tareas pesadas (perfilado y ejecución) comparten UN cupo, una por visitante. En producción, una a la
    # vez (Render Starter, 512 MB: dos a la vez suman ~120 MB medidos más copias de la carga y la respuesta,
    # sobre ~165 MB del proceso, sin margen razonable). El exceso se rechaza al instante con 429 (sin espera).
    app.state.heavy_gate = ConcurrencyGate(
        total=settings.heavy_tasks_limit,
        per_user=MAX_PROFILES_PER_USER,
        busy_message="El servidor está procesando otros archivos. Intentá de nuevo en unos segundos.",
    )
    app.state.profile_gate = app.state.heavy_gate
    app.state.execution_gate = ConcurrencyGate(
        total=MAX_CONCURRENT_EXECUTIONS,
        per_user=1,
        busy_message="Ya hay un análisis en ejecución. Intentá de nuevo en unos segundos.",
    )

    def has_session(token: str) -> bool:
        return bool(token) and len(token) <= 200 and app.state.auth.authenticate(token) is not None

    # Error inesperado: respuesta genérica y registro sin el mensaje de la excepción (puede contener datos).
    app.add_middleware(SafeErrorMiddleware)
    # Los middlewares agregados primero quedan más "adentro". Los controles de
    # origen, sesión y tamaño rechazan ANTES de leer el cuerpo; CORS queda afuera
    # para que el frontend autorizado pueda leer los errores.
    app.add_middleware(
        UploadGuardMiddleware,
        path_prefixes=(AUTH_PATH_PREFIX,),
        max_body_bytes=AUTH_MAX_BODY_BYTES,
        allowed_origins=settings.cors_origins,
        origin_message="Origen no autorizado.",
    )
    app.add_middleware(
        UploadGuardMiddleware,
        path_prefixes=(AI_PATH_PREFIX,),
        methods=("POST", "DELETE"),
        max_body_bytes=AI_MAX_BODY_BYTES,
        allowed_origins=settings.cors_origins,
        origin_message="Origen no autorizado para solicitudes de IA.",
        authenticate=has_session,
    )
    app.add_middleware(
        UploadGuardMiddleware,
        paths=ANALYSIS_PATHS,
        max_body_bytes=min(ANALYSIS_MAX_BODY_BYTES, 3 * settings.max_upload_bytes) + MULTIPART_OVERHEAD_BYTES,
        allowed_origins=settings.cors_origins,
        origin_message="Origen no autorizado para ejecutar análisis.",
        authenticate=has_session,
    )
    app.add_middleware(
        UploadGuardMiddleware,
        paths=UPLOAD_PATHS,
        max_body_bytes=settings.max_upload_bytes + MULTIPART_OVERHEAD_BYTES,
        allowed_origins=settings.cors_origins,
        authenticate=has_session,
    )
    app.add_middleware(
        RateLimitMiddleware,
        limiter=app.state.rate_limiter,
        per_minute=settings.rate_limit_per_minute,
        trusted_hops=settings.forwarded_ip_hops,
    )
    if production:
        app.add_middleware(HTTPSOnlyMiddleware, behind_proxy=settings.forwarded_ip_hops > 0)
    app.add_middleware(SecurityHeadersMiddleware, hsts=production)

    # CORS solo decide qué sitios pueden LEER las respuestas en un navegador: no es autenticación.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=False,
        allow_methods=["GET", "POST", "DELETE"],
        allow_headers=["Authorization", "Content-Type"],
        expose_headers=["Content-Disposition", "Retry-After"],
        max_age=600,
    )

    app.include_router(api_router, prefix="/api")
    return app


app = create_app()
