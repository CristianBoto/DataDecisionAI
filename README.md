# DataDecision AI

Plataforma web para cargar datasets CSV o Excel, explicar en lenguaje común qué se necesita decidir y obtener indicadores, gráficos y recomendaciones basadas en datos.

Proyecto final de **Prácticas Profesionalizantes — Tecnicatura en Ciencia de Datos**.

> **Demo pública:** https://datadecisionai.pages.dev (Cloudflare Pages)
> La demo usa datos ficticios y no requiere backend. No cargues datos confidenciales en ella.

**MVP académico con arquitectura preparada para crecer.** Esta versión prioriza un recorrido completo, verificable y honesto: lo simulado se marca como DEMO y las piezas reales se integran de a una (hoy, el perfilado de datos con Pandas). La separación entre interfaz, servicios y backend permite sumar persistencia, IA y exportaciones sin reescribir la aplicación.

### Documentación del proyecto

| Documento | Contenido |
|-----------|-----------|
| [Bitácora de desarrollo](docs/BITACORA_DESARROLLO.md) | Idea, decisiones, stack, problemas y aprendizajes (base de la exposición final) |
| [Pruebas y validaciones](docs/PRUEBAS_Y_VALIDACIONES.md) | Pruebas verificadas y comunicadas, resultados y pendientes |
| [Seguridad y privacidad](docs/SEGURIDAD.md) | Protecciones existentes, procesamiento local, OpenAI/Ollama y controles faltantes |
| [Arquitectura](docs/ARCHITECTURE.md) · [Contrato de la API](docs/API_CONTRACT.md) · [Despliegue](docs/DEPLOYMENT.md) · [Próximos pasos](docs/NEXT_STEPS.md) | Documentación técnica |

## Estado del proyecto (v0.1)

| Parte | Estado real |
|-------|-------------|
| Interfaz completa (carga, asistente, confirmación, workspace, exportación) | ✅ Funciona |
| Vista previa local de CSV en el navegador | ✅ Funciona (preliminar, sin enviar el archivo) |
| Perfilado de CSV/XLSX con FastAPI + Pandas | ✅ Funciona en ejecución local (`POST /api/datasets/profile`, sin guardar el archivo) |
| Asistente de requisitos (IA 1) | 🟡 Simulación DEMO con guion fijo |
| Análisis, gráficos y hallazgos | 🟡 Solo resultados ficticios del dataset de ejemplo |
| Exportación PDF, Excel, Word y Canva | 🟡 Interfaz lista; generación pendiente de backend |
| Backend FastAPI | 🟡 `/api/health` y perfilado de datasets |
| SQLite, OpenAI u Ollama, autenticación | ❌ Pendiente |

## Modalidades de uso

El mismo código se usa de dos formas (detalle en [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)):

1. **Demo pública gratuita**: solo el frontend, en modo DEMO, publicado en Cloudflare Pages. Sirve para mostrar el flujo. Los archivos que elija el visitante se leen únicamente en su navegador.
2. **Instalación privada**: frontend + FastAPI + Pandas + SQLite en una computadora o servidor interno de una organización, con sus propios datos y configuración. OpenAI sería opcional y requeriría autorización y clave propias. **Todavía no está lista para datos confidenciales**: faltan los controles de seguridad listados en DEPLOYMENT.md.

## Qué problema resuelve

Muchas personas tienen datos en planillas pero no saben qué análisis hacer ni cómo interpretarlo. DataDecision AI combina ciencia de datos en Python con dos roles de inteligencia artificial:

- **IA 1 — Asistente de requisitos**: conversa con el usuario, revisa el perfil del dataset, detecta información faltante, hace preguntas y propone un análisis que el usuario debe aprobar. Nunca inventa datos.
- **IA 2 — Analista de datos**: a partir del plan aprobado, coordina los cálculos con Pandas, prepara gráficos, evalúa si la evidencia respalda cada conclusión y genera el contenido de los informes.

Sirve para cualquier dato tabular: educación, ventas, finanzas, recursos humanos, logística, etc.

## Tecnologías

| Capa | Tecnologías |
|------|-------------|
| Frontend | React 19, Vite 7, TypeScript, Tailwind CSS 4, React Router 7, Recharts 3, Lucide React |
| Pruebas frontend | Vitest, Testing Library, jsdom |
| Backend (esqueleto) | Python 3.12, FastAPI, Uvicorn, pydantic-settings, Pytest |
| Backend (próximo) | Pandas, NumPy, SQLite/PostgreSQL, OpenAI API, generación de PDF/Excel/Word/PPTX |

## Arquitectura general

```
DataDecisionAI/
├── frontend/            React + Vite
│   └── src/
│       ├── components/  UI reutilizable, chat, carga, gráficos, workspace
│       ├── context/     Servicio inyectable y sesión (solo en memoria)
│       ├── hooks/       useService, useAsync, useConversation, useWorkspace…
│       ├── layouts/     Público, asistente por pasos, workspace con sidebar
│       ├── lib/         Config, CSV local, validación, formatos
│       ├── mocks/       Datos FICTICIOS y guion del asistente DEMO
│       ├── pages/       Pantallas
│       ├── services/    Interfaz única + proveedor DEMO + cliente HTTP
│       └── types/       Tipos de dominio (contrato con el backend)
├── backend/             FastAPI
│   ├── app/
│   │   ├── main.py      App, CORS, routers
│   │   ├── core/        Configuración
│   │   ├── api/         Routers (hoy: /api/health)
│   │   ├── schemas/     Modelos Pydantic
│   │   ├── services/    Lógica futura (Pandas, IA, exportación)
│   │   ├── models/      Tablas futuras
│   │   └── db/          Conexión futura
│   └── tests/
└── docs/                ARCHITECTURE, API_CONTRACT, DEPLOYMENT, NEXT_STEPS
```

Los componentes nunca llaman a `fetch` ni importan mocks: usan la interfaz `DataDecisionService`. Ver [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) y [docs/API_CONTRACT.md](docs/API_CONTRACT.md).

## Instalación (Windows PowerShell)

Requisitos: Node.js 20.19+ (recomendado 22) y Python 3.11+.

```powershell
# Frontend
cd frontend
npm install
Copy-Item .env.example .env.local

# Backend (en otra terminal, desde la raíz del proyecto)
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env
```

> Si PowerShell bloquea `Activate.ps1`, ejecutá una vez: `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.

## Iniciar el frontend

```powershell
cd frontend
npm run dev
```

Abrí http://localhost:5173.

Otros comandos: `npm run build`, `npm run lint`, `npm test`, `npm run preview`.

## Iniciar el backend

```powershell
cd backend
.\.venv\Scripts\Activate.ps1
uvicorn app.main:app --reload --port 8000
```

**Acceso por invitación.** Con backend, la aplicación pide un código de invitación (no hay modo de omitirlo). Para generar uno en tu equipo, desde `backend/` con el entorno activado:

```powershell
python -m app.cli invite --label "Desarrollo" --days 30   # muestra el código UNA sola vez
python -m app.cli list                                    # invitaciones, sin códigos
python -m app.cli revoke <id>                             # revoca y cierra sus sesiones
```

- El código se guarda solo como huella en `backend/data/datadecision.db` (excluida de Git). No lo copies en archivos versionados.
- En desarrollo no se exige Cloudflare Turnstile si `TURNSTILE_SECRET_KEY` está vacía.
- Cada invitación tiene su propia cuota de IA (`AI_USER_BUDGET_USD`, `AI_USER_DAILY_REQUESTS`).

**Prueba integral sin consumir créditos.** Un backend local con la IA **simulada** (no lee `.env` ni usa tu clave; base temporal):

```powershell
python scripts/simulated_ai_server.py   # muestra un código de invitación de prueba
```

Con el frontend en modo real (`VITE_DEMO_MODE=false`, `VITE_API_BASE_URL=http://127.0.0.1:8000`):
1. Ingresá con ese código.
2. En «Cargar datos», elegí un **dataset sintético de prueba**.
3. Recorré Revisar → Conversar → Confirmar → Ejecutar.

Todo es real (Pandas, validación, dashboard) salvo la respuesta de la IA.

- Salud: http://localhost:8000/api/health
- Documentación interactiva: http://localhost:8000/docs
- Pruebas: `python -m pytest`

## Modo DEMO

Se controla con `VITE_DEMO_MODE` en `frontend/.env.local`:

| Valor | Comportamiento |
|-------|----------------|
| `true` (por defecto en `npm run dev`) | Proveedor DEMO: funciona sin backend, sin base de datos y sin API key. Respuestas simuladas y resultados ficticios, siempre marcados como DEMO. |
| `false` | Aplicación real contra `VITE_API_BASE_URL` (FastAPI): Pandas, OpenAI y dashboards, con acceso por invitación. |

Para compilar (`npm run build`) la variable debe estar definida explícitamente. En Cloudflare Pages la compilación **falla** si no es `false`, si el backend no usa `https://` o si falta `VITE_TURNSTILE_SITE_KEY`: la versión pública no puede quedar en DEMO por olvidar una variable (`src/lib/buildChecks.ts`).

Reiniciá `npm run dev` después de cambiar el `.env.local`.

En modo DEMO la app no hace ninguna solicitud de red con los datos: la vista previa de CSV se calcula en el navegador y no se usa `localStorage`.

### Perfilado real con Pandas (solo ejecución local)

`VITE_BACKEND_PROFILING=true` hace que la pantalla de carga envíe el CSV/XLSX a `POST /api/datasets/profile` y muestre el perfil calculado por Pandas: filas y columnas reales, vacíos por columna, filas duplicadas, primeras filas y advertencias. El asistente y los resultados **siguen en DEMO**. Si el backend falla, se muestra el error; no se reemplaza por datos locales ni ficticios.

1. Iniciá el backend (sección anterior) en `http://127.0.0.1:8000`.
2. Creá `frontend/.env.local` con:

   ```
   VITE_DEMO_MODE=true
   VITE_BACKEND_PROFILING=true
   VITE_API_BASE_URL=http://127.0.0.1:8000
   ```

3. `npm run dev` y abrí http://localhost:5173/analisis/cargar.

El backend ya permite por CORS `http://localhost:5173` y `http://127.0.0.1:5173`. En la demo pública de Cloudflare **no** se define `VITE_BACKEND_PROFILING` (queda en `false`), así que no hay llamadas al backend.

## Publicar la demo

Cloudflare Pages (gratis): repositorio `CristianBoto/DataDecisionAI`, rama `main`, directorio raíz `frontend`, build `npm run build`, salida `dist`. La versión pública es la aplicación real con acceso por invitación (`VITE_DEMO_MODE=false`, backend con HTTPS y Turnstile); la demo ficticia ya no se publica. Paso a paso en [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md), sección C.

## Funcionalidades actuales

- Pantalla inicial con presentación y explicación del flujo.
- Carga por arrastrar o seleccionar; acepta CSV y XLSX, rechaza PDF y otros formatos con mensajes claros; muestra nombre, tamaño y estado.
- **Vista previa real de CSV** calculada en el navegador (columnas, tipos inferidos, primeras filas, vacíos), marcada como preliminar.
- Excel: se acepta; en DEMO sin backend se indica que la vista previa llegará con el backend (no se inventan columnas).
- **Perfilado real con Pandas** (opcional, local): con `VITE_BACKEND_PROFILING=true`, CSV y XLSX se perfilan en FastAPI mediante `POST /api/datasets/profile`.
- Chat con el asistente (simulado en DEMO, con guion determinista basado en el perfil real del dataset).
- Propuesta versionada con estado de viabilidad (viable, parcial, insuficiente), modificaciones y aprobación obligatoria.
- Workspace con sidebar, indicadores, gráficos de barras, líneas, áreas y distribución (con vista de tabla), hallazgos con nivel de evidencia, limitaciones, panel del asistente y vista del dataset.
- Sección **Exportar análisis**: PDF, Excel, Word y Canva (PDF/PPTX) con formulario validado; indica claramente que todavía no está disponible.
- Estados de carga, vacíos y de error; diseño responsive.
- Backend con `/api/health`, CORS de desarrollo y pruebas.

## Funcionalidades pendientes

- Persistencia, carga real de archivos guardados y perfil por `datasetId` (hoy el perfilado con Pandas existe, pero sin guardar el archivo).
- IA 1 e IA 2 con OpenAI desde FastAPI.
- Cálculos reales, validación de resultados y gráficos con datos reales.
- Generación de PDF, Excel, Word y archivos para Canva.
- Despliegue del backend e instalación privada completa.
- Controles de privacidad y seguridad: autenticación, HTTPS, cifrado, retención, auditoría y consentimiento para OpenAI.
- Edición posterior de informes.

Detalle en [docs/NEXT_STEPS.md](docs/NEXT_STEPS.md). Estas etapas se desarrollarán después con ChatGPT siguiendo [docs/API_CONTRACT.md](docs/API_CONTRACT.md).

## Seguridad

Lo que ya existe:

- Los `.env` están excluidos de git; solo se versionan los `.env.example` sin secretos.
- La API key de OpenAI se usará exclusivamente en el backend.
- El frontend no guarda archivos ni datos en `localStorage` y, en modo DEMO, no envía archivos por la red.
- Datasets subidos, bases locales e informes generados están excluidos en `.gitignore`.

Lo que **todavía no** existe: autenticación, cifrado, auditoría y políticas de retención. Por eso la aplicación **no garantiza hoy confidencialidad empresarial**. Detalle en [docs/SEGURIDAD.md](docs/SEGURIDAD.md).
