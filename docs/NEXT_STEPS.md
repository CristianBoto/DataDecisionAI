# Próximos pasos — desarrollo con ChatGPT

Cada tarea indica qué construir, dónde y cómo saber que está terminada. Conviene hacerlas en orden y, al terminar cada una, poner `VITE_DEMO_MODE=false` para probar el frontend contra el backend real.

> Al pedir ayuda a ChatGPT, compartí `docs/API_CONTRACT.md` y `frontend/src/types/domain.ts`: son el contrato que hay que respetar.

## 1. Persistencia con base de datos
- Agregar SQLAlchemy 2 y SQLite (`DATABASE_URL`) en `backend/app/db/`.
- Modelos en `app/models/`: `Dataset`, `Project`, `Message`, `Proposal`, `ApprovedPlan`, `AnalysisRun`, `Result`.
- **Listo cuando**: un proyecto creado sobrevive a reiniciar el servidor.

## 2. API de carga de datasets
- `POST /api/datasets` con `UploadFile`; guardar en `UPLOAD_DIR` con nombre generado.
- Validar extensión, tamaño y que no esté vacío; responder `413/415/422` con `detail` en español.
- **Listo cuando**: el frontend sube CSV/XLSX y rechaza PDF con el mensaje del backend.

## 3. Lectura de CSV y Excel mediante Pandas
- `app/services/dataset_reader.py`: `pd.read_csv` (detectar separador y codificación) y `pd.read_excel` (`openpyxl`).
- Manejar hojas múltiples (elegir la primera o pedir al usuario).
- **Listo cuando**: la vista previa de Excel aparece en la pantalla de carga.

## 4. Perfilado y limpieza de datos
- `app/services/profiling.py`: tipos inferidos, nulos, únicos, duplicados, valores atípicos.
- Devolver `DatasetProfile` con `origin: "backend"` e `issues`.
- Proponer (no aplicar sin aprobación) limpiezas: normalizar fechas, números con coma decimal, espacios.
- **Listo cuando**: `GET /api/datasets/{id}/profile` coincide con el contrato y tiene pruebas.

## 5. Integración de OpenAI
- Cliente en `app/services/llm.py` usando `OPENAI_API_KEY` del `.env` (nunca en el frontend).
- Usar salidas estructuradas (JSON Schema / Pydantic) y manejar tiempos de espera y errores.
- **Listo cuando**: hay una función probada que devuelve un objeto Pydantic válido.

## 6. IA 1: comprensión y planificación
- Prompt de sistema: lenguaje simple, preguntar antes de suponer, nunca inventar columnas.
- Entrada: perfil + historial. Salida: mensaje + propuesta opcional (`AnalysisProposal`).
- Endpoints `GET/POST /api/projects/{id}/messages` y `GET /api/projects/{id}/proposal`.
- **Listo cuando**: el ejemplo de "comprar más mercadería" pide el stock si no existe.

## 7. Evaluación de viabilidad analítica
- Reglas en Python (no solo la IA): columnas requeridas existen, tipos adecuados, cantidad mínima de filas.
- Combinar con la evaluación de la IA para `feasibility` y `feasibilityReason`.
- Implementar `POST /api/projects/{id}/proposal/approve` (409 si no es la versión vigente, 422 si es insuficiente).

## 8. IA 2: generación de planes y análisis
- Convertir el plan aprobado en operaciones de un catálogo cerrado (agrupar, sumar, promediar, contar, histogramas, variaciones).
- **No ejecutar código generado por la IA**: la IA elige operaciones y columnas; Pandas las ejecuta.
- `POST /api/projects/{id}/analysis/run` (puede ser síncrono al principio).

## 9. Validación de cálculos
- Pruebas con datasets pequeños de resultado conocido.
- Verificar que cada número citado por la IA en `findings` exista en los resultados calculados.
- Asignar `evidence` según tamaño de muestra y consistencia.

## 10. Gráficos basados en datos reales
- Generar `Chart` (`xKey`, `series`, `data`) desde DataFrames agregados; limitar categorías (top N + "Otros").
- `GET /api/projects/{id}/results` con `isDemo: false` y `sourceNote` real.
- **Listo cuando**: el workspace muestra tus datos sin cambiar componentes.

## 11. Generación de informes y exportaciones
- `POST /api/projects/{id}/exports` según `format`:
  - PDF: ReportLab o WeasyPrint; gráficos con Matplotlib.
  - Excel: `xlsxwriter`/`openpyxl` (hojas: datos procesados, indicadores, tablas).
  - Word: `python-docx`.
  - Canva: `python-pptx` (o PDF) para importar en Canva.
- Devolver `Content-Disposition` con nombre de archivo; quitar el aviso "No disponible aún" del frontend.

## 12. Pruebas de integración y seguridad
- Pytest para cada endpoint (archivo válido, PDF, vacío, enorme, CSV malicioso con fórmulas `=CMD`).
- Sanitizar nombres de archivo, limitar tamaño, no exponer rutas internas en errores.
- Revisar CORS para producción, límites de uso de la IA y que ningún secreto llegue al frontend.
- Prueba de punta a punta: cargar → conversar → aprobar → resultados → exportar.
