# Arquitectura — DataDecision AI

## Visión general

Aplicación web en dos partes, sin microservicios:

```
┌──────────────────────────── Navegador ────────────────────────────┐
│  React + Vite + TypeScript                                        │
│                                                                   │
│  pages/ ─► components/ ─► hooks/ ─► services/  (interfaz única)   │
│                                        │                          │
│                     VITE_DEMO_MODE=true│false                     │
│                         ┌──────────────┴─────────────┐            │
│                   demoProvider.ts              httpProvider.ts    │
│                   (memoria + mocks/)           (fetch → FastAPI)  │
└───────────────────────────────────────────────────┬───────────────┘
                                                    │ JSON / multipart
┌──────────────────────────── Servidor ─────────────▼───────────────┐
│  FastAPI  ─►  api/routes  ─►  services/  ─►  Pandas / NumPy        │
│                                   │          OpenAI (IA 1 e IA 2)  │
│                                   └────────► db/ (SQLite/Postgres) │
└───────────────────────────────────────────────────────────────────┘
```

## Modalidades de uso

El mismo código se ejecuta de dos maneras. La única diferencia es la configuración; no hay ramas ni copias del código.

### Demo pública (frontend solo)

```
Visitante ──► Cloudflare Pages (archivos estáticos de frontend/dist)
                 VITE_DEMO_MODE=true → demoProvider.ts
                 · Sin backend, sin base de datos, sin OpenAI
                 · CSV leído en el navegador (FileReader / Blob.text)
                 · Ninguna solicitud de red con datos del usuario
```

- `services/index.ts` crea solo el proveedor DEMO; el cliente HTTP no se instancia (con `VITE_BACKEND_PROFILING` sin definir o en `false`).
- El estado vive en memoria y desaparece al recargar.
- Los resultados son del dataset ficticio de ejemplo y se marcan como DEMO. Con un archivo propio se muestra "pendiente de backend".
- Cloudflare Pages resuelve las rutas de React Router devolviendo `index.html` (SPA, sin `404.html`).

### DEMO con perfilado real (ejecución local)

```
Navegador ──► demoProvider.ts (asistente y resultados DEMO)
                 │ VITE_BACKEND_PROFILING=true
                 ▼
            backendProfile.ts ──POST /api/datasets/profile──► FastAPI ──► Pandas (no guarda el archivo)
```

- `createService()` inyecta un `DatasetProfiler` en el proveedor DEMO; los demás métodos no cambian.
- **`VITE_DEMO_MODE=false` usa hoy esta misma composición** (sesión en memoria + perfilado real), porque el backend todavía no implementa la API completa de la instalación privada (`POST /api/datasets`, `/api/projects`…). Antes usaba el proveedor HTTP completo y la carga terminaba en 404 (bitácora, sección 6o). El asistente usa la IA real solo si el backend la tiene habilitada.
- `backendProfile.ts` adapta la respuesta snake_case de Python a `DatasetProfile` (`origin: "backend"`).
- Si el backend falla, `uploadDataset` rechaza con el error: no hay respaldo silencioso con datos locales o ficticios.
- El servicio expone `profiling: "browser" | "backend"` para que la pantalla de carga muestre el aviso correcto.

### Instalación privada (frontend + backend en la organización) — planificada

> El proveedor HTTP completo (`httpProvider.ts`) y la persistencia descripta acá todavía no están implementados en el backend.

```
Red interna de la organización
  Navegador ──► frontend/dist (VITE_DEMO_MODE=false, VITE_API_BASE_URL=backend interno)
                   │
                   ▼
              FastAPI ──► Pandas ──► SQLite (backend/data/)  ──► archivos subidos (backend/data/uploads/)
                   │
                   └──► OpenAI (opcional, desactivado sin OPENAI_API_KEY)
```

- Cada instalación tiene su propia base SQLite, carpeta de archivos y `.env`. No hay multi-tenancy: una instalación = una organización.
- OpenAI es una integración opcional que cada organización autoriza y configura con su propia clave.
- Hoy el backend expone `/api/health` y `POST /api/datasets/profile` (perfilado sin guardar). Los controles de seguridad necesarios para datos confidenciales (autenticación, HTTPS, cifrado, auditoría, retención) están **pendientes**: ver [DEPLOYMENT.md](DEPLOYMENT.md).

## Flujo funcional

1. **Carga** (`/analisis/cargar`): hasta 3 fuentes; validación preliminar y perfil (local o con Pandas).
2. **Revisión obligatoria** (`/analisis/revisar`): por fuente, formato y significado (aceptar o corregir), decisión sobre marcadores como `NA`, columnas a compartir con la IA y su nombre, objetivo del análisis y JSON exacto. Al confirmar se crea el proyecto.
3. **Asistente** (`/analisis/asistente`): solo con la revisión confirmada; el objetivo llega precargado (no se envía solo). Con `AI_ENABLED=false` se usa el asistente DEMO, sin transmisión a OpenAI.
4. **Confirmación** (`/analisis/confirmar`): resumen de objetivo, indicadores, gráficos, datos, limitaciones y viabilidad. Solo con aprobación explícita se crea el **plan aprobado** y se ejecuta el análisis.
5. **Workspace** (`/proyectos/:id`): indicadores, gráficos, hallazgos con nivel de evidencia, panel del asistente, dataset y exportación.

### Revisión obligatoria de datos y privacidad

```
sources[] (perfiles, intactos) ──► ReviewPage
                                    ├─ ColumnInterpretationReview (por fuente): formato · significado · marcadores
                                    └─ AIContextReview (controlado): columnas a compartir · nombre para la IA · objetivo · JSON
                                          │
                     session.review = { objective, sources: SourceReview[] }   ← decisiones del usuario
                     session.reviewConfirmed = true  (cualquier cambio posterior lo vuelve a false)
                                          │
                                 createProject ──► asistente (exige reviewConfirmed)
```

- Las decisiones (`ColumnReview.format`, `semanticType`, `markers`, `include`, `name`) se guardan aparte: **no** modifican archivos, perfiles ni valores. Las aplicará Pandas, sobre copias, en las fases siguientes.
- El contexto para la IA incorpora las correcciones (`user_corrected`, `missing_markers`) y sigue pasando por la lista blanca del backend; confirmar la revisión **no** autoriza envíos: cada mensaje a la IA real requerirá su propia autorización.
- Cambiar las fuentes o editar la revisión después de confirmarla invalida la confirmación y el proyecto preparado.
- **Una sola pantalla de configuración:** los datos se configuran solo en el paso 2. El asistente muestra `DataReviewSummary` (estado, fuentes y columnas autorizadas) y `MessageAuthorization` (autorización de cada mensaje, solo con backend). Ambos flujos de autorización usan `hooks/useAIAuthorization.ts`.

| Acción | Qué autoriza | Qué NO autoriza |
|--------|--------------|-----------------|
| **A. Confirmar la revisión** (paso 2) | Continuar al asistente con esa configuración de datos | Ninguna transmisión a OpenAI |
| **B. Autorizar un envío** (paso 3, por mensaje) | Enviar **ese** mensaje con **ese** contexto, una vez, durante 5 minutos | Mensajes siguientes, ni el mismo mensaje modificado |

- **Navegación:** `lib/wizardSteps.ts` define los requisitos de cada paso. El encabezado enlaza solo los pasos alcanzados; volver atrás conserva todo el estado, y avanzar (también escribiendo la URL) exige los requisitos. Salir de la revisión cancela cualquier solicitud de IA preparada.

**Fundamento académico.**

- **Calidad de datos:** un análisis es tan bueno como la interpretación de sus variables. Confirmar que `codigo` es un identificador y no una cantidad, o que un `NA` es un valor válido, evita sumar códigos o perder registros antes de calcular.
- **Supervisión humana:** el perfilador propone y la persona decide. Las sugerencias se aceptan por defecto y solo se corrige lo necesario, para que la revisión no se convierta en un formulario interminable.
- **Minimización de información:** en el mismo paso se elige qué columnas conocerá la IA y con qué nombre, y se ve el JSON exacto. La revisión ocurre **antes** de cualquier conversación, no después.
- **Separación entre formato y significado:** el formato físico (entero, decimal, texto, fecha, sí/no) y el significado estadístico (cuantitativa, categórica, código, temporal, texto libre) se revisan por separado. Un código puede tener formato numérico y significado de identificador.

La regla central: **sin plan aprobado no hay resultados** (lo controlan el proveedor y el `WorkspaceLayout`).

## Frontend (`frontend/src`)

| Carpeta | Responsabilidad |
|---------|-----------------|
| `types/` | Tipos de dominio (`domain.ts`): el contrato compartido con el backend. |
| `services/` | `types.ts` (interfaz `DataDecisionService`), `httpClient.ts`, `httpProvider.ts`, `demoProvider.ts`, `errors.ts`, `index.ts` (elige proveedor). |
| `mocks/` | Datos **ficticios** y guion determinista del asistente DEMO. Solo los usa `demoProvider.ts`. |
| `lib/` | Utilidades puras: configuración, CSV local, validación de archivos, formatos, exportación. |
| `context/` | Proveedores de React: servicio inyectable y sesión del asistente (solo en memoria). |
| `hooks/` | `useService`, `useAsync`, `useConversation`, `useWorkspace`, `useAnalysisSession`. |
| `components/` | UI reutilizable (`ui/`), chat, carga, gráficos (Recharts) y workspace. |
| `layouts/` | Público, asistente por pasos y workspace con sidebar. |
| `pages/` | Pantallas. No hacen `fetch` ni importan mocks. |

Decisiones:

- **Separación estricta**: los componentes solo hablan con `DataDecisionService`. Cambiar de DEMO a FastAPI es cambiar una variable de entorno.
- **Sin columnas fijas**: `DatasetProfile.columns`, `previewRows` y `Chart` (`xKey`, `series`, `data`) son genéricos.
- **Honestidad de datos**: todo lo simulado lleva `isDemo` y se marca visualmente. En DEMO, un archivo propio nunca recibe resultados inventados (`status: "pending_backend"`).
- **Sin persistencia en el navegador**: nada se guarda en `localStorage`; los archivos no salen de la memoria.
- **Exportación**: un único método `exportAnalysis(projectId, request)` con `format: pdf | xlsx | docx | canva`.

## Backend (`backend/app`)

| Carpeta | Responsabilidad |
|---------|-----------------|
| `main.py` | Crea la app, CORS de desarrollo, registra routers bajo `/api`. |
| `core/` | `config.py` con `pydantic-settings` (lee `.env`). |
| `api/` | Routers HTTP, sin lógica de negocio. Hoy: `routes/health.py` y `routes/datasets.py`. |
| `schemas/` | Modelos Pydantic de entrada/salida (camelCase, iguales a `domain.ts`). |
| `services/` | Lógica: lectura y perfilado con Pandas (`dataset_profiler.py`, `column_semantics.py`), IA 1, IA 2, cálculos, exportaciones. |
| `models/` | Tablas SQLAlchemy (proyectos, datasets, mensajes, propuestas, planes, resultados). |
| `db/` | Motor y sesión de base de datos. |

Principios para crecer:

- La API key de OpenAI vive solo en `backend/.env`.
- Los números siempre salen de Pandas; la IA interpreta y redacta, y su salida se valida contra los datos.
- La IA recibe el **perfil** y resúmenes agregados, no el archivo completo.

## Calidad de datos y tipos semánticos

```
Archivo ──► dataset_profiler.py (lectura como texto, límites)
                 │ por columna
                 ▼
            column_semantics.py ──► faltantes (solo vacíos) + marcadores sospechosos
                 │                  formato (sobre todos los valores)
                 │                  tipo semántico + confianza + motivo
                 ▼
            JSON ──► backendProfile.ts ──► DatasetProfile ──► UI (completitud, interpretación, advertencias)
                                                         └──► asistente DEMO (no suma códigos ni años)
```

- **Fuente autorizada:** las cifras de calidad y la interpretación de columnas las calcula Pandas sobre el archivo completo; el frontend las muestra y no las recalcula (`lib/profileMetrics.ts` centraliza el criterio).
- **Separación de conceptos:** `inferredType` (formato) y `semanticType` (rol estadístico) son campos distintos; el segundo siempre viaja con `semanticConfidence` y `semanticReason`.
- **Política compartida de faltantes:** la lista de marcadores existe en Python y en TypeScript (vista previa local); una prueba verifica que sean iguales.
- **Compatibilidad:** los campos nuevos son opcionales en el adaptador.

## Varias fuentes por análisis (Fase 3A)

```
Archivo A ─┐                                   ┌─► perfil A ─┐
Archivo B ─┼─► de a uno ─► POST /api/datasets/profile ─► perfil B ─┼─► sesión: sources[] (máx. 3) ─► catálogo (esquemas, sin valores)
Archivo C ─┘   (mismo endpoint)                 └─► perfil C ─┘                │
                                                                                └─► createProject({ datasetId, datasetIds })
```

- Cada archivo es una **fuente independiente**; el backend no cambió y no hay estado compartido entre perfiles.
- La sesión guarda `sources[]`; `dataset`/`profile` siguen existiendo como la fuente principal (la primera), por compatibilidad con las pantallas de una sola fuente.
- `lib/datasetCatalog.ts` arma el catálogo: alias A/B/C, conteos, formato e interpretación de columnas, faltantes y pistas de relación (mismo nombre normalizado, misma estructura). No incluye ejemplos ni filas.
- Límites: 3 archivos, 25 MB por archivo, 60 MB entre todos, perfilado secuencial, sin persistencia.
- **No hay uniones, concatenaciones ni transformaciones.**

### Operaciones previstas para IA 1 (no implementadas)

| Operación que podrá proponer IA 1 | Ejemplo | Validaciones previas obligatorias |
|-----------------------------------|---------|-----------------------------------|
| Analizar una fuente individualmente | Evolución mensual en `importaciones.csv` | Las de la Fase 2 (tipos, marcadores) confirmadas por el usuario |
| Comparar fuentes independientes | Indicadores de 2024 frente a 2025, cada uno calculado por separado | Que las métricas sean comparables (mismas unidades y definiciones) |
| Concatenar tablas compatibles | Apilar `ventas_2024.csv` y `ventas_2025.csv` | Mismas columnas y tipos; columna que identifique el origen; duplicados entre fuentes |
| Relacionar tablas mediante claves confirmadas | Unir importaciones con un maestro de países por `PAIS` | Clave confirmada por el usuario; unicidad de la clave en la tabla maestra; granularidad de cada tabla; cardinalidad (1:1, 1:N, N:M); conteo de filas antes y después para detectar multiplicación de registros; claves sin correspondencia |

Ninguna operación se ejecuta sin un **plan aprobado por el usuario**. Las validaciones las hace Pandas, no la IA, y el resultado se aplica sobre copias en memoria: los archivos originales no se modifican.

## Principio arquitectónico central

**DataDecision AI separa el procesamiento estadístico de la inteligencia artificial.**

- **Python y Pandas** realizan los cálculos y el procesamiento verificable.
- **La futura IA** interpreta objetivos, formula preguntas y propone planes de análisis.
- **El usuario** confirma las decisiones relevantes.
- Las operaciones se ejecutarán mediante **mecanismos estructurados y validados** (un catálogo cerrado de operaciones), no mediante la ejecución arbitraria de código generado por IA.
- Los **archivos originales no se modifican** automáticamente.
- La transmisión a servicios externos debe estar restringida por **minimización de datos y autorización explícita**.

> La política de transmisión hacia OpenAI es un **requisito de arquitectura pendiente de implementación y verificación**, no una capacidad terminada.

## Límites del MVP y escalabilidad

| Límite inicial | Valor |
|----------------|-------|
| Datasets por análisis | 3 |
| Tamaño por archivo | 25 MB |
| Tamaño combinado | 60 MB |
| Celdas por archivo para el perfilado | 5.000.000 (además de 250.000 filas y 250 columnas) |
| Motor de procesamiento | Python y Pandas, en el equipo o servidor propio |

**Justificación.** Estos límites permiten controlar recursos, realizar pruebas reproducibles, mantener una complejidad razonable y terminar el proyecto dentro del alcance académico. La arquitectura separa la carga y administración de fuentes, el perfilado, el procesamiento estadístico y la interfaz; esa separación **facilita** futuras ampliaciones, pero **no garantiza escalabilidad ilimitada**. Ampliar las capacidades requeriría nuevas pruebas de rendimiento, memoria y concurrencia y, según el volumen, otras estrategias de procesamiento. **El límite de tres fuentes es una decisión de alcance y de seguridad operativa del MVP, no una incapacidad conceptual** para trabajar con más datasets.

## Frontera de datos para la IA (Fase 3B.1) y conexión con OpenAI (Fase 3B.2)

**Decisión central: Python/Pandas calcula; OpenAI interpretará objetivos y propondrá planes; el usuario confirma.**

```
Navegador (React)                              FastAPI (backend local)                      OpenAI
─────────────────                              ───────────────────────                      ──────
Catálogo de fuentes (sin valores)
  └─ buildAIContext: alias A/B/C, columnas
     revisadas, formato e interpretación,
     objetivo editado, rango de tamaño opcional
  └─ Panel "Revisá qué se compartiría":
     ocultar / renombrar columnas, ver el JSON
        │  POST /api/ai/requests                 Lista blanca Pydantic (extra="forbid")
        └──────────────────────────────────────► rechaza archivos, filas, ejemplos,
                                                 nombres de archivo, estadísticas (422)
        ◄────────────── contenido validado + huella SHA-256 + vence en 5 min
  └─ El usuario revisa y pulsa "Autorizar"
        │  POST /api/ai/requests/{id}/authorize  AI_ENABLED=false → 403, se descarta
        └──────────────────────────────────────► huella distinta → 409; vencida → 410
                                                 uso único (consumida)
                                                 sin clave → 503; sin presupuesto → 402
                                                 reserva el costo máximo estimado ──────────► Responses API
                                                 valida la respuesta (alias, columnas,       (salida estructurada,
                                                 catálogo de operaciones) y guarda planes ◄── sin reintentos)
        ◄────────────── preguntas + planes validados + consumo real
  └─ El usuario aprueba un plan (no se ejecuta nada todavía)
```

En la **demo pública** no existe el cliente de la frontera (`createDefaultAIGateway()` devuelve `null`): el panel solo muestra qué se enviaría.

Archivos: `backend/app/schemas/ai_context.py` (contrato), `backend/app/services/ai_gateway.py` (autorización de uso único y proveedor), `backend/app/api/routes/ai.py` (endpoints), `frontend/src/lib/aiContext.ts` (contexto mínimo), `frontend/src/services/aiGateway.ts` (cliente) y `frontend/src/components/ai/AIContextReview.tsx` (revisión).

**Dónde llega el JSON.** El contexto revisado viaja al backend FastAPI local para validarse. Solo sale hacia OpenAI cuando el usuario autoriza **ese** mensaje, con la IA habilitada, la clave configurada y presupuesto disponible.

**Fase 3B.2 (implementada, probada con proveedores falsos):**
- **Backend:**
  - `app/services/openai_provider.py`: Responses API, `max_retries=0`, `store=False` y traducción de errores.
  - `app/services/ai_budget.py`: estimación, reserva, consumo real y presupuesto persistente.
  - `app/schemas/ai_plan.py`: esquema de la respuesta y validación contra el contexto autorizado.
- **Asistente en modo IA real** (`AssistantPage`):
  - el resumen del objetivo confirmado y «Comenzar conversación»;
  - el panel `AuthorizedSend` (contenido, costo estimado y «Autorizar y enviar»);
  - `AIReplyCard` (preguntas, planes por fuente y «Aprobar este plan»);
  - la conversación en la sesión del análisis (`aiChat`), que se reinicia si cambian las fuentes o la revisión.
- **Modos:** sin IA habilitada sigue el asistente DEMO, más la prueba de autorización si hay backend. La demo pública no tiene cliente de IA.

Controles y límites en [SEGURIDAD.md](SEGURIDAD.md), sección 10.

**Planes y autorizaciones (fuente única: la sesión del análisis).**
- `aiChat`: los turnos con las respuestas validadas.
- `approvedPlanIds`: los planes aprobados, en orden.
- `confirmedPlanIds`: los planes confirmados en el paso 4.
- `aiConversationGrant`: el permiso de la conversación.
- `lib/aiPlans.ts` deriva de estos datos lo que muestran el asistente y «Confirmar».
- Los planes también quedan registrados en el backend (memoria del proceso), que es quien aprueba.

**Autorización por conversación.**
- `POST /api/ai/requests/{id}/authorize` con `scope: "conversation"` devuelve un `conversation_id`.
- Los mensajes siguientes van por `POST /api/ai/conversations/{id}/messages`. El backend comprueba el permiso (vencimiento, tope de mensajes, huella de la frontera de privacidad, sin envíos simultáneos) y aplica los mismos límites que un envío individual.
- `DELETE /api/ai/conversations/{id}` lo revoca.

| Concepto | Qué significa | Qué NO hace |
|----------|---------------|-------------|
| **Autorización de un mensaje** | Ese envío a OpenAI, con el contenido exacto revisado, una vez | No autoriza los mensajes siguientes |
| **Autorización de la conversación** | Los próximos mensajes que el usuario envíe voluntariamente en esta conversación van a OpenAI sin volver a mostrar el panel. Cada envío comparte el mensaje, un historial limitado (hasta 8 turnos), el objetivo y los metadatos ya autorizados | No es permanente: vence (30 min), tiene tope de mensajes (20), se anula si cambia la configuración de datos y se puede revocar. No saltea ningún límite de consumo ni hace llamadas automáticas |
| **Aprobación de un plan** (asistente) | El usuario elige un plan validado; el backend lo registra | No consulta a la IA ni calcula nada |
| **Confirmación de la propuesta** (paso 4) | El usuario confirma los planes aprobados para la etapa siguiente | No ejecuta cálculos |
| **Ejecución de cálculos** (próxima etapa) | Pandas calculará los planes confirmados | — Todavía no implementada |

Auditoría y justificación de cada campo en [SEGURIDAD.md](SEGURIDAD.md), sección 6.

## Minimización de datos (decisión de diseño, pendiente de implementación)

```
Dataset ──► Python + Pandas (navegador, backend local o interno)
                 │  procesa todo el archivo
                 ▼
          Resumen mínimo ──► ¿puede ser confidencial? ──sí──► autorización explícita
          (columnas, tipos,                 │no                      │
           conteos, agregados)              ▼                        ▼
                                         OpenAI ◄────────────────────┘
                                           │
                                           ▼
                          Plan de análisis estructurado (catálogo cerrado)
                                           │
                                           ▼
                          Pandas valida y ejecuta ──► resultados
```

- OpenAI recibe solo la información **mínima, necesaria y autorizada** para comprender objetivos, planificar análisis o interpretar resultados.
- **No se envían por defecto** el archivo completo, las filas originales, los valores de ejemplo (`examples`) ni las vistas previas (`preview`).
- Si lo que se pretende enviar puede ser confidencial, se requiere **autorización explícita**.
- La IA propone **planes estructurados**; no modifica el código fuente del backend ni se ejecuta código generado por ella.
- **Estado:** política decidida; su implementación y validación están pendientes (ver [SEGURIDAD.md](SEGURIDAD.md)).


## Motor de análisis con Pandas (Fase 4A)

**Principio: Pandas calcula, la IA interpreta y propone, el usuario confirma.** La IA nunca genera ni ejecuta código: propone planes con operaciones de un catálogo cerrado, y el backend los resuelve con funciones de Python escritas a mano.

### Dónde está el código

| Archivo | Qué hace |
|---------|----------|
| `backend/app/services/analysis_engine.py` | **El motor.** Lee los archivos, valida cada plan y cada operación, y calcula con Pandas |
| `backend/app/schemas/analysis.py` | Contratos del pedido (planes y correspondencia de columnas) y de la respuesta (tablas de resultados) |
| `backend/app/api/routes/analysis.py` | Endpoint `POST /api/analysis/execute`: recibe los archivos, verifica que los planes estén aprobados y llama al motor |
| `backend/app/services/dataset_profiler.py` → `read_dataset` | Lectura de CSV/XLSX con los mismos controles de tamaño y forma que el perfilado (la comparten ambos) |
| `frontend/src/lib/analysisRequest.ts` | Arma el pedido desde la revisión: nombre visto por la IA → columna real, interpretación, decisión sobre faltantes y unidad |
| `frontend/src/services/analysisEngine.ts` | Cliente HTTP del motor (separado del cliente de la IA) |
| `frontend/src/components/analysis/AnalysisExecution.tsx` y `AnalysisResults.tsx` | Botón «Ejecutar análisis», unidades opcionales y tablas de resultados en el paso «Confirmar» |

### Qué función hace cada cálculo (`analysis_engine.py`)

| Operación del plan | Función | Cálculo con Pandas |
|--------------------|---------|--------------------|
| `count` | `op_count` | Cantidad de filas, total o por grupo (`groupby(...).agg("count")`) |
| `sum`, `mean`, `median`, `min`, `max` | `_simple_aggregate(...)` | La agregación indicada sobre columnas cuantitativas, total (`DataFrame.agg`) o por grupo (`groupby(...).agg`) |
| `group_by` | `op_group_by` | Suma de las columnas cuantitativas por categoría (o conteo si no hay cuantitativas) |
| `compare_groups` | `op_compare_groups` | Lo mismo que `group_by`, más la participación de cada grupo sobre el total (%) |
| `time_series` | `op_time_series` | Suma por período (mes `AAAA-MM`, o año si las fechas abarcan más de 36 meses), en orden cronológico |
| `frequency` | `op_frequency` | Cantidad de registros por valor (o combinación de valores) |
| `distinct_count` | `op_distinct_count` | Valores distintos por columna (`Series.nunique`) |
| `std`, `percentage`, `top_n`, `correlation`, `missing_summary` | — | **No disponibles todavía:** se informa el motivo y no se reemplazan por otro cálculo |

Funciones auxiliares:
- `_grouped`: agregación genérica. Arma un DataFrame con las claves de grupo (`g:...`) y los valores (`v:...`), y aplica `groupby(...).agg(...)`.
- `PreparedSource.texts`: aplica la política de faltantes.
- `PreparedSource.numbers`: convierte a números con `to_numbers` y `parse_number`, y valida la interpretación.
- `PreparedSource.group_keys`: arma las etiquetas de grupo y los períodos, con `to_dates`, que usa `pd.to_datetime` con formato explícito.
- `run_plan` y `run_operation`: validan y ejecutan.

### Cómo llegan los datos desde React a FastAPI

1. **Carga (paso 1):** el navegador envía cada archivo a `POST /api/datasets/profile`. El backend devuelve el **perfil** y descarta el archivo. El navegador conserva el `File` original **solo en memoria** (`AnalysisSource.file`), no en disco ni en `localStorage`.
2. **Revisión (paso 2):** el usuario decide qué columnas compartir con la IA, sus nombres, sus interpretaciones y qué hacer con marcadores como `NA`.
3. **Conversación (paso 3):** la IA recibe solo metadatos y propone planes. El backend los valida y los guarda; el usuario aprueba uno.
4. **Confirmar (paso 4):** después de la confirmación final aparece «Ejecutar análisis». Al pulsarlo, React envía un único `multipart/form-data` a `POST /api/analysis/execute` con:
   - `request`: JSON con los `plan_ids` y, por fuente, la correspondencia `name` (nombre que vio la IA) → `original` (columna real), la interpretación, la decisión sobre faltantes y la unidad opcional;
   - `file_A`, `file_B`, `file_C`: los archivos originales de las fuentes que usan los planes.
5. El backend calcula en memoria y responde con tablas (dimensiones + medidas). Los archivos se descartan al terminar el pedido.

**El perfil no son los datos.** El perfil (paso 1) resume las columnas y no alcanza para calcular. Por eso el archivo completo se reenvía al ejecutar.

### Cómo se valida y se ejecuta un plan

1. **Pedido:** la lista blanca Pydantic (`ExecutionRequest`, `extra="forbid"`) admite hasta 6 planes y 3 fuentes, sin repetidos.
2. **Planes del backend, no del navegador** (`approved_plans`): cada `plan_id` debe existir en el registro del backend (404 si no) y estar **aprobado** (409 si no). Así se ejecuta exactamente el plan validado, aunque el navegador mande otra cosa.
3. **Archivos:** debe estar el archivo de cada fuente que usan los planes (422 si falta). Se aplican los límites existentes: `Origin` autorizado, 25 MB por archivo, 60 MB por pedido, filas, columnas, celdas y descompresión de XLSX. Hay una sola ejecución simultánea (429 si ya hay otra).
4. **Fuente** (`prepare_source`): las columnas reales indicadas deben existir en el archivo. Si no existen, se cargó otro archivo y se responde 422.
5. **Plan** (`run_plan`): todas sus columnas deben seguir autorizadas en la revisión. Cada plan usa **una sola fuente**: nunca se unen, concatenan ni relacionan archivos.
6. **Operación** (`run_operation`):
   - la operación tiene que estar en el catálogo;
   - las columnas tienen que existir;
   - los tipos tienen que ser compatibles con la interpretación de la revisión: sumar o promediar exige una columna cuantitativa, un código o identificador no se suma, y una serie temporal exige una columna temporal.

   Si algo falla, esa operación devuelve un error comprensible y las demás siguen. El plan queda como "parcial".
7. **Faltantes:** la celda vacía siempre es faltante. Los marcadores como `NA` cuentan como faltantes solo si el usuario eligió «Tratar como faltante». Si no, quedan como valores; en una columna numérica no se pueden convertir, se excluyen y se avisa.

### Qué se usa de Pandas y por qué

| Herramienta | Uso | Por qué |
|-------------|-----|---------|
| `read_csv(dtype=str, keep_default_na=False)` / `ExcelFile.parse(dtype=str)` | Leer todo como texto | No transforma `00123` en `123` ni `NA` en faltante sin decisión del usuario |
| `Series.mask`, `str.strip`, `isin` | Marcar faltantes | Aplica la política de faltantes de forma vectorizada |
| `Series.map` sobre valores únicos | Convertir números | Cada valor distinto se convierte una sola vez (rápido en archivos grandes) y acepta formatos como `15.000` o `1.234,56` |
| `pd.to_datetime(format=...)` | Fechas | Un formato explícito evita interpretaciones ambiguas (día/mes); se elige el que interpreta más valores |
| `Series.dt.strftime("%Y-%m")` | Períodos | Agrupar por mes o año con etiquetas legibles |
| `DataFrame.groupby(...).agg(...)` | Agrupar y agregar | La operación central del análisis descriptivo: dividir, aplicar y combinar |
| `DataFrame.agg`, `Series.nunique` | Totales y distintos | Agregaciones sin grupos |

### Limitaciones del MVP

- **Datos en memoria:** los archivos se guardan solo en la memoria del navegador. Si se recarga la página, hay que volver a cargarlos. Los planes aprobados viven en la memoria del backend y se pierden si se reinicia.
- **Catálogo acotado:** no están disponibles desvío estándar, porcentajes generales, rankings, correlaciones ni resumen de faltantes.
- **Agregación fija:** las series temporales y las agrupaciones usan **suma**, porque cada fila es un total. Para otro criterio, el plan debe pedir `mean`, `min` o `max` con `group_by`.
- **Período automático:** las series son mensuales, o anuales si las fechas abarcan más de 36 meses. Todavía no se puede elegir el período.
- **Números ambiguos:** `15.000` se interpreta como quince mil (separador de miles), porque es la convención local.
- **Unidades:** solo las que indica el usuario. El motor no las convierte ni las deduce.
- **Gráficos y PDF:** los resultados ya incluyen los gráficos sugeridos por el plan aprobado, pero todavía se muestran como tablas. Los gráficos y el PDF quedan para la etapa siguiente.


## Dashboard de resultados reales (Fase 4B)

**La IA propone, Pandas calcula, React visualiza.** El dashboard no calcula ni consulta a la IA: transforma el JSON del motor en indicadores, gráficos y tablas.

### Qué componente recibe los resultados de Pandas

```
POST /api/analysis/execute ──► ExecutionResponse (JSON del motor)
        │
        ▼
AnalysisExecution.tsx      guarda la respuesta en la sesión (analysisRun) y, al terminar, lleva la vista al dashboard
        │
        ▼
AnalysisResults.tsx        llama a buildDashboard(run) y dibuja una sección por fuente
        │
        ▼
lib/dashboard.ts           funciones puras: resultados → KPI, gráficos (formato Chart de Recharts), avisos y tablas
        │
        ▼
ChartCard.tsx (Recharts)   gráfico con tooltip, leyenda, títulos de ejes y unidad, más vista de tabla con los valores exactos
```

### Cómo se transforman en datos de Recharts (`lib/dashboard.ts`)

El motor devuelve cada operación como una tabla: `dimensions` (por ejemplo, `["fecha", "sector"]`), `measures` (por ejemplo, suma de `ventas` en ARS) y `rows` (`keys` + `values`). Recharts necesita una lista de objetos con una clave para el eje X y una por serie.

- **Una dimensión** (`operationCharts`): cada fila del motor es un punto, por ejemplo `{ x: "2026-01", s0: 23000 }`. Cada medida es una serie (`s0`, `s1`…).
- **Dos dimensiones:** la segunda se **pivota** como series. `["2026-01","Tecnologia"] → 15000` y `["2026-01","Indumentaria"] → 8000` pasan a ser `{ x: "2026-01", s0: 8000, s1: 15000 }`, con una serie por sector.
  - Cada celda es **exactamente** un valor del motor, buscado por sus dos claves: no se suma ni se repite nada.
  - Las pruebas verifican que la suma de las series de cada mes coincide con el total mensual del motor (23.000, 27.500, 32.000) y que cada serie suma su total por sector (54.000 y 28.500).
- **Sin dimensiones:** el valor único es un **indicador** (`kpisFor`), por ejemplo 82.500 ARS.
- **Unidades:**
  - las medidas se agrupan por unidad (`measuresByUnit`): nunca se mezclan, por ejemplo, ARS y kg en un mismo eje;
  - la unidad aparece en el título del eje Y, en los tooltips y en la tabla del gráfico;
  - la participación (`share_pct`) se ve en la tabla y en la torta, no como otra serie.
- **Sin animación:** los gráficos de resultados se dibujan completos de inmediato (`animated: false`), así ningún valor queda a medio trazar; también servirá para la exportación en la Fase 4C.

### Cómo se eligen las visualizaciones

1. **Primero, los gráficos que pidió el plan aprobado** (`plan.charts`). Para cada uno se busca una operación calculada con los mismos ejes (`matches`) y se comprueba si el tipo es compatible (`incompatibility`):
   - **líneas:** requiere una dimensión temporal (mes o año);
   - **barras:** una o dos dimensiones;
   - **torta:** una sola dimensión, de 2 a 6 grupos, valores no negativos con total positivo, y no promedios ni medianas (no son partes de un total);
   - **indicador:** un único valor;
   - **dispersión, caja e histograma:** necesitan los datos fila a fila, y el motor devuelve resultados agregados, así que **no se construyen**.

   Si un gráfico pedido no se puede construir, se muestra un aviso en «Gráficos no generados» con el motivo. **No se fabrica otro gráfico en su lugar**: la operación solo conserva su visualización estándar, y el aviso lo dice.
2. **Después, las demás operaciones con resultados** (`autoType`):
   - temporal → líneas;
   - categórica → barras;
   - más de dos dimensiones → solo tabla.

   Se genera **un gráfico por operación**, no todos los tipos.
3. **Límites de legibilidad:** con más de 30 categorías en barras o más de 6 series, se muestra solo la tabla, con una explicación.
4. **Errores y estados:**
   - las operaciones que fallaron se listan con su motivo;
   - un plan sin resultados muestra un aviso, sin gráficos ni indicadores;
   - si ningún plan tiene resultados, aparece "Sin resultados para mostrar";
   - mientras se calcula, se ve "Calculando con Pandas…".

### Varias fuentes

`buildDashboard` agrupa los planes por `source_alias`. Hay **una sección por fuente** ("Fuente A · ventas.csv · 6 filas"), con sus propios indicadores, gráficos y tablas. Nunca se combinan cifras de fuentes distintas.

### Demo pública

La demo usa sus propios resultados de ejemplo, marcados como ficticios (franja "Demo pública"), y no tiene motor ni dashboard de resultados reales. En el modo local no se usa ningún número de demostración: todo sale del motor.

### Limitaciones

- Gráficos que necesitan datos fila a fila (dispersión, caja, histograma) no disponibles: el motor solo devuelve agregados.
- No se puede elegir el período (mes o año) ni filtrar desde el dashboard.
- Torta solo si el plan la pide y las proporciones son válidas.
- Los resultados viven en la sesión: se pierden al recargar.
- Exportación a PDF: Fase 4C.


## Modo real sin respuestas simuladas y catálogo único (Fase 4B.1)

### Dos modos, sin mezcla

| Modo | Cuándo | Asistente | Datos y resultados |
|------|--------|-----------|--------------------|
| **Demo pública** | Sin backend (`createDefaultAIGateway()` devuelve `null`) | Guion fijo, identificado como simulado | Dataset de ejemplo y resultados ficticios, con la franja "Demo pública" |
| **Real** | Con backend (local o privado) | **Solo OpenAI real.** Si no está disponible, se muestra el motivo y el chat queda deshabilitado | Archivos del usuario, Pandas y dashboard real. Sin dataset de ejemplo ni propuesta simulada |

En modo real (`AssistantPage`):
- **Sin asistente DEMO:** el hook `useConversation` ni se consulta, porque recibe `null`.
- **Antes de habilitar el chat:** se consulta `/api/ai/status`. Mientras tanto se muestra «Comprobando la conexión con la IA…».
- **Si la IA no está disponible** (`describeAIProblem`), se explica el motivo:
  - backend inaccesible;
  - `AI_ENABLED=false`;
  - falta `OPENAI_API_KEY`;
  - sin proveedor.

  Hay un botón «Reintentar», «Comenzar conversación» y el chat quedan deshabilitados, y no aparece ninguna respuesta simulada.
- **Lo que se quitó:** la "prueba de autorización" con la IA deshabilitada (Fase 3B.1), que convivía con el asistente DEMO.

`ConfirmPage` en modo real siempre muestra los planes de la IA real, aunque no haya ninguno, nunca la propuesta del servicio DEMO. `UploadPage` no ofrece el dataset de ejemplo cuando hay backend.

### Catálogo único de operaciones y gráficos

`backend/app/schemas/ai_plan.py` define `OPERATION_GUIDE` y `CHART_GUIDE`: qué hace cada operación y cada gráfico. De ahí salen:
- los tipos que acepta la respuesta estructurada de la IA (`Operation` y `ChartType`): la IA **no puede** proponer otra cosa;
- la lista que reciben las instrucciones de la IA (`openai_provider.py`, `_build_instructions`);
- una prueba que verifica que el motor (`OPERATIONS` en `analysis_engine.py`) implemente exactamente esas operaciones.

Se quitaron del catálogo las operaciones que el motor no ejecuta (desvío estándar, porcentaje, ranking, correlación, resumen de faltantes). También los gráficos que el dashboard no construye (dispersión, caja, histograma); se volverán a agregar cuando el motor los calcule.

### Instrucciones de la IA

Las instrucciones piden:
1. Partir de la pregunta concreta: qué medir, en qué grupos y en qué período.
2. Proponer pocas operaciones que la respondan, sin análisis genéricos.
3. Ajustar el plan anterior en lugar de repetirlo, para lo cual el historial incluye las operaciones de cada plan.
4. Si falta una columna, se necesita un modelo entrenado, otra técnica o unir fuentes: **no** proponer un plan aproximado, sino explicar y pedir lo que falta.
5. Preguntar ante ambigüedades que cambian el resultado.
6. Respetar los tipos: no sumar códigos ni agrupar por columnas casi únicas.

### Metadato aproximado nuevo

`distinct_values` es la cantidad de valores distintos de cada columna, por rango: `1`, `2`, `3-10`, `11-50`, `51-500` o `>500`. Se calcula en el navegador desde el perfil (`distinctRange`) y aparece en el JSON de la revisión de privacidad. Nunca incluye la cantidad exacta ni los valores. Le permite a la IA distinguir columnas binarias y categorías chicas de columnas casi únicas.
