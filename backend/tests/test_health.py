from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health_devuelve_ok() -> None:
    response = client.get("/api/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["version"] == "0.1.0"


def test_cors_permite_el_frontend_de_desarrollo() -> None:
    response = client.options(
        "/api/health",
        headers={"Origin": "http://localhost:5173", "Access-Control-Request-Method": "GET"},
    )
    assert response.headers.get("access-control-allow-origin") == "http://localhost:5173"
