"""Configuración de la aplicación leída desde variables de entorno o el archivo .env."""

import os
from functools import lru_cache
from pathlib import Path
from typing import Annotated, Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class ConfigurationError(RuntimeError):
    """Configuración insegura o incompleta: la aplicación no debe arrancar."""


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "DataDecision AI API"
    app_version: str = "0.1.0"
    # Un valor desconocido es un error de configuración (no se asume desarrollo).
    environment: Literal["development", "test", "production"] = "development"

    # Orígenes del frontend autorizados (CORS y control de Origin). CORS NO es autenticación.
    # Lista separada por comas en el .env, por ejemplo:
    # CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
    # 5174 se incluye porque Vite lo usa cuando 5173 está ocupado.
    cors_origins: Annotated[list[str], NoDecode] = Field(
        default_factory=lambda: [
            "http://localhost:5173",
            "http://127.0.0.1:5173",
            "http://localhost:5174",
            "http://127.0.0.1:5174",
        ]
    )

    # Persistencia mínima (SQLite): invitaciones, sesiones y consumo de la IA.
    # Nunca se guardan los datasets. En producción debe estar en un disco PERSISTENTE.
    database_url: str = "sqlite:///./data/datadecision.db"
    # El operador confirma que DATABASE_URL apunta a un volumen que sobrevive a
    # reinicios y redespliegues (sin esto, la producción no arranca).
    persistent_storage_confirmed: bool = False
    upload_dir: str = "./data/uploads"
    # Límites de archivo (más bajos en la beta pública; nunca superan 25 MB ni 5 M de celdas).
    max_upload_mb: int = Field(default=25, ge=1, le=25)
    max_dataset_cells: int = Field(default=5_000_000, ge=1000, le=5_000_000)

    # Acceso por invitación: duración de la sesión y sesiones simultáneas por invitación.
    session_ttl_hours: int = Field(default=12, ge=1, le=72)
    max_sessions_per_invitation: int = Field(default=3, ge=1, le=10)
    # Cloudflare Turnstile: obligatorio en producción, validado en el backend al canjear.
    turnstile_secret_key: str | None = None
    turnstile_expected_hostname: str | None = None
    # Proxies de confianza delante del backend que agregan X-Forwarded-For (Render: 1).
    # Define de dónde sale la IP del visitante y el esquema (HTTPS) original.
    forwarded_ip_hops: int = Field(default=0, ge=0, le=3)
    # Límites de frecuencia por IP (una sola instancia: en memoria del proceso).
    rate_limit_per_minute: int = Field(default=120, ge=10, le=2000)
    redeem_attempts_per_15_minutes: int = Field(default=10, ge=1, le=100)

    # La clave de OpenAI vive SOLO en el backend. Nunca se envía al frontend.
    openai_api_key: str | None = None
    # Envío a la IA externa: deshabilitado por defecto. Aun habilitado, cada
    # envío requiere revisión y autorización explícita (Fase 3B.1).
    ai_enabled: bool = False

    # Fase 3B.2: proveedor OpenAI y control del consumo (aplicados en el backend).
    openai_model: str = "gpt-6-luna"
    # Esfuerzo de razonamiento: los tokens de razonamiento se cobran como salida.
    openai_reasoning_effort: Literal["none", "low", "medium", "high"] = "low"
    # Precio por millón de tokens; solo hace falta si el modelo no está en la tabla interna.
    openai_price_input_per_1m: float | None = Field(default=None, ge=0)
    openai_price_output_per_1m: float | None = Field(default=None, ge=0)
    ai_timeout_seconds: float = Field(default=40, gt=0, le=120)
    ai_max_output_tokens: int = Field(default=2500, ge=256, le=16000)
    ai_max_input_tokens: int = Field(default=8000, ge=500, le=50000)
    # Presupuesto GLOBAL acumulado (USD) de toda la instalación, en la base SQLite.
    ai_budget_usd: float = Field(default=1.0, ge=0, le=20)
    # Cuotas por visitante (invitación): presupuesto acumulado y solicitudes por día.
    ai_user_budget_usd: float = Field(default=0.10, ge=0, le=20)
    ai_user_daily_requests: int = Field(default=15, ge=1, le=500)
    # Tope diario de solicitudes de toda la instalación (protege ante muchas invitaciones).
    ai_global_daily_requests: int = Field(default=150, ge=1, le=5000)
    # Registro JSON de la versión anterior: se importa una vez a SQLite (no se pierde el gasto).
    ai_legacy_usage_file: str = "./data/ai_usage.json"
    # Autorización por conversación: vence y admite un máximo de mensajes (nunca es permanente).
    ai_conversation_ttl_minutes: int = Field(default=30, ge=1, le=240)
    ai_conversation_max_messages: int = Field(default=20, ge=1, le=100)

    @field_validator("cors_origins", mode="before")
    @classmethod
    def split_origins(cls, value: object) -> object:
        if isinstance(value, str):
            return [origin.strip() for origin in value.split(",") if origin.strip()]
        return value

    @property
    def is_production(self) -> bool:
        return self.environment == "production"

    @property
    def database_path(self) -> Path:
        prefix = "sqlite:///"
        if not self.database_url.startswith(prefix):
            raise ConfigurationError("DATABASE_URL debe tener la forma sqlite:///ruta/al/archivo.db.")
        return Path(self.database_url[len(prefix):])

    @property
    def max_upload_bytes(self) -> int:
        return self.max_upload_mb * 1024 * 1024


def validate_for_startup(settings: Settings) -> None:
    """Falla al arrancar ante una configuración insegura (en lugar de funcionar desprotegida).

    No hay forma de desactivar la autenticación: solo cambia lo que se exige
    alrededor (Turnstile, HTTPS, persistencia) según el entorno.
    """
    _ = settings.database_path  # formato válido en todos los entornos
    # Render define RENDER=true: allí solo se admite la configuración de producción.
    if os.environ.get("RENDER") and not settings.is_production:
        raise ConfigurationError("En Render, ENVIRONMENT debe ser 'production'.")
    if not settings.is_production:
        return
    problems = []
    if not settings.turnstile_secret_key:
        problems.append("falta TURNSTILE_SECRET_KEY (Turnstile es obligatorio en producción)")
    if not settings.turnstile_expected_hostname:
        problems.append("falta TURNSTILE_EXPECTED_HOSTNAME (dominio del frontend que debe resolver el desafío)")
    if settings.forwarded_ip_hops < 1:
        problems.append(
            "FORWARDED_IP_HOPS debe ser 1 o más: el backend se publica detrás del proxy HTTPS de la plataforma "
            "(sin esto, el límite por IP y el control de HTTPS no ven al visitante real)"
        )
    if not settings.cors_origins or any(not o.startswith("https://") for o in settings.cors_origins):
        problems.append("CORS_ORIGINS debe listar solo orígenes https:// del frontend")
    if not settings.persistent_storage_confirmed:
        problems.append(
            "PERSISTENT_STORAGE_CONFIRMED=true es obligatorio: DATABASE_URL debe estar en un disco persistente "
            "(si el disco es efímero, un redespliegue borraría el presupuesto consumido)"
        )
    if not settings.database_path.is_absolute():
        problems.append("DATABASE_URL debe usar una ruta absoluta en el disco persistente")
    elif not settings.database_path.parent.is_dir():
        # La aplicación no crea esta carpeta en producción: si falta, el disco no está montado.
        problems.append(f"la carpeta de DATABASE_URL ({settings.database_path.parent}) no existe: ¿está montado el disco?")
    if problems:
        raise ConfigurationError("Configuración de producción insegura: " + "; ".join(problems) + ".")


@lru_cache
def get_settings() -> Settings:
    """Devuelve una única instancia de configuración (cacheada)."""
    return Settings()
