"""Beta pública: acceso por invitación, aislamiento entre visitantes, cuotas, persistencia y endurecimiento.

Todo con proveedores falsos y la red externa bloqueada: ninguna prueba llama a
OpenAI ni a Cloudflare.
"""

import asyncio
import json
import threading
import time

import pytest
from fastapi.testclient import TestClient

from app.cli import main as cli_main
from app.core.config import ConfigurationError, Settings, validate_for_startup
from app.core.security_headers import redact
from app.main import create_app
from app.services.auth import CloudflareTurnstile, hash_secret
from tests.ai_helpers import (  # noqa: F401 - no_network se activa en todo el módulo
    ORIGIN,
    FakeProvider,
    authorize,
    context,
    login,
    make_client,
    max_cost_per_request,
    no_network,
    prepare,
)

PROTECTED = [
    ("get", "/api/ai/status", None),
    ("post", "/api/ai/requests", context()),
    ("post", "/api/ai/requests/abcdefghijklmnop/authorize", {"payload_sha256": "0" * 64, "confirm": True}),
    ("delete", "/api/ai/requests/abcdefghijklmnop", None),
    ("post", "/api/ai/conversations/abcdefghijklmnop/messages", {**context(), "message": "hola"}),
    ("delete", "/api/ai/conversations/abcdefghijklmnop", None),
    ("post", "/api/ai/plans/abcdefghijklmnop/approve", None),
    ("get", "/api/auth/session", None),
    ("post", "/api/auth/logout", None),
]
CSV = b"sector,ventas\nNorte,10\nSur,20\n"


def call(client, method, path, body=None, **kwargs):
    if body is not None:
        kwargs["json"] = body
    return getattr(client, method)(path, **kwargs)


def upload(client, content=CSV, name="datos.csv", **kwargs):
    return client.post("/api/datasets/profile", files={"file": (name, content, "text/csv")}, **kwargs)


def execute(client, plan_ids):
    body = {"plan_ids": plan_ids, "sources": [{"alias": "A", "columns": [{"name": "ANYO", "original": "ANYO", "semantic_type": "temporal"}]}]}
    return client.post("/api/analysis/execute", data={"request": json.dumps(body)},
                       files={"file_A": ("a.csv", b"ANYO\n2020\n2021\n", "text/csv")}, headers=ORIGIN)


def second_visitor(app) -> TestClient:
    other = TestClient(app)
    other.headers.update(login(app, "otro visitante"))
    return other


def production_settings(tmp_path, **overrides) -> Settings:
    values = {
        "environment": "production",
        "turnstile_secret_key": "clave-de-prueba-no-real",
        "turnstile_expected_hostname": "datadecisionai.pages.dev",
        "forwarded_ip_hops": 1,
        "cors_origins": ["https://datadecisionai.pages.dev"],
        "persistent_storage_confirmed": True,
        "database_url": f"sqlite:///{(tmp_path / 'prod.db').as_posix()}",
        **overrides,
    }
    return Settings(_env_file=None, **values)


# Lo que agrega el proxy HTTPS de la plataforma (Render) a cada pedido.
VIA_PROXY = {"X-Forwarded-Proto": "https", "X-Forwarded-For": "203.0.113.7"}


class FakeTurnstile:
    required = True

    def __init__(self, ok=True):
        self.ok = ok
        self.calls = []

    def verify(self, token, remote_ip):
        self.calls.append(token)
        return self.ok and token == "token-valido"


# --- Autenticación ----------------------------------------------------------------

@pytest.mark.parametrize("method, path, body", PROTECTED)
def test_unauthenticated_requests_are_rejected(method, path, body):
    client, _ = make_client(ai_enabled=True, provider=FakeProvider(), authenticated=False)
    response = call(client, method, path, body, headers=ORIGIN)
    assert response.status_code == 401
    assert response.headers["www-authenticate"] == "Bearer"


def test_uploads_and_executions_without_session_are_rejected_before_reading_the_body():
    client, app = make_client(authenticated=False)
    assert upload(client).status_code == 401
    assert execute(client, ["x"]).status_code == 401

    consumed = 0

    async def receive():
        nonlocal consumed
        consumed += 1024
        return {"type": "http.request", "body": b"x" * 1024, "more_body": True}

    sent = []

    async def send(message):
        sent.append(message)

    scope = {"type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1", "method": "POST", "scheme": "http",
             "path": "/api/datasets/profile", "raw_path": b"/api/datasets/profile", "query_string": b"",
             "headers": [(b"content-type", b"multipart/form-data; boundary=x")], "client": ("127.0.0.1", 1), "server": ("t", 80)}
    asyncio.run(app(scope, receive, send))
    assert sent[0]["status"] == 401 and consumed == 0


@pytest.mark.parametrize("header", ["Bearer token-inventado-123", "Basic dXN1YXJpbzpjbGF2ZQ==", "Bearer", "Bearer " + "x" * 300, ""])
def test_invalid_tokens_are_rejected(header):
    client, _ = make_client(authenticated=False)
    assert client.get("/api/ai/status", headers={"Authorization": header}).status_code == 401
    assert upload(client, headers={"Authorization": header}).status_code == 401


def test_expired_session_is_rejected():
    client, app = make_client()
    assert client.get("/api/auth/session").status_code == 200
    now = time.time()
    app.state.auth._clock = lambda: now + 13 * 3600  # la sesión dura 12 h
    assert client.get("/api/auth/session").status_code == 401
    assert upload(client).status_code == 401


def test_expired_or_revoked_invitation_closes_its_sessions():
    client, app = make_client()
    invitation_id = app.state.test_user_id
    assert app.state.auth.revoke_invitation(invitation_id)
    assert client.get("/api/ai/status").status_code == 401

    client, app = make_client()
    now = time.time()
    app.state.auth._clock = lambda: now + 2 * 86400  # la invitación de prueba dura 1 día
    assert client.get("/api/ai/status").status_code == 401


def test_logout_revokes_the_token():
    client, _ = make_client()
    assert client.post("/api/auth/logout", headers=ORIGIN).status_code == 204
    assert client.get("/api/auth/session").status_code == 401


def test_redeem_flow_with_generic_errors_and_no_secrets_stored(tmp_path):
    client, app = make_client(authenticated=False)
    _, code = app.state.auth.create_invitation("Docente", days=7)
    bad = client.post("/api/auth/redeem", json={"code": "ddai-codigo-inventado"}, headers=ORIGIN)
    assert bad.status_code == 401 and "no es válido, venció o fue revocado" in bad.json()["detail"]

    ok = client.post("/api/auth/redeem", json={"code": code}, headers=ORIGIN)
    assert ok.status_code == 200
    token = ok.json()["token"]
    assert ok.json()["label"] == "Docente" and len(token) >= 40
    assert client.get("/api/auth/session", headers={"Authorization": f"Bearer {token}"}).status_code == 200

    # En la base solo hay huellas: ni el código ni el token aparecen en claro.
    db_path = app.state.db.path
    raw = b"".join(p.read_bytes() for p in (db_path, db_path.with_name(db_path.name + "-wal")) if p.exists())
    assert code.encode() not in raw and token.encode() not in raw
    assert hash_secret(code).encode() in raw


def test_redeem_requires_a_valid_body():
    client, _ = make_client(authenticated=False)
    for body in ({"code": "corto"}, {"code": "con espacios y ;"}, {"code": "ddai-valido-123", "extra": 1}):
        assert client.post("/api/auth/redeem", json=body, headers=ORIGIN).status_code == 422


def test_a_code_cannot_open_unlimited_sessions():
    client, app = make_client(authenticated=False, max_sessions_per_invitation=2)
    _, code = app.state.auth.create_invitation("Docente", days=1)
    tokens = [client.post("/api/auth/redeem", json={"code": code}, headers=ORIGIN).json()["token"] for _ in range(3)]
    states = [client.get("/api/auth/session", headers={"Authorization": f"Bearer {t}"}).status_code for t in tokens]
    assert states == [401, 200, 200]  # se cerró la sesión más antigua


def test_turnstile_is_validated_in_the_backend():
    client, app = make_client(authenticated=False)
    app.state.turnstile = FakeTurnstile()
    _, code = app.state.auth.create_invitation("Docente", days=1)
    assert client.get("/api/auth/config").json() == {"turnstile_required": True}
    assert client.post("/api/auth/redeem", json={"code": code}, headers=ORIGIN).status_code == 403
    assert client.post("/api/auth/redeem", json={"code": code, "turnstile_token": "falso"}, headers=ORIGIN).status_code == 403
    ok = client.post("/api/auth/redeem", json={"code": code, "turnstile_token": "token-valido"}, headers=ORIGIN)
    assert ok.status_code == 200


def test_cloudflare_turnstile_verifier_fails_closed():
    sent = []

    def post(url, data, timeout):
        sent.append((url, data))
        return type("R", (), {"json": lambda self: responses.pop(0)})()

    responses = [
        {"success": True, "hostname": "datadecisionai.pages.dev", "action": "redeem"},
        {"success": True, "hostname": "sitio-falso.example", "action": "redeem"},
        {"success": True, "hostname": "datadecisionai.pages.dev", "action": "otra"},
        {"success": True, "hostname": "datadecisionai.pages.dev"},  # sin acción: otro widget
        {"success": False, "error-codes": ["invalid-input-response"]},
    ]
    verifier = CloudflareTurnstile("secreto", expected_hostname="datadecisionai.pages.dev", post=post)
    assert [verifier.verify("t", "1.2.3.4") for _ in range(5)] == [True, False, False, False, False]
    assert sent[0][0].startswith("https://challenges.cloudflare.com/") and sent[0][1]["remoteip"] == "1.2.3.4"
    assert verifier.verify(None, None) is False and verifier.verify("x" * 3000, None) is False

    def broken(url, data, timeout):
        raise OSError("sin red")

    assert CloudflareTurnstile("secreto", post=broken).verify("t", None) is False


def test_redeem_attempts_are_limited_per_ip():
    client, _ = make_client(authenticated=False, redeem_attempts_per_15_minutes=3)
    codes = [client.post("/api/auth/redeem", json={"code": f"ddai-intento-{i:04d}"}, headers=ORIGIN).status_code for i in range(5)]
    assert codes == [401, 401, 401, 429, 429]


def test_general_rate_limit_per_ip():
    client, _ = make_client(rate_limit_per_minute=10)
    codes = [client.get("/api/auth/session").status_code for _ in range(12)]
    assert codes[:10] == [200] * 10 and codes[10:] == [429, 429]


def test_a_forged_forwarded_for_header_does_not_bypass_the_ip_limit():
    """Detrás de un proxy, el visitante controla el inicio de X-Forwarded-For, no el final."""
    client, _ = make_client(rate_limit_per_minute=10, forwarded_ip_hops=1)
    # El visitante inventa una IP distinta cada vez; el proxy agrega la real (198.51.100.9) a la derecha.
    codes = [
        client.get("/api/auth/session", headers={"X-Forwarded-For": f"10.0.0.{i}, 198.51.100.9"}).status_code
        for i in range(12)
    ]
    assert codes[10:] == [429, 429]
    # Otro visitante real (otra IP agregada por el proxy) no queda bloqueado.
    assert client.get("/api/auth/session", headers={"X-Forwarded-For": "198.51.100.10"}).status_code == 200


# --- Aislamiento entre visitantes ---------------------------------------------------

def test_visitors_cannot_use_each_others_authorizations_conversations_or_plans():
    provider = FakeProvider()
    alice, app = make_client(ai_enabled=True, provider=provider)
    bob = second_visitor(app)

    # Bob conoce el identificador y la huella de una solicitud de Alice: no le sirve.
    prepared = prepare(alice, context()).json()
    assert authorize(bob, prepared).status_code == 404
    assert bob.delete(f"/api/ai/requests/{prepared['request_id']}", headers=ORIGIN).status_code == 204  # no revela nada
    assert provider.received == []

    # La solicitud de Alice sigue vigente (Bob no pudo cancelarla).
    response = alice.post(f"/api/ai/requests/{prepared['request_id']}/authorize",
                          json={"payload_sha256": prepared["payload_sha256"], "confirm": True, "scope": "conversation"},
                          headers=ORIGIN)
    assert response.status_code == 200
    conversation = response.json()["conversation"]["conversation_id"]
    plan_id = response.json()["plan_ids"][0]

    # Conversación autorizada por Alice: Bob no puede usarla ni revocarla.
    message = {**context(), "message": "hola"}
    assert bob.post(f"/api/ai/conversations/{conversation}/messages", json=message, headers=ORIGIN).status_code == 404
    assert bob.delete(f"/api/ai/conversations/{conversation}", headers=ORIGIN).status_code == 204
    assert alice.post(f"/api/ai/conversations/{conversation}/messages", json=message, headers=ORIGIN).status_code == 200

    # Plan de Alice: Bob no puede aprobarlo ni ejecutarlo.
    assert bob.post(f"/api/ai/plans/{plan_id}/approve", headers=ORIGIN).status_code == 404
    assert alice.post(f"/api/ai/plans/{plan_id}/approve", headers=ORIGIN).status_code == 200
    assert execute(bob, [plan_id]).status_code == 404
    assert execute(alice, [plan_id]).status_code == 200
    assert len(provider.received) == 2  # solo los envíos de Alice


def test_pending_requests_are_limited_per_visitor():
    alice, app = make_client(ai_enabled=True, provider=FakeProvider())
    bob = second_visitor(app)
    codes = [prepare(alice, context()).status_code for _ in range(7)]
    assert codes == [201] * 5 + [429, 429]
    assert prepare(bob, context()).status_code == 201  # Alice no llena el cupo de los demás


# --- Cuotas y presupuesto ----------------------------------------------------------------

def test_daily_quota_is_per_visitor():
    alice, app = make_client(ai_enabled=True, provider=FakeProvider(), max_requests=2)
    bob = second_visitor(app)
    for _ in range(2):
        assert authorize(alice, prepare(alice, context()).json()).status_code == 200
    blocked = authorize(alice, prepare(alice, context()).json())
    assert blocked.status_code == 429 and "por día" in blocked.json()["detail"]
    assert authorize(bob, prepare(bob, context()).json()).status_code == 200
    assert alice.get("/api/ai/status").json()["requests_used"] == 2
    assert bob.get("/api/ai/status").json()["requests_used"] == 1


def test_user_budget_and_global_budget_are_enforced():
    # Cada envío reserva el máximo estimado y cuesta USD 0,00032: la cuota de cada visitante
    # alcanza para uno; el global, para dos (el tercero ya no entra).
    maximum = max_cost_per_request()
    total = round(maximum + 0.0005, 6)
    alice, app = make_client(ai_enabled=True, provider=FakeProvider(), budget_usd=total, user_budget_usd=round(maximum * 1.1, 6))
    bob = second_visitor(app)
    carol = second_visitor(app)
    assert authorize(alice, prepare(alice, context()).json()).status_code == 200
    second = authorize(alice, prepare(alice, context()).json())
    assert second.status_code == 402 and "tu cuota" in second.json()["detail"]
    assert authorize(bob, prepare(bob, context()).json()).status_code == 200
    final = authorize(carol, prepare(carol, context()).json())
    assert final.status_code == 402 and "global" in final.json()["detail"]
    assert app.state.ai_budget.global_spent_usd() <= total


def test_global_daily_request_limit():
    alice, app = make_client(ai_enabled=True, provider=FakeProvider(), ai_global_daily_requests=1)
    bob = second_visitor(app)
    assert authorize(alice, prepare(alice, context()).json()).status_code == 200
    response = authorize(bob, prepare(bob, context()).json())
    assert response.status_code == 429 and "del servicio" in response.json()["detail"]


def test_one_ai_request_in_flight_per_visitor():
    class SlowProvider(FakeProvider):
        def send(self, ctx, settings):
            time.sleep(0.3)
            return super().send(ctx, settings)

    alice, app = make_client(ai_enabled=True, provider=SlowProvider())
    prepared = [prepare(alice, context()).json() for _ in range(2)]
    results = []
    threads = [threading.Thread(target=lambda p=p: results.append(authorize(alice, p).status_code)) for p in prepared]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=10)
    assert sorted(results) == [200, 409]


# --- Persistencia --------------------------------------------------------------------------

def test_sessions_invitations_and_spending_survive_a_restart(tmp_path):
    settings = Settings(_env_file=None, environment="test", ai_enabled=True, openai_api_key="sk-prueba-falsa",
                        database_url=f"sqlite:///{(tmp_path / 'datos.db').as_posix()}")
    first = create_app(settings)
    first.state.ai_provider = FakeProvider()
    client = TestClient(first)
    _, code = first.state.auth.create_invitation("Docente", days=1)
    token = client.post("/api/auth/redeem", json={"code": code}, headers=ORIGIN).json()["token"]
    client.headers["Authorization"] = f"Bearer {token}"
    assert authorize(client, prepare(client, context()).json()).status_code == 200
    spent = client.get("/api/ai/status").json()["spent_usd"]
    assert spent > 0
    first.state.db.close()

    # «Reinicio»: una aplicación nueva sobre el mismo archivo.
    second = create_app(settings)
    again = TestClient(second, headers={"Authorization": f"Bearer {token}"})
    status = again.get("/api/ai/status").json()
    assert status["spent_usd"] == spent and status["requests_used"] == 1
    assert second.state.ai_budget.global_spent_usd() == pytest.approx(spent)
    assert again.post("/api/auth/redeem", json={"code": code}, headers=ORIGIN).status_code == 200


# --- Archivos y concurrencia --------------------------------------------------------------

def test_upload_limits_are_configurable():
    client, _ = make_client(max_upload_mb=1, max_dataset_cells=1000)
    big = b"a\n" + b"1\n" * (600 * 1024)  # ≈ 1,2 MB
    assert upload(client, big).status_code == 413
    many = b"a,b\n" + b"1,2\n" * 600  # 1.200 celdas
    response = upload(client, many)
    assert response.status_code == 422 and "1.000 celdas" in response.json()["detail"]
    assert upload(client).status_code == 200


def test_profiling_concurrency_is_limited_per_visitor():
    alice, app = make_client()
    bob = second_visitor(app)
    gate = app.state.profile_gate
    with gate.slot(app.state.test_user_id):  # Alice ya tiene un perfilado en curso
        assert upload(alice).status_code == 429
        assert upload(bob).status_code == 200
    assert upload(alice).status_code == 200 and gate.active == 0


# --- Configuración de producción y encabezados ----------------------------------------------

@pytest.mark.parametrize("overrides, fragment", [
    ({"turnstile_secret_key": None}, "TURNSTILE_SECRET_KEY"),
    ({"cors_origins": ["http://localhost:5173"]}, "https://"),
    ({"persistent_storage_confirmed": False}, "PERSISTENT_STORAGE_CONFIRMED"),
    ({"database_url": "sqlite:///./data/datadecision.db"}, "ruta absoluta"),
    ({"turnstile_expected_hostname": None}, "TURNSTILE_EXPECTED_HOSTNAME"),
    ({"forwarded_ip_hops": 0}, "FORWARDED_IP_HOPS"),
])
def test_insecure_production_configuration_does_not_start(tmp_path, overrides, fragment):
    with pytest.raises(ConfigurationError, match=fragment):
        create_app(production_settings(tmp_path, **overrides))


def test_production_does_not_create_a_missing_database_folder(tmp_path):
    """Si la carpeta no existe, el disco persistente no está montado: no arranca ni la crea."""
    missing = tmp_path / "disco-no-montado"
    with pytest.raises(ConfigurationError, match="disco"):
        create_app(production_settings(tmp_path, database_url=f"sqlite:///{(missing / 'x.db').as_posix()}"))
    assert not missing.exists()


def test_production_requires_https(tmp_path):
    client = TestClient(create_app(production_settings(tmp_path)))
    plain = {"X-Forwarded-Proto": "http", "X-Forwarded-For": "203.0.113.7"}
    assert client.get("/api/auth/config", headers=plain).status_code == 403
    assert client.get("/api/auth/config", headers={"X-Forwarded-For": "203.0.113.7"}).status_code == 403
    assert client.post("/api/auth/redeem", json={"code": "ddai-intento-0001"}, headers=plain).status_code == 403
    assert client.get("/api/health").status_code == 200  # control de salud interno de la plataforma
    assert client.get("/api/auth/config", headers=VIA_PROXY).status_code == 200


def test_render_without_production_environment_does_not_start(monkeypatch):
    monkeypatch.setenv("RENDER", "true")
    with pytest.raises(ConfigurationError, match="production"):
        validate_for_startup(Settings(_env_file=None, environment="development"))


def test_unknown_environment_is_a_configuration_error():
    with pytest.raises(ValueError):
        Settings(_env_file=None, environment="produccion")


def test_production_hides_docs_and_sends_security_headers(tmp_path):
    app = create_app(production_settings(tmp_path))
    client = TestClient(app, headers=VIA_PROXY)
    assert client.get("/docs").status_code == 404
    assert client.get("/openapi.json").status_code == 404
    assert client.get("/redoc").status_code == 404
    response = client.get("/api/health")
    assert response.headers["strict-transport-security"].startswith("max-age=")
    assert client.get("/api/auth/config").json() == {"turnstile_required": True}
    assert isinstance(app.state.turnstile, CloudflareTurnstile)
    # Un origen que no es el del frontend no recibe permiso CORS.
    preflight = client.options("/api/health", headers={"Origin": "https://sitio-externo.example", "Access-Control-Request-Method": "GET"})
    assert "access-control-allow-origin" not in preflight.headers


def test_security_headers_in_every_response():
    client, _ = make_client()
    for response in (client.get("/api/health"), client.get("/api/ai/status"), client.get("/api/noexiste")):
        assert response.headers["x-content-type-options"] == "nosniff"
        assert response.headers["x-frame-options"] == "DENY"
        assert response.headers["referrer-policy"] == "no-referrer"
        assert "default-src 'none'" in response.headers["content-security-policy"]
        assert response.headers["cache-control"] == "no-store"
    assert "strict-transport-security" not in client.get("/api/health").headers  # solo en producción (HTTPS)


def test_identifiers_and_queries_are_redacted_from_access_logs():
    line = '1.2.3.4:5 - "POST /api/ai/conversations/Zx9-AbCdEfGhIjKl_mn/messages HTTP/1.1" 200'
    assert "Zx9-AbCdEfGhIjKl_mn" not in redact(line)
    assert redact("/api/ai/plans/aaaaaaaaaaaaaaaa/approve") == "/api/ai/plans/…/approve"
    assert redact("/api/datasets/profile?token=secreto") == "/api/datasets/profile?…"
    assert redact("/api/ai/status") == "/api/ai/status"


# --- Administración por consola -------------------------------------------------------------

def test_cli_creates_lists_and_revokes_invitations(capsys):
    assert cli_main(["invite", "--label", "Docente CLI", "--days", "3"]) == 0
    out = capsys.readouterr().out
    code = out.strip().split()[-1]
    invitation_id = out.split()[1]
    assert code.startswith("ddai-")
    assert cli_main(["list"]) == 0
    listing = capsys.readouterr().out
    assert "Docente CLI" in listing and code not in listing
    assert cli_main(["revoke", invitation_id]) == 0
    assert "Revocada." in capsys.readouterr().out


def test_previous_json_ledger_is_imported_once_and_an_unreadable_one_blocks_startup(tmp_path):
    legacy = tmp_path / "ai_usage.json"
    legacy.write_text(json.dumps([
        {"at": "2026-10-25T20:00:00+00:00", "model": "gpt-6-luna", "input_tokens": 1000, "output_tokens": 300,
         "cost_usd": 0.25, "estimated": False},
    ]), encoding="utf-8")
    settings = Settings(_env_file=None, environment="test", ai_legacy_usage_file=legacy.as_posix(),
                        database_url=f"sqlite:///{(tmp_path / 'datos.db').as_posix()}")
    app = create_app(settings)
    assert app.state.ai_budget.global_spent_usd() == pytest.approx(0.25)
    app.state.db.close()
    again = create_app(settings)  # un reinicio no lo importa dos veces
    assert again.state.ai_budget.global_spent_usd() == pytest.approx(0.25)

    legacy.write_text("{roto", encoding="utf-8")
    broken = settings.model_copy(update={"database_url": f"sqlite:///{(tmp_path / 'otra.db').as_posix()}"})
    with pytest.raises(ConfigurationError, match="registro de consumo anterior"):
        create_app(broken)
