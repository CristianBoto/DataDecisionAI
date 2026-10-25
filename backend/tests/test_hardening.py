"""Endurecimiento mínimo de la carga (auditoría: B4 tamaño, B5 memoria, B6 origen).

Datos sintéticos. Las pruebas de middleware llaman a la aplicación ASGI
directamente para controlar encabezados y fragmentos del cuerpo.
"""

import asyncio
import time
from io import BytesIO
from zipfile import ZIP_DEFLATED, ZipFile

import pandas as pd
import pytest
import starlette.formparsers as formparsers
from fastapi.testclient import TestClient

import app.api.routes.datasets as datasets_route
import app.services.dataset_profiler as profiler
from app.core.config import get_settings
from app.main import MULTIPART_OVERHEAD_BYTES, create_app
from app.services.dataset_profiler import MAX_FILE_BYTES, DatasetProfileError, profile_dataset

LIMIT = MAX_FILE_BYTES + MULTIPART_OVERHEAD_BYTES
ALLOWED = "http://localhost:5173"
PATH = "/api/datasets/profile"


@pytest.fixture
def client() -> TestClient:
    return TestClient(create_app())


def post(client: TestClient, content: bytes, name: str = "datos.csv", origin: str | None = ALLOWED):
    headers = {"Origin": origin} if origin is not None else {}
    return client.post(PATH, files={"file": (name, content, "text/csv")}, headers=headers)


def multipart(content: bytes, name: str = "datos.csv") -> tuple[bytes, bytes]:
    boundary = b"limite123"
    body = (
        b"--" + boundary + b"\r\n"
        b'Content-Disposition: form-data; name="file"; filename="' + name.encode() + b'"\r\n'
        b"Content-Type: text/csv\r\n\r\n" + content + b"\r\n--" + boundary + b"--\r\n"
    )
    return body, b"multipart/form-data; boundary=" + boundary


async def call_asgi(app, body_chunks, headers: list[tuple[bytes, bytes]]):
    """Envía el cuerpo en fragmentos y devuelve (estado, cuerpo, bytes leídos por la app)."""
    chunks = iter(body_chunks)
    consumed = 0
    sent: list[dict] = []

    async def receive():
        nonlocal consumed
        try:
            chunk = next(chunks)
        except StopIteration:
            return {"type": "http.request", "body": b"", "more_body": False}
        consumed += len(chunk)
        return {"type": "http.request", "body": chunk, "more_body": True}

    async def send(message):
        sent.append(message)

    scope = {
        "type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1", "method": "POST",
        "scheme": "http", "path": PATH, "raw_path": PATH.encode(), "query_string": b"",
        "headers": headers, "client": ("127.0.0.1", 1234), "server": ("127.0.0.1", 8000),
    }
    await app(scope, receive, send)
    status = next(m["status"] for m in sent if m["type"] == "http.response.start")
    body = b"".join(m.get("body", b"") for m in sent if m["type"] == "http.response.body")
    return status, body, consumed


# --- B6 · Origen -------------------------------------------------------------

def test_valid_upload_from_allowed_origin_keeps_cors_header(client):
    response = post(client, b"a,b\n1,2\n")
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == ALLOWED


def test_local_tools_without_origin_still_work(client):
    assert post(client, b"a,b\n1,2\n", origin=None).status_code == 200


@pytest.mark.parametrize("origin", ["https://sitio-externo.example", "null", "http://localhost:9999"])
def test_unauthorized_origin_is_rejected_before_processing(client, monkeypatch, origin):
    called = []
    monkeypatch.setattr(datasets_route, "profile_dataset", lambda *a: called.append(a))
    response = post(client, b"a,b\n1,2\n", origin=origin)
    assert response.status_code == 403
    assert response.json()["detail"] == "Origen no autorizado para cargar archivos."
    assert called == []


def test_port_5174_is_authorized_by_default():
    assert "http://localhost:5174" in get_settings().cors_origins


def test_origin_control_only_applies_to_uploads(client):
    response = client.get("/api/health", headers={"Origin": "https://sitio-externo.example"})
    assert response.status_code == 200


def test_unauthorized_origin_is_rejected_without_reading_the_body():
    app = create_app()
    body, ctype = multipart(b"a,b\n1,2\n")
    status, _, consumed = asyncio.run(
        call_asgi(app, [body], [(b"origin", b"null"), (b"content-type", ctype)])
    )
    assert status == 403
    assert consumed == 0


# --- B4 · Tamaño ---------------------------------------------------------------

def test_declared_oversize_is_rejected_without_reading_the_body():
    app = create_app()
    status, body, consumed = asyncio.run(
        call_asgi(app, [b"x" * 1024], [(b"content-length", str(LIMIT + 1).encode()), (b"content-type", b"multipart/form-data; boundary=x")])
    )
    assert status == 413
    assert b"supera el tama" in body
    assert consumed == 0


def test_invalid_content_length_is_rejected():
    app = create_app()
    status, _, consumed = asyncio.run(call_asgi(app, [b"x"], [(b"content-length", b"abc")]))
    assert status == 400
    assert consumed == 0


@pytest.mark.parametrize("declared", [None, b"1000"])
def test_real_bytes_are_limited_when_content_length_is_missing_or_false(monkeypatch, declared):
    temp_files = []
    original = formparsers.SpooledTemporaryFile

    class Observed(original):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, **kwargs)
            temp_files.append(self)

    monkeypatch.setattr(formparsers, "SpooledTemporaryFile", Observed)
    body, ctype = multipart(b"a\n" + b"1\n" * (16 * 1024 * 1024))  # ≈ 32 MB
    chunk = 1024 * 1024
    chunks = [body[i : i + chunk] for i in range(0, len(body), chunk)]
    headers = [(b"content-type", ctype), (b"origin", ALLOWED.encode())]
    if declared is not None:
        headers.append((b"content-length", declared))

    status, response_body, consumed = asyncio.run(call_asgi(create_app(), chunks, headers))
    assert status == 413
    assert "La solicitud supera" in response_body.decode()
    assert consumed <= LIMIT + chunk  # se dejó de leer apenas se superó el límite
    assert all(f.closed for f in temp_files)  # el temporal parcial se cerró (y se borró)


def test_valid_file_close_to_25_mb_is_accepted(client):
    row = ("x" * 180 + "," + "y" * 18 + "\n").encode()
    content = b"texto,codigo\n" + row * ((MAX_FILE_BYTES - 1024 * 1024) // len(row))
    assert 23 * 1024 * 1024 < len(content) < MAX_FILE_BYTES
    response = post(client, content)
    assert response.status_code == 200
    assert response.json()["column_count"] == 2


# --- B5 · Memoria ------------------------------------------------------------

def test_csv_with_too_many_cells_is_rejected_before_pandas(monkeypatch):
    def forbidden(*args, **kwargs):
        raise AssertionError("pd.read_csv no debería ejecutarse")

    monkeypatch.setattr(profiler.pd, "read_csv", forbidden)
    cols, rows = 200, 62_000  # ≈ 25 MB y 12,4 millones de celdas (el caso de la auditoría)
    content = (",".join(f"c{i}" for i in range(cols)) + "\n").encode() + ((",".join(["1"] * cols)) + "\n").encode() * rows
    started = time.perf_counter()
    with pytest.raises(DatasetProfileError, match="celdas"):
        profile_dataset(content, "adversario.csv")
    assert time.perf_counter() - started < 10


def test_csv_column_and_row_limits(monkeypatch):
    with pytest.raises(DatasetProfileError, match="250 columnas"):
        profile_dataset((",".join(f"c{i}" for i in range(300)) + "\n1\n").encode(), "ancho.csv")
    monkeypatch.setattr(profiler, "MAX_ROWS", 10)
    with pytest.raises(DatasetProfileError, match="límites del MVP"):
        profile_dataset(b"a\n" + b"1\n" * 11, "largo.csv")


def test_quoted_line_breaks_do_not_cause_false_rejections(monkeypatch):
    # 5 filas reales con saltos de línea dentro de comillas: más líneas que filas.
    monkeypatch.setattr(profiler, "MAX_CELLS", 12)
    content = b'id,nota\n' + b'1,"linea 1\nlinea 2\nlinea 3"\n' * 5
    report = profile_dataset(content, "comillas.csv")
    assert report["row_count"] == 5


def test_xlsx_shape_is_checked_while_streaming(monkeypatch):
    monkeypatch.setattr(profiler, "MAX_CELLS", 50)
    file = BytesIO()
    pd.DataFrame({"a": range(40), "b": range(40)}).to_excel(file, index=False)
    with pytest.raises(DatasetProfileError, match="límites del MVP"):
        profile_dataset(file.getvalue(), "grande.xlsx")


def test_xlsx_real_decompressed_size_is_limited(monkeypatch):
    monkeypatch.setattr(profiler, "MAX_XLSX_UNCOMPRESSED_BYTES", 1024 * 1024)
    file = BytesIO()
    with ZipFile(file, "w", ZIP_DEFLATED) as zf:
        zf.writestr("xl/bomba.xml", b"0" * (5 * 1024 * 1024))  # 5 MB que comprimen a pocos KB
    assert len(file.getvalue()) < 64 * 1024
    with pytest.raises(DatasetProfileError, match="descomprimido"):
        profile_dataset(file.getvalue(), "bomba.xlsx")


def test_xlsx_with_too_many_entries_is_rejected():
    file = BytesIO()
    with ZipFile(file, "w") as zf:
        for i in range(profiler.MAX_XLSX_ENTRIES + 1):
            zf.writestr(f"x/{i}.xml", b"")
    with pytest.raises(DatasetProfileError, match="demasiados"):
        profile_dataset(file.getvalue(), "muchos.xlsx")


@pytest.mark.parametrize("name,content", [
    ("cortado.xlsx", None),
    ("binario.csv", bytes(range(1, 256)) * 50),
], ids=["xlsx-cortado", "csv-binario"])
def test_malformed_files_return_controlled_errors(client, name, content):
    if content is None:
        file = BytesIO()
        pd.DataFrame({"a": [1, 2]}).to_excel(file, index=False)
        content = file.getvalue()[: len(file.getvalue()) // 2]
    response = post(client, content, name=name)
    assert response.status_code == 422
    assert "Traceback" not in response.text


def test_profiling_runs_outside_the_event_loop(client, monkeypatch):
    seen = []

    def fake_profile(content, filename):
        try:
            asyncio.get_running_loop()
            seen.append("en el bucle de eventos")
        except RuntimeError:
            seen.append("en un hilo")
        return {"ok": True}

    monkeypatch.setattr(datasets_route, "profile_dataset", fake_profile)
    assert post(client, b"a\n1\n").status_code == 200
    assert seen == ["en un hilo"]


def test_concurrent_profiles_are_limited_and_counter_is_released(client, monkeypatch):
    monkeypatch.setattr(datasets_route, "_active_profiles", datasets_route.MAX_CONCURRENT_PROFILES)
    busy = post(client, b"a\n1\n")
    assert busy.status_code == 429
    monkeypatch.setattr(datasets_route, "_active_profiles", 0)
    assert post(client, b"a\n1\n").status_code == 200
    assert post(client, b"", name="vacio.csv").status_code == 422
    assert datasets_route._active_profiles == 0
