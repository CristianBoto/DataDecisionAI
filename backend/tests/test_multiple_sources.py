"""Varias fuentes por análisis (Fase 3A): el mismo endpoint perfila cada archivo por separado.

No hay un endpoint nuevo: el frontend envía los archivos de a uno. Estas pruebas
verifican que los perfiles sean independientes y que un archivo con error no
afecte a los demás.
"""

from io import BytesIO

import pandas as pd
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.routes.datasets import router


def client() -> TestClient:
    api = FastAPI()
    api.include_router(router, prefix="/api")
    return TestClient(api)


def post(api: TestClient, name: str, content: bytes, media: str = "text/csv"):
    return api.post("/api/datasets/profile", files={"file": (name, content, media)})


def xlsx_bytes(frame: pd.DataFrame) -> bytes:
    file = BytesIO()
    frame.to_excel(file, index=False)
    return file.getvalue()


def test_three_sources_with_different_structures_are_profiled_independently():
    api = client()
    ventas = post(api, "ventas.csv", b"fecha;region;monto\n2025-01-01;Norte;10.5\n2025-01-02;Sur;7\n")
    regiones = post(api, "regiones.csv", b"region,responsable\nNorte,Ana\nSur,Luis\nCentro,Sofia\n")
    alumnos = post(
        api,
        "alumnos.xlsx",
        xlsx_bytes(pd.DataFrame({"curso": ["1A", "1B"], "nota": [8, 6]})),
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )

    assert [r.status_code for r in (ventas, regiones, alumnos)] == [200, 200, 200]
    reports = [r.json() for r in (ventas, regiones, alumnos)]
    assert [r["filename"] for r in reports] == ["ventas.csv", "regiones.csv", "alumnos.xlsx"]
    assert [(r["row_count"], r["column_count"]) for r in reports] == [(2, 3), (3, 2), (2, 2)]
    assert [c["name"] for c in reports[1]["columns"]] == ["region", "responsable"]
    # Nada de una fuente aparece en otra: no hay unión ni estado compartido.
    assert "monto" not in [c["name"] for c in reports[1]["columns"]]


def test_a_failing_file_does_not_affect_the_next_one():
    api = client()
    assert post(api, "roto.csv", b"").status_code == 422
    ok = post(api, "datos.csv", b"a,b\n1,2\n")
    assert ok.status_code == 200
    assert ok.json()["row_count"] == 1


def test_same_file_twice_returns_the_same_profile():
    api = client()
    content = b"pais,valor\nAR,1\nNA,2\n"
    first, second = post(api, "x.csv", content).json(), post(api, "x.csv", content).json()
    assert first == second
