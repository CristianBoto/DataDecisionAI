from io import BytesIO

import pandas as pd
import pytest
from app.services.dataset_profiler import DatasetProfileError, profile_dataset
from tests.ai_helpers import make_client


def test_csv_separator_semicolon_and_leading_zeros():
    csv = "Provincia;Codigo;Ventas\nCórdoba;001;100\nCórdoba;002;200\n"
    report = profile_dataset(csv.encode("utf-8-sig"), "datos.csv")
    assert report["row_count"] == 2
    assert report["column_count"] == 3
    assert report["preview"][0]["Codigo"] == "001"
    assert report["columns"][0]["distinct"] == 1


def test_nulls_are_reported_without_replacement():
    report = profile_dataset(b"zona;valor\nSur;\nNorte;10\n", "datos.csv")
    assert report["columns"][1]["missing"] == 1
    assert report["preview"][0]["valor"] == ""


def test_duplicate_rows_are_not_removed():
    report = profile_dataset(b"producto,unidades\nA,5\nA,5\n", "datos.csv")
    assert report["duplicate_rows"] == 1
    assert report["row_count"] == 2


def test_xlsx_first_sheet_read():
    file = BytesIO()
    pd.DataFrame({"Mes": ["enero"], "Ventas": [100]}).to_excel(file, index=False)
    report = profile_dataset(file.getvalue(), "ejemplo.xlsx")
    assert report["sheet_name"] == "Sheet1"
    assert report["row_count"] == 1


@pytest.mark.parametrize("name,content", [
    ("archivo.pdf", b"%PDF-"),
    ("archivo.csv", b""),
    ("archivo.xlsx", b"esto no es xlsx"),
])
def test_rejects_bad_files(name, content):
    with pytest.raises(DatasetProfileError):
        profile_dataset(content, name)


def test_endpoint_upload_csv():
    client, _ = make_client()
    response = client.post("/api/datasets/profile", files={"file": ("ventas.csv", b"mes,ventas\nenero,100\n", "text/csv")})
    assert response.status_code == 200
    assert response.json()["row_count"] == 1


def test_endpoint_rejects_pdf():
    client, _ = make_client()
    response = client.post("/api/datasets/profile", files={"file": ("archivo.pdf", b"PDF", "application/pdf")})
    assert response.status_code == 422


def test_mvp_accepts_more_than_100_000_rows():
    """Dataset real de prueba puede superar 100k sin alcanzar 250k."""
    content = b"anyo,valor\n" + b"2026,1\n" * 100_001
    report = profile_dataset(content, "importaciones.csv")
    assert report["row_count"] == 100_001
    assert report["column_count"] == 2


def test_rejects_files_above_25_mb():
    from app.services.dataset_profiler import MAX_FILE_BYTES

    with pytest.raises(DatasetProfileError, match="25 MB"):
        profile_dataset(b"a\n" + b"a" * MAX_FILE_BYTES, "datos.csv")
