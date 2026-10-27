"""Calidad de datos: faltantes, marcadores sospechosos y tipos semánticos.

Todos los datasets son sintéticos. Los nombres de columna imitan casos reales
(por ejemplo, importaciones con año, mes, código de producto y valor), pero las
reglas evaluadas son generales.
"""

from datetime import date
from io import BytesIO

import pandas as pd

from app.services.column_semantics import classify_column
from app.services.dataset_profiler import profile_dataset


def column(report: dict, name: str) -> dict:
    return next(c for c in report["columns"] if c["name"] == name)


def rows_csv(header: str, rows: list[str]) -> bytes:
    return ("\n".join([header, *rows]) + "\n").encode("utf-8")


# --- Valores faltantes -------------------------------------------------------

def test_only_empty_cells_are_missing_and_markers_are_suspected():
    content = rows_csv("pais,valor", ["AR,10", "NA,", "N/A,null", " ,-", "BR,20"])
    report = profile_dataset(content, "datos.csv")

    pais = column(report, "pais")
    assert pais["missing"] == 1  # solo la celda con espacios
    assert pais["suspected_missing"] == 2  # 'NA' y 'N/A'
    assert pais["suspected_missing_values"] == {"NA": 1, "N/A": 1}

    valor = column(report, "valor")
    assert valor["missing"] == 1
    assert valor["suspected_missing"] == 2  # 'null' y '-'
    assert any("podrían indicar ausencia" in w for w in report["warnings"])


def test_na_is_kept_as_a_valid_value():
    content = rows_csv("pais", ["AR", "NA", "BR", "NA"])
    report = profile_dataset(content, "paises.csv")
    pais = column(report, "pais")
    assert pais["missing"] == 0
    assert pais["distinct"] == 3  # 'NA' sigue contando como valor distinto
    assert report["preview"][1]["pais"] == "NA"  # no se modifica el dato


def test_completeness_uses_full_dataset_and_explicit_criteria():
    rows = [f"{i}," for i in range(150)] + [f"{i},{i}" for i in range(150, 200)]
    report = profile_dataset(rows_csv("a,b", rows), "datos.csv")
    assert report["total_cells"] == 400
    assert report["empty_cells"] == 150
    assert report["completeness"] == 0.625
    assert report["suspected_missing_cells"] == 0


# --- Tipos semánticos ----------------------------------------------------------

def test_trade_like_dataset_is_classified_with_general_rules():
    rows = [
        f"{2020 + i % 5};{1 + i % 12};{26030000 + (i % 40) * 100};{1500.5 + i * 3.25:.2f};{'AR BR CL PE'.split()[i % 4]}"
        for i in range(120)
    ]
    report = profile_dataset(rows_csv("ANYO;MES;PPRO;CIF;PAIS", rows), "importaciones.csv")

    assert column(report, "ANYO")["semantic_type"] == "temporal"
    assert column(report, "MES")["semantic_type"] == "temporal"
    assert column(report, "PPRO")["semantic_type"] == "identifier"
    assert column(report, "PPRO")["semantic_confidence"] != "high"  # inferencia, no certeza
    assert column(report, "CIF")["semantic_type"] == "quantitative"
    assert column(report, "PAIS")["semantic_type"] == "categorical"
    assert all(c["value_kind"] == "numeric" for c in report["columns"][:4])
    assert any("'PPRO'" in w and "código" in w for w in report["warnings"])


def test_distinct_integers_are_ids_only_when_nearly_consecutive():
    rows = [f"{1001 + i},{450 + i * 37 % 900}" for i in range(72)]
    report = profile_dataset(rows_csv("nro,importe", rows), "ventas.csv")
    assert column(report, "nro")["semantic_type"] == "identifier"
    assert column(report, "importe")["semantic_type"] == "quantitative"


def test_leading_zeros_mean_code_not_quantity():
    report = profile_dataset(rows_csv("zona", ["001", "002", "010"]), "datos.csv")
    zona = column(report, "zona")
    assert zona["semantic_type"] == "identifier"
    assert zona["semantic_confidence"] == "high"


def test_dates_are_temporal():
    report = profile_dataset(rows_csv("fecha,monto", ["2025-01-03,10.5", "2025-02-10,7", "15/03/2025,3"]), "d.csv")
    assert column(report, "fecha")["value_kind"] == "date"
    assert column(report, "fecha")["semantic_type"] == "temporal"


def test_ambiguous_columns_get_low_confidence_and_a_warning():
    rows = [f"{2000 + i % 20},{1 + i % 5},{'x' if i % 3 == 0 else i}" for i in range(60)]
    report = profile_dataset(rows_csv("c1,c2,c3", rows), "ambiguo.csv")

    c1 = column(report, "c1")  # posible año sin nombre que lo confirme
    assert (c1["semantic_type"], c1["semantic_confidence"]) == ("temporal", "low")
    c2 = column(report, "c2")  # pocos enteros distintos: ¿categoría o cantidad?
    assert c2["semantic_confidence"] == "low"
    c3 = column(report, "c3")  # mezcla de números y texto
    assert c3["value_kind"] == "mixed"
    assert sum("'c" in w for w in report["warnings"]) >= 3


def test_markers_do_not_change_the_column_type():
    report = profile_dataset(rows_csv("monto", ["10.5", "NA", "7.25", "-", "3.1"]), "d.csv")
    monto = column(report, "monto")
    assert monto["semantic_type"] == "quantitative"
    assert monto["suspected_missing"] == 2


def test_semantics_do_not_depend_on_a_specific_dataset():
    # Mismo patrón de año con otro idioma y otro nombre de columna.
    values = pd.Series([str(1990 + i % 30) for i in range(40)])
    assert classify_column("Fiscal Year", values).semantic_type == "temporal"
    assert classify_column("Año", values).semantic_type == "temporal"


# --- Excel --------------------------------------------------------------------

def test_xlsx_numbers_codes_dates_and_missing():
    frame = pd.DataFrame({
        "Fecha": [date(2025, 1, d + 1) for d in range(25)],
        "Codigo": [f"{i:05d}" for i in range(25)],
        "Importe": [100.25 + i for i in range(25)],
        "Obs": ["NA" if i % 5 == 0 else ("" if i % 7 == 0 else "ok") for i in range(25)],
    })
    file = BytesIO()
    frame.to_excel(file, index=False)
    report = profile_dataset(file.getvalue(), "libro.xlsx")

    assert column(report, "Fecha")["semantic_type"] == "temporal"
    assert column(report, "Codigo")["semantic_type"] == "identifier"
    assert column(report, "Importe")["semantic_type"] == "quantitative"
    obs = column(report, "Obs")
    assert obs["suspected_missing"] == 5
    assert obs["missing"] == 3


def test_constant_column_is_flagged_with_low_confidence():
    report = profile_dataset(rows_csv("estado,monto", [f"activo,{i}.5" for i in range(30)]), "d.csv")
    estado = column(report, "estado")
    assert estado["semantic_confidence"] == "low"
    assert "mismo valor" in estado["semantic_reason"]
    assert any("'estado'" in w and "constante" in w for w in report["warnings"])
