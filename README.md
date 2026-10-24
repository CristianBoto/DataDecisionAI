# DataDecision AI

Plataforma web para cargar datasets CSV o Excel, explicar en lenguaje común qué se necesita decidir y obtener indicadores, gráficos y recomendaciones basadas en datos.

Proyecto final de **Prácticas Profesionalizantes — Tecnicatura en Ciencia de Datos**.

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
└── docs/                ARCHITECTURE, API_CONTRACT, NEXT_STEPS
```

Los componentes nunca llaman a `fetch` ni importan mocks: usan la interfaz `DataDecisionService`. Ver [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) y [docs/API_CONTRACT.md](docs/API_CONTRACT.md).

## Instalación (Windows PowerShell)

Requisitos: Node.js 20+ y Python 3.11+.

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

- Salud: http://localhost:8000/api/health
- Documentación interactiva: http://localhost:8000/docs
- Pruebas: `python -m pytest`

## Modo DEMO

Se controla con `VITE_DEMO_MODE` en `frontend/.env.local`:

| Valor | Comportamiento |
|-------|----------------|
| `true` (por defecto) | Proveedor DEMO: funciona sin backend, sin base de datos y sin API key. Respuestas simuladas y resultados ficticios, siempre marcados como DEMO. |
| `false` | Cliente HTTP contra `VITE_API_BASE_URL` (FastAPI). Hoy solo responde `/api/health`. |

Reiniciá `npm run dev` después de cambiar el `.env.local`.

## Funcionalidades actuales

- Pantalla inicial con presentación y explicación del flujo.
- Carga por arrastrar o seleccionar; acepta CSV y XLSX, rechaza PDF y otros formatos con mensajes claros; muestra nombre, tamaño y estado.
- **Vista previa real de CSV** calculada en el navegador (columnas, tipos inferidos, primeras filas, vacíos), marcada como preliminar.
- Excel: se acepta, pero se indica que la vista previa llegará con el backend (no se inventan columnas).
- Chat con el asistente (simulado en DEMO, con guion determinista basado en el perfil real del dataset).
- Propuesta versionada con estado de viabilidad (viable, parcial, insuficiente), modificaciones y aprobación obligatoria.
- Workspace con sidebar, indicadores, gráficos de barras, líneas, áreas y distribución (con vista de tabla), hallazgos con nivel de evidencia, limitaciones, panel del asistente y vista del dataset.
- Sección **Exportar análisis**: PDF, Excel, Word y Canva (PDF/PPTX) con formulario validado; indica claramente que todavía no está disponible.
- Estados de carga, vacíos y de error; diseño responsive.
- Backend con `/api/health`, CORS de desarrollo y pruebas.

## Funcionalidades pendientes

- Persistencia, carga real de archivos y perfilado con Pandas.
- IA 1 e IA 2 con OpenAI desde FastAPI.
- Cálculos reales, validación de resultados y gráficos con datos reales.
- Generación de PDF, Excel, Word y archivos para Canva.
- Edición posterior de informes, autenticación y despliegue (fuera del alcance del MVP).

Detalle en [docs/NEXT_STEPS.md](docs/NEXT_STEPS.md).

## Seguridad

- Los `.env` están excluidos de git; solo se versionan los `.env.example` sin secretos.
- La API key de OpenAI se usará exclusivamente en el backend.
- El frontend no guarda archivos ni datos en `localStorage`.
- Datasets subidos, bases locales e informes generados están excluidos en `.gitignore`.
