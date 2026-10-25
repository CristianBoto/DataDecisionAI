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

---

## Fase 3B — IA real con frontera de datos

**3B.1 (cerrada):** contrato de lista blanca, denegación por defecto, revisión y autorización de uso único, clave solo en el backend, demo pública aislada, sin llamadas externas ([SEGURIDAD.md](SEGURIDAD.md), sección 9).

**3B.2 — Qué falta exactamente para conectar OpenAI:**

1. Agregar el SDK oficial de OpenAI a `backend/requirements.txt` (dependencia justificada) y `OPENAI_MODEL` configurable en `backend/.env`.
2. Implementar `OpenAIProvider` (con `implemented = True`) en `app/services/ai_gateway.py`: clave desde la configuración, tiempo máximo de espera, errores sin contenido sensible; usarlo solo si `AI_ENABLED=true` y hay clave.
3. Instrucciones del sistema para la IA y **salida estructurada** con un esquema Pydantic: objetivos reconocidos, preguntas, relación entre fuentes (`independiente`, `comparar`, `concatenar`, `relacionar`) y operaciones de un catálogo cerrado.
4. Validar la respuesta: solo columnas y alias autorizados, solo operaciones del catálogo; rechazar lo demás. Nunca ejecutar código devuelto por la IA.
5. Registro local de cada envío (fecha, alias, cantidad de columnas, huella), **sin** objetivo ni nombres de columna.
6. Mostrar en el asistente las preguntas y el plan propuesto, para que el usuario los confirme.
7. Pruebas con un proveedor falso (contrato y validación) y una prueba manual con una clave de prueba y **datos sintéticos**.

**Requisitos funcionales de la IA** (surgidos de la validación del asistente DEMO con dos fuentes reales):

- Reconocer **todos** los objetivos solicitados en un mismo mensaje.
- Comprender cuándo varias fuentes deben analizarse **de forma independiente**.
- Distinguir entre **comparar, concatenar, relacionar y analizar por separado**.
- **Preguntar** cuando falte información o haya ambigüedad.
- **No** tratar automáticamente todo campo numérico como variable cuantitativa (por ejemplo, `PPRO`).
- **No inventar** estadísticas ni conclusiones.
- Proponer **planes de análisis** que el usuario confirme antes de ejecutarlos.

- **Listo cuando**: con SIACAM e indicadores provinciales, ante el pedido "evolución de importaciones por año y, por separado, indicadores provinciales, sin relacionarlos", la IA reconoce ambos objetivos, confirma que no relacionará las fuentes, pregunta por `PPRO` y propone dos planes independientes para aprobar.

## Recorrido con revisión obligatoria (implementado y validado por el autor)

Cargar → **revisar datos y privacidad** → conversar → confirmar. Las decisiones de la revisión (formato, significado, marcadores, columnas y nombres para la IA, objetivo) quedan en el estado del análisis. Para 3B.2 esto implica:

- La IA recibirá en el contexto las correcciones del usuario (`user_corrected`) y su decisión sobre marcadores (`missing_markers`).
- **Cada mensaje** a la IA real necesitará su propia autorización; la confirmación de la revisión no es un permiso permanente.
- El punto de conexión en la interfaz ya existe: el panel «Enviar a la IA real» (`MessageAuthorization`) y el hook `useAIAuthorization`. Hoy terminan en «Prueba finalizada…» (403/501); en 3B.2 ese estado final se reemplaza por la respuesta estructurada y validada de la IA, sin cambiar la autorización de un solo uso.
- Pendiente para la fase de cálculo: aplicar las decisiones en Pandas sobre copias (por ejemplo, tratar `NA` como faltante solo donde el usuario lo indicó).

## Fase 4A — Motor de análisis con Pandas (implementada)

Los planes aprobados se ejecutan con Pandas sobre los archivos reenviados al confirmar. Ver [ARCHITECTURE.md](ARCHITECTURE.md), sección "Motor de análisis con Pandas".

**Siguiente (4B):**
- gráficos dinámicos a partir de las tablas de resultados (ya incluyen dimensiones, medidas y los gráficos sugeridos por el plan);
- informe PDF descargable;
- elección del período (mes o año) y operaciones pendientes del catálogo (desvío, ranking, correlación);
- persistencia de planes aprobados y resultados.

## Fase 3B.2 — Integración real con OpenAI (implementada; primera llamada real pendiente)

**Estado (25/10/2026).** Todos los requisitos de la tabla están implementados y probados con proveedores falsos, sin consumir tokens. Ver [SEGURIDAD.md](SEGURIDAD.md), sección 10.

Lo que falta:
1. ~~**Primera llamada real**~~: realizada por el autor con datos sintéticos (dos consultas, USD 0,0004 y 0,0005). Ver la bitácora, sección 6p. También quedaron resueltos el plan aprobado en «Confirmar» y la autorización por conversación.
1b. **Persistir planes y aprobaciones**, hoy en memoria, cuando llegue el motor de análisis.
2. **Caso del autor con la IA real:** indicadores provinciales y SIACAM por separado, preguntas sobre `PPRO` y los `NA`. Registrar el resultado y el consumo.
3. **Ajustar las instrucciones** si el modelo no pregunta lo esperado.

**Plan original:**

**Objetivo:** que la IA comprenda objetivos sobre una o varias fuentes, haga preguntas aclaratorias y proponga planes para aprobar. Pandas sigue calculando; la IA no ejecuta nada.

| Requisito | Cómo |
|-----------|------|
| Clave solo en el backend | `OPENAI_API_KEY` en `backend/.env`; nunca en `VITE_*` ni en el navegador (ya implementado en 3B.1) |
| Modelo económico con razonamiento adecuado | `OPENAI_MODEL` configurable; elegir un modelo pequeño de la familia actual con salidas estructuradas, y validarlo con los casos de prueba (SIACAM + indicadores) |
| Límites de tokens y presupuesto | Tope de tokens de salida por solicitud; tope de solicitudes por sesión; presupuesto mensual configurado también en el panel del proveedor |
| Medición real del consumo | Registrar por envío los tokens de entrada y salida informados por la API (sin contenido) y mostrar el acumulado |
| Envíos solo con autorización específica | Reutilizar la frontera de 3B.1: el `OpenAIProvider` reemplaza a `NotImplementedProvider` detrás de `authorize_and_send` |
| Respuestas estructuradas y validadas | Esquema Pydantic: objetivos reconocidos, preguntas, relación entre fuentes (`independiente`, `comparar`, `concatenar`, `relacionar`) y operaciones de un catálogo cerrado; rechazar columnas o alias no autorizados |
| Varias fuentes | Reconocer cada objetivo y respetar "analizar por separado" (caso de validación del autor) |
| Preguntas y propuestas para aprobación | Mostrar preguntas y plan en el asistente; nada se calcula sin aprobación |
| Sin ejecución de código | La IA nunca devuelve código ejecutable; Pandas ejecuta solo operaciones del catálogo |
| Demo pública sin consumo | La demo no tiene cliente de IA ni backend: no puede consumir créditos |

**Fuera de alcance:** pagos, autenticación empresarial, colas o infraestructura nueva.

**Listo cuando:** con `AI_ENABLED=true` y una clave de prueba, el caso del autor (dos fuentes, análisis por separado, pedido de preguntar ante ambigüedades) produce preguntas sobre `PPRO` y los `NA`, dos planes independientes validados y un registro de consumo de tokens, sin datos fuera de la lista blanca.

## Próxima fase: confirmación humana de la interpretación (planificada)

- El perfilador ya propone tipo semántico, confianza, motivo y marcadores sospechosos; **no decide**.
- Agregar al asistente preguntas acotadas cuando haya ambigüedad: significado de una variable (¿código o cantidad?), marcadores (`NA`: ¿faltante o valor válido?) y necesidades del análisis.
- Guardar las decisiones del usuario junto al plan aprobado y aplicarlas en Pandas sobre una copia en memoria; **nunca** modificar ni eliminar datos originales sin autorización.
- Sin reglas específicas de un dataset: SIACAM es solo un caso de prueba.
- **Listo cuando**: con SIACAM, el asistente pregunta por `PPRO` y por los `NA` de `ORIGEN`, `PPRO` y `PROCEDENC`, y el plan aprobado registra las respuestas.

## Estado actual (para orientar el trabajo)

| Ya funciona | Se implementará después con ChatGPT |
|-------------|-------------------------------------|
| Interfaz completa en modo DEMO | Backend real (tareas 1 a 12) |
| Vista previa local de CSV sin envío por red | Guardar datasets y perfil por `datasetId` |
| Perfilado con Pandas sin guardar (`POST /api/datasets/profile`, `VITE_BACKEND_PROFILING=true`) | Tipos de columna calculados en el backend |
| Guion DEMO del asistente | IA 1 e IA 2 con OpenAI |
| Resultados ficticios marcados | Cálculos y gráficos con datos reales |
| Interfaz de exportación | Generación de PDF, Excel, Word y Canva |
| `/api/health` y configuración | Persistencia, despliegue y seguridad (tareas 13 a 15) |
| Preparación para Cloudflare Pages ([DEPLOYMENT.md](DEPLOYMENT.md)) | — |

## 13. Despliegue del backend
- Decidir dónde corre el backend para una demo con datos reales (por ejemplo, un equipo propio o un servicio con plan gratuito) sin exponer claves.
- Configurar `CORS_ORIGINS` con la URL exacta del frontend publicado; nunca `*`.
- Servir con `uvicorn` detrás de HTTPS; agregar límites de tamaño y de solicitudes.
- Mantener la demo pública de Cloudflare en `VITE_DEMO_MODE=true` hasta que el backend tenga los controles de la tarea 15.
- **Listo cuando**: un frontend con `VITE_DEMO_MODE=false` se conecta al backend desplegado y `/api/health` responde por HTTPS.

## 14. Instalación privada
- Script o guía paso a paso (PowerShell) que cree `.venv`, instale dependencias, genere `backend/.env` desde el ejemplo y compile el frontend con `VITE_DEMO_MODE=false`.
- Crear automáticamente `backend/data/` y la base SQLite en el primer arranque.
- Opción para servir `frontend/dist` desde el mismo FastAPI (`StaticFiles`) y simplificar la instalación a un solo proceso.
- OpenAI desactivado por defecto; activarlo solo con `OPENAI_API_KEY` y una opción explícita en `.env` (por ejemplo `AI_ENABLED=true`).
- Documentar copias de seguridad de `backend/data/`.
- **Listo cuando**: una persona sin experiencia sigue la guía y usa la app con un CSV propio sin Internet (salvo OpenAI, si lo habilita).

## 15. Controles de privacidad
- Autenticación simple (usuario y contraseña con hash) antes de exponer la instalación en una red.
- Aviso y consentimiento explícito antes de enviar el perfil o resúmenes a OpenAI; registrar qué se envió.
- Enviar a la IA solo perfil y agregados, nunca el archivo completo; opción para ocultar columnas sensibles.
- Política de retención: borrar datasets y resultados después de N días o a pedido del usuario.
- Cifrado en reposo de `backend/data/` (o del disco) y HTTPS en la red interna.
- Registro de auditoría: quién subió, analizó y exportó cada dataset.
- **Listo cuando**: existe una lista de verificación de privacidad aprobada y con pruebas automatizadas para los puntos críticos.
