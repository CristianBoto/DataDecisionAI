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

- `services/index.ts` crea solo el proveedor DEMO; el cliente HTTP no se instancia.
- El estado vive en memoria y desaparece al recargar.
- Los resultados son del dataset ficticio de ejemplo y se marcan como DEMO. Con un archivo propio se muestra "pendiente de backend".
- Cloudflare Pages resuelve las rutas de React Router devolviendo `index.html` (SPA, sin `404.html`).

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
- Hoy el backend solo expone `/api/health`. Los controles de seguridad necesarios para datos confidenciales (autenticación, HTTPS, cifrado, auditoría, retención) están **pendientes**: ver [DEPLOYMENT.md](DEPLOYMENT.md).

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
| `api/` | Routers HTTP, sin lógica de negocio. Hoy: `routes/health.py`. |
| `schemas/` | Modelos Pydantic de entrada/salida (camelCase, iguales a `domain.ts`). |
| `services/` | Lógica: lectura y perfilado con Pandas, IA 1, IA 2, cálculos, exportaciones. |
| `models/` | Tablas SQLAlchemy (proyectos, datasets, mensajes, propuestas, planes, resultados). |
| `db/` | Motor y sesión de base de datos. |

Principios para crecer:

- La API key de OpenAI vive solo en `backend/.env`.
- Los números siempre salen de Pandas; la IA interpreta y redacta, y su salida se valida contra los datos.
- La IA recibe el **perfil** y resúmenes agregados, no el archivo completo.
