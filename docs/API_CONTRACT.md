# Contrato de la API — DataDecision AI

Este documento define las operaciones que el backend **FastAPI** debe implementar para reemplazar al proveedor DEMO del frontend.

- Base: `http://localhost:8000` (configurable con `VITE_API_BASE_URL`).
- Prefijo: `/api`.
- Formato: JSON en **camelCase** (en Pydantic: `alias_generator=to_camel`, `populate_by_name=True`).
- Fechas: ISO 8601 (`2026-10-24T13:00:00Z`).
- Errores: formato estándar de FastAPI `{ "detail": "mensaje legible en español" }`.
- Tipos: definidos en [`frontend/src/types/domain.ts`](../frontend/src/types/domain.ts). La interfaz del cliente está en [`frontend/src/services/types.ts`](../frontend/src/services/types.ts) y su implementación HTTP en [`httpProvider.ts`](../frontend/src/services/httpProvider.ts).

| # | Operación | Método y ruta | Estado |
|---|-----------|---------------|--------|
| 0 | Salud | `GET /api/health` | ✅ Implementado |
| 1 | Carga de archivo | `POST /api/datasets` | Pendiente |
| 1b | Perfilado sin guardar (CSV/XLSX con Pandas) | `POST /api/datasets/profile` | ✅ Implementado |
| 2 | Perfil del dataset | `GET /api/datasets/{datasetId}/profile` | Pendiente |
| 3 | Crear proyecto | `POST /api/projects` | Pendiente |
| 4 | Consultar proyecto | `GET /api/projects/{projectId}` | Pendiente |
| 5 | Historial del asistente | `GET /api/projects/{projectId}/messages` | Pendiente |
| 6 | Enviar mensaje al asistente | `POST /api/projects/{projectId}/messages` | Pendiente |
| 7 | Propuesta vigente | `GET /api/projects/{projectId}/proposal` | Pendiente |
| 8 | Aprobar propuesta | `POST /api/projects/{projectId}/proposal/approve` | Pendiente |
| 9 | Ejecutar análisis | `POST /api/projects/{projectId}/analysis/run` | Pendiente |
| 10 | Consultar resultados | `GET /api/projects/{projectId}/results` | Pendiente |
| 11 | Exportar análisis (PDF, Excel, Word, Canva) | `POST /api/projects/{projectId}/exports` | Pendiente |

---

## 0. Salud

`GET /api/health` → `200`

```json
{ "status": "ok", "service": "DataDecision AI API", "version": "0.1.0", "environment": "development" }
```

## 1. Carga de archivo

`POST /api/datasets` — `multipart/form-data` con el campo `file`.

Validación definitiva en el backend: extensión `.csv`/`.xlsx`, tamaño máximo (`MAX_UPLOAD_MB`), contenido legible por Pandas, al menos una fila y una columna. El archivo se guarda en `UPLOAD_DIR` con un nombre generado (nunca el nombre original como ruta).

`201` → `Dataset`

```json
{
  "id": "ds_8f2a1c3b",
  "name": "ventas_2025",
  "fileName": "ventas_2025.csv",
  "format": "csv",
  "sizeBytes": 96512,
  "uploadedAt": "2026-10-24T13:00:00Z",
  "source": "upload",
  "status": "profiling"
}
```

Errores: `413` archivo demasiado grande · `415` formato no compatible (por ejemplo PDF) · `422` archivo vacío o ilegible.

## 1b. Perfilado sin guardar

`POST /api/datasets/profile` — `multipart/form-data` con el campo `file` (CSV o XLSX, hasta 25 MB). El backend lee el archivo con Pandas, devuelve el diagnóstico y **no lo guarda**.

La respuesta usa **snake_case** (tal como la genera `backend/app/services/dataset_profiler.py`). El frontend la convierte a `DatasetProfile` en [`backendProfile.ts`](../frontend/src/services/backendProfile.ts) sin cambiar ninguno de los dos contratos.

```json
{
  "filename": "ventas.csv",
  "format": "csv",
  "encoding": "utf-8-sig",
  "sheet_name": null,
  "row_count": 102254,
  "column_count": 8,
  "duplicate_rows": 12,
  "columns": [
    { "name": "region", "missing": 4, "non_empty": 102250, "distinct": 5, "examples": ["Norte", "Sur", "Centro"] }
  ],
  "preview": [{ "region": "Norte" }],
  "warnings": ["La columna 'region' tiene 4 valores vacíos."]
}
```

| Backend | Frontend (`DatasetProfile`) |
|---------|-----------------------------|
| `row_count`, `column_count` | `rowCount`, `columnCount` (`rowCountIsEstimate: false`, `isComplete: true`, `origin: "backend"`) |
| `duplicate_rows` | `duplicateRowCount` (opcional) |
| `columns[].missing` / `non_empty` / `distinct` / `examples` | `nullCount` / `nonNullCount` / `uniqueCount` / `sampleValues` |
| `preview` | `previewRows` |
| `warnings[]` | `issues[]` con `severity: "warning"` (y `column` si el mensaje la nombra) |
| `encoding`, `sheet_name` | `note` |
| `columns[].suspected_missing` | `suspectedMissingCount` (marcadores como `NA`; **no** incluidos en `nullCount`) |
| `columns[].value_kind` | `inferredType` (formato calculado sobre todos los valores; `mixed` → `text`) |
| `columns[].semantic_type` / `semantic_confidence` / `semantic_reason` | `semanticType` / `semanticConfidence` / `semanticReason` |
| `completeness`, `suspected_missing_cells` | `completeness`, `suspectedMissingCellCount` |

Campos de calidad (Fase 2): `total_cells`, `empty_cells`, `suspected_missing_cells`, `completeness` (celdas no vacías ÷ total) y, por columna, `suspected_missing`, `suspected_missing_values`, `value_kind`, `semantic_type` (`quantitative | categorical | identifier | temporal | text | unknown`), `semantic_confidence` (`high | medium | low`) y `semantic_reason`. Son **aditivos**: el adaptador tolera su ausencia.

Errores: `413` más de 25 MB · `422` formato no admitido, archivo vacío o ilegible (con `detail` en español).

Lo usa el proveedor DEMO cuando `VITE_BACKEND_PROFILING=true`.

## 2. Perfil del dataset

`GET /api/datasets/{datasetId}/profile` → `DatasetProfile`

```json
{
  "datasetId": "ds_8f2a1c3b",
  "origin": "backend",
  "isComplete": true,
  "rowCount": 1440,
  "rowCountIsEstimate": false,
  "columnCount": 3,
  "columns": [
    { "name": "fecha", "inferredType": "date", "nonNullCount": 1440, "nullCount": 0, "uniqueCount": 362, "sampleValues": ["2025-01-03"] },
    { "name": "categoria", "inferredType": "text", "nonNullCount": 1440, "nullCount": 0, "uniqueCount": 5, "sampleValues": ["Bebidas"] },
    { "name": "ingreso", "inferredType": "numeric", "nonNullCount": 1418, "nullCount": 22, "uniqueCount": 702, "sampleValues": ["20400"] }
  ],
  "previewRows": [{ "fecha": "2025-01-03", "categoria": "Bebidas", "ingreso": "20400" }],
  "issues": [{ "severity": "warning", "column": "ingreso", "message": "22 filas sin valor (1,5 %)." }],
  "note": null
}
```

`inferredType`: `numeric | text | date | boolean | unknown`. `previewRows` usa los nombres reales de columna como claves y valores como texto. **El frontend no asume columnas fijas.**

## 3. Crear proyecto

`POST /api/projects`

```json
{ "name": "Análisis de ventas 2025", "datasetId": "ds_8f2a1c3b" }
```

Varias fuentes (opcional, máximo 3; la primera es la principal):

```json
{ "name": "Importaciones y países", "datasetId": "ds_a", "datasetIds": ["ds_a", "ds_b"] }
```

`201` → `Project` (con `status: "draft"` y `approvedPlan: null`; con varias fuentes incluye `datasetIds` y `datasets`). Las fuentes se **referencian**: no se unen ni se transforman. Errores: `422` más de 3 fuentes; `404` fuente inexistente. El backend crea también el primer mensaje del asistente (saludo basado en el perfil).

## 4. Consultar proyecto

`GET /api/projects/{projectId}` → `Project`

```json
{
  "id": "prj_1a2b3c4d",
  "name": "Análisis de ventas 2025",
  "datasetId": "ds_8f2a1c3b",
  "dataset": { "...": "Dataset" },
  "status": "approved",
  "createdAt": "2026-10-24T13:01:00Z",
  "updatedAt": "2026-10-24T13:10:00Z",
  "approvedPlan": { "...": "ApprovedAnalysisPlan o null" }
}
```

`status`: `draft | awaiting_approval | approved | running | completed | failed`. `404` si no existe.

## 5. Historial del asistente

`GET /api/projects/{projectId}/messages` → `AssistantMessage[]`

```json
[
  {
    "id": "msg_01",
    "role": "assistant",
    "kind": "question",
    "content": "Entiendo que querés analizar las ventas mensuales…",
    "createdAt": "2026-10-24T13:02:00Z",
    "suggestions": ["Continuar con el análisis de ventas"],
    "proposalId": null
  }
]
```

`role`: `user | assistant | system`. `kind`: `text | question | proposal | notice`.

## 6. Enviar mensaje al asistente (IA 1)

`POST /api/projects/{projectId}/messages`

```json
{ "content": "Quiero saber si debería comprar más mercadería" }
```

`200` → `ChatReply`

```json
{
  "messages": [ { "role": "user", "...": "eco del usuario" }, { "role": "assistant", "...": "respuesta" } ],
  "proposal": { "...": "AnalysisProposal o null" }
}
```

Reglas para la IA 1 (backend):
- Recibe el perfil del dataset, nunca el archivo completo.
- No inventa columnas ni datos: si falta información, la pide o la declara en `missingInformation`.
- Cuando genera o actualiza una propuesta, incrementa `version` y el mensaje lleva `kind: "proposal"` y `proposalId`.
- Validar `content`: 1 a 2000 caracteres (`422` si no cumple).

## 7. Propuesta vigente

`GET /api/projects/{projectId}/proposal` → `AnalysisProposal | null`

```json
{
  "id": "prop_9z8y",
  "projectId": "prj_1a2b3c4d",
  "version": 2,
  "objective": "Identificar qué productos conviene reponer según la demanda.",
  "summary": "Analizaremos la demanda mensual y por categoría…",
  "indicators": [{ "id": "kpi_ingresos_totales", "label": "Ingresos totales", "description": "…", "columns": ["ingreso"] }],
  "charts": [{ "id": "chart_ingresos_mensuales", "type": "line", "title": "Ingresos mensuales", "description": "…", "columns": ["fecha", "ingreso"] }],
  "requiredData": ["fecha", "ingreso"],
  "limitations": ["Sin stock no es posible recomendar cantidades."],
  "missingInformation": ["Stock actual por producto"],
  "requestedChanges": ["Agregar comparación por región"],
  "feasibility": "partial",
  "feasibilityReason": "Falta el stock para recomendar cantidades.",
  "createdAt": "2026-10-24T13:05:00Z"
}
```

`feasibility` (estado de viabilidad): `viable | partial | insufficient`. `chart.type`: `bar | line | area | histogram`.

## 8. Aprobar propuesta

`POST /api/projects/{projectId}/proposal/approve`

```json
{ "proposalId": "prop_9z8y" }
```

`200` → `ApprovedAnalysisPlan`

```json
{
  "id": "plan_77aa",
  "projectId": "prj_1a2b3c4d",
  "proposalId": "prop_9z8y",
  "proposalVersion": 2,
  "approvedAt": "2026-10-24T13:06:00Z",
  "objective": "…",
  "indicators": [],
  "charts": [],
  "limitations": []
}
```

Errores: `409` si `proposalId` no es la versión vigente · `422` si la viabilidad es `insufficient`.

## 9. Ejecutar análisis (IA 2 + Pandas)

`POST /api/projects/{projectId}/analysis/run` → `202` `AnalysisRun`

```json
{ "id": "run_01", "projectId": "prj_1a2b3c4d", "status": "running", "startedAt": "…", "finishedAt": null, "error": null }
```

`status`: `queued | running | completed | failed`. `409` si no hay plan aprobado. Los cálculos los hace **Python/Pandas**; la IA 2 planifica y redacta, pero no inventa números.

## 10. Consultar resultados

`GET /api/projects/{projectId}/results` → `AnalysisResults`

```json
{
  "projectId": "prj_1a2b3c4d",
  "status": "available",
  "generatedAt": "2026-10-24T13:08:00Z",
  "isDemo": false,
  "sourceNote": "Calculado con Pandas sobre ventas_2025.csv (1418 filas válidas).",
  "indicators": [
    { "id": "kpi_ingresos_totales", "label": "Ingresos totales", "value": 48200000, "format": "currency", "change": 0.21, "changeLabel": "2.º semestre vs. 1.º", "description": "Suma de «ingreso»." }
  ],
  "charts": [
    {
      "id": "chart_ingresos_mensuales",
      "type": "line",
      "title": "Ingresos mensuales",
      "description": "Suma de «ingreso» por mes.",
      "xKey": "mes",
      "series": [{ "key": "ingresos", "label": "Ingresos", "format": "currency" }],
      "data": [{ "mes": "Ene", "ingresos": 3100000 }]
    }
  ],
  "findings": [
    { "id": "f1", "title": "…", "detail": "…", "evidence": "strong", "relatedChartId": "chart_ingresos_mensuales", "recommendation": "…" }
  ],
  "limitations": ["…"]
}
```

`status`: `available | pending_backend | not_started`. `evidence`: `strong | moderate | weak`. `format`: `number | currency | percent`. Los gráficos son genéricos (`xKey` + `series` + `data`), así que funcionan con cualquier dataset.

## 11. Exportar análisis

`POST /api/projects/{projectId}/exports`

```json
{
  "format": "pdf",
  "canvaFileType": null,
  "title": "Informe — Análisis de ventas 2025",
  "author": "Nombre Apellido",
  "organization": "Mi organización",
  "date": "2026-10-24",
  "objectives": "…",
  "sections": { "objectives": true, "indicators": true, "charts": true, "analysis": true, "limitations": true }
}
```

| `format` | Respuesta | Contenido | `Content-Type` |
|----------|-----------|-----------|----------------|
| `pdf` | `.pdf` | Informe completo con gráficos, conclusiones y fuentes | `application/pdf` |
| `xlsx` | `.xlsx` | Datos procesados, indicadores y tablas de resultados | `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` |
| `docx` | `.docx` | Informe editable con gráficos y análisis | `application/vnd.openxmlformats-officedocument.wordprocessingml.document` |
| `canva` + `canvaFileType: "pptx"` | `.pptx` | Presentación para importar en Canva | `application/vnd.openxmlformats-officedocument.presentationml.presentation` |
| `canva` + `canvaFileType: "pdf"` | `.pdf` | Documento para importar en Canva | `application/pdf` |

Respuesta `200` con el archivo binario y `Content-Disposition: attachment; filename="informe.pdf"` (el header está expuesto por CORS). Errores: `409` si no hay resultados disponibles · `422` si faltan título, autor o fecha.

> No hay integración directa con la API de Canva: se genera un archivo compatible que el usuario sube a Canva.
