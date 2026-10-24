"""Esquema de respuesta de /api/health (coincide con HealthStatus del frontend)."""

from typing import Literal

from pydantic import BaseModel


class HealthResponse(BaseModel):
    status: Literal["ok", "error"]
    service: str
    version: str
    environment: str
