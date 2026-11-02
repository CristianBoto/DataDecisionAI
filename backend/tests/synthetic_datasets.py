"""Datasets SINTÉTICOS de estructuras distintas (Fase 5). Datos inventados, determinísticos.

- A · Ventas: fecha, rubro, canal y monto. Valores elegidos para que los totales se puedan
  calcular a mano.
- B · Educación: código, institución, nivel, matrícula, gastos y una tasa (no aditiva), con
  una matrícula faltante y otra igual a cero.
- C · Datos con errores: faltantes, marcadores, duplicados exactos y lógicos, categorías
  inconsistentes, fechas inválidas, texto en una columna numérica y un valor atípico.
"""

RUBROS = (("Alimentos", 1000), ("Bebidas", 500), ("Limpieza", 300))


def sales_rows() -> list[tuple[str, str, str, int]]:
    """36 filas: 6 meses × 3 rubros × 2 canales. Local = base + 10·mes; Online = base/2 + 5·mes."""
    rows = []
    for month in range(1, 7):
        for rubro, base in RUBROS:
            rows.append((f"2025-{month:02d}-15", rubro, "Local", base + 10 * month))
            rows.append((f"2025-{month:02d}-20", rubro, "Online", base // 2 + 5 * month))
    return rows


def sales_csv() -> str:
    return "fecha,rubro,canal,monto_ars\n" + "".join(f"{f},{r},{c},{m}\n" for f, r, c, m in sales_rows())


# Educación: (código, institución, nivel, matrícula, gastos, tasa de aprobación).
EDUCATION = [
    ("E101", "Escuela Ficticia Norte", "Primario", "180", "3600000", "91%"),
    ("E102", "Escuela Ficticia Sur", "Primario", "240", "4320000", "88%"),
    ("E103", "Escuela Ficticia Este", "Primario", "", "2100000", "90%"),  # matrícula faltante
    ("E104", "Escuela Ficticia Oeste", "Primario", "155", "3255000", "86%"),
    ("E205", "Colegio Ficticio Centro", "Secundario", "310", "8060000", "78%"),
    ("E206", "Colegio Ficticio Río", "Secundario", "275", "6875000", "81%"),
    ("E207", "Colegio Ficticio Lago", "Secundario", "0", "950000", "75%"),  # matrícula 0 (cerrado)
    ("E208", "Colegio Ficticio Monte", "Secundario", "198", "5346000", "83%"),
    ("E309", "Instituto Ficticio Uno", "Superior", "420", "15120000", "69%"),
    ("E310", "Instituto Ficticio Dos", "Superior", "365", "12775000", "72%"),
    ("E311", "Instituto Ficticio Tres", "Superior", "512", "17408000", "66%"),
    ("E312", "Instituto Ficticio Cuatro", "Superior", "290", "10730000", "74%"),
]


def education_csv() -> str:
    header = "codigo,institucion,nivel,matricula,gastos_ars,tasa_aprobacion\n"
    return header + "".join(",".join(r) + "\n" for r in EDUCATION)


ERRORS_CSV = """fecha,zona,monto
2025-01-10,Norte,120
2025-01-10,Norte,120
2025-01-12,norte,130
2025-02-03,Sur,125
2025-02-03, SUR ,125
2025-02-30,Sur,140
sin fecha,Este,135
2025-03-08,Este,abc
2025-03-09,Este,N/A
2025-03-15,Norte,
2025-04-02,Sur,128
2025-04-11,Este,132
2025-05-05,Norte,99999
2025-05-19,Sur,127
2025-06-01,Este,131
2025-06-21,Norte,126
"""
