"""Configuración segura para TODAS las pruebas, fijada antes de importar la aplicación.

- No se lee `backend/.env`: ni la clave real de OpenAI ni la base real.
- IA deshabilitada, clave vacía y base SQLite temporal.
- Entorno `test` (Turnstile no exigido; la autenticación sigue siendo obligatoria).
"""

import os
import tempfile
from pathlib import Path

from app.core.config import Settings

_TMP = Path(tempfile.mkdtemp(prefix="ddai-pruebas-"))
os.environ.update(
    {
        "ENVIRONMENT": "test",
        "AI_ENABLED": "false",
        "OPENAI_API_KEY": "",
        "TURNSTILE_SECRET_KEY": "",
        "DATABASE_URL": f"sqlite:///{(_TMP / 'pruebas.db').as_posix()}",
        "AI_LEGACY_USAGE_FILE": (_TMP / "sin-registro-anterior.json").as_posix(),
    }
)
os.environ.pop("RENDER", None)
Settings.model_config["env_file"] = None
