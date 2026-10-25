"""Configuración de la aplicación leída desde variables de entorno o el archivo .env."""

from functools import lru_cache
from typing import Annotated, Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "DataDecision AI API"
    app_version: str = "0.1.0"
    environment: str = "development"

    # Orígenes del frontend local autorizados (CORS y carga de archivos).
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

    # Configuración futura (todavía no se usa).
    database_url: str = "sqlite:///./data/datadecision.db"
    upload_dir: str = "./data/uploads"
    max_upload_mb: int = 25
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
    ai_max_requests_per_session: int = Field(default=25, ge=1, le=500)
    # Presupuesto local acumulado (USD). Se guarda en un archivo local sin contenido.
    ai_budget_usd: float = Field(default=1.0, ge=0, le=20)
    ai_usage_file: str = "./data/ai_usage.json"
    # Autorización por conversación: vence y admite un máximo de mensajes (nunca es permanente).
    ai_conversation_ttl_minutes: int = Field(default=30, ge=1, le=240)
    ai_conversation_max_messages: int = Field(default=20, ge=1, le=100)

    @field_validator("cors_origins", mode="before")
    @classmethod
    def split_origins(cls, value: object) -> object:
        if isinstance(value, str):
            return [origin.strip() for origin in value.split(",") if origin.strip()]
        return value


@lru_cache
def get_settings() -> Settings:
    """Devuelve una única instancia de configuración (cacheada)."""
    return Settings()
