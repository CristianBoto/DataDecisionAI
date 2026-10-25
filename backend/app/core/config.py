"""Configuración de la aplicación leída desde variables de entorno o el archivo .env."""

from functools import lru_cache
from typing import Annotated

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
