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
- `backendProfile.ts` adapta la respuesta snake_case de Python a `DatasetProfile` (`origin: "backend"`).
- Si el backend falla, `uploadDataset` rechaza con el error: no hay respaldo silencioso con datos locales o ficticios.
- El servicio expone `profiling: "browser" | "backend"` para que la pantalla de carga muestre el aviso correcto.

### Instalación privada (frontend + backend en la organización)

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

1. **Carga** (`/analisis/cargar`): validación preliminar (extensión, tamaño). Para CSV se calcula una vista previa local real; para Excel se espera al backend.
2. **Asistente** (`/analisis/asistente`): IA 1 conversa, detecta información faltante y genera una **propuesta** versionada.
3. **Confirmación** (`/analisis/confirmar`): resumen de objetivo, indicadores, gráficos, datos, limitaciones y viabilidad. Solo con aprobación explícita se crea el **plan aprobado** y se ejecuta el análisis.
4. **Workspace** (`/proyectos/:id`): indicadores, gráficos, hallazgos con nivel de evidencia, panel del asistente, dataset y exportación.

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

## Frontera de datos para la futura IA (diseño, no implementado)

```
Navegador ──(nunca llama a OpenAI)──► FastAPI
                                         │ AI_ENABLED=false por defecto
                                         ▼
                         Contenido armado en el backend desde una lista blanca
                         (alias A/B/C, tipos, conteos redondeados; sin ejemplos ni filas)
                                         │
                         Vista previa exacta del envío ──► autorización del usuario (por envío)
                                         │
                                         ▼
                                      OpenAI ──► plan estructurado (catálogo cerrado) ──► validación ──► Pandas
```

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
