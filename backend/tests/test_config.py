import pytest

from app.core.config import Settings


def test_cors_origins_acepta_lista_separada_por_comas(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CORS_ORIGINS", "http://localhost:5173, http://127.0.0.1:5173")
    settings = Settings(_env_file=None)
    assert settings.cors_origins == ["http://localhost:5173", "http://127.0.0.1:5173"]


def test_openai_api_key_no_tiene_valor_por_defecto(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    assert Settings(_env_file=None).openai_api_key is None
