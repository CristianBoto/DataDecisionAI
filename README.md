# DataDecision AI

Plataforma web para analizar datasets CSV o Excel: la persona explica en lenguaje común qué necesita decidir, revisa cómo se interpretan sus datos y aprueba un plan de análisis. DataDecision AI calcula los resultados con Python y Pandas, los muestra en un dashboard y genera un informe descargable en PDF.

Proyecto final de **Prácticas Profesionalizantes — Tecnicatura en Ciencia de Datos**.

> **Beta pública con acceso por invitación:** https://datadecisionai.pages.dev
> Frontend React en Cloudflare Pages y backend FastAPI en Render. No es una demo ficticia: los archivos se procesan de verdad en el backend y el asistente usa OpenAI.

> ⚠️ **No cargues información personal, sensible o confidencial en la beta pública** (datos de personas identificables, salud, finanzas personales, datos de clientes o de una organización) sin una evaluación previa de privacidad y la autorización de quien sea responsable de esos datos. La beta es un MVP académico: tiene protecciones, pero **no garantiza confidencialidad** (ver [Seguridad](#seguridad) y [Limitaciones](#limitaciones-conocidas)). Para probarla, usá los **datasets sintéticos** que ofrece la pantalla de carga.

## Documentación del proyecto

| Documento | Contenido |
|-----------|-----------|
| [Bitácora de desarrollo](docs/BITACORA_DESARROLLO.md) | Idea, decisiones, problemas y aprendizajes de cada fase (base de la exposición final) |
| [Pruebas y validaciones](docs/PRUEBAS_Y_VALIDACIONES.md) | Pruebas automatizadas y manuales de cada fase, con sus resultados |
| [Seguridad y privacidad](docs/SEGURIDAD.md) | Frontera de privacidad con la IA, controles implementados y limitaciones |
| [Auditoría de seguridad](docs/AUDITORIA_SEGURIDAD.md) | Auditorías de la beta pública y de la Fase 4D, con mediciones y controles a revisar en Render, Cloudflare, GitHub y OpenAI |
| [Arquitectura](docs/ARCHITECTURE.md) | Diseño técnico de cada fase (frontera de IA, motor Pandas, motor generalista, informe) |
| [Despliegue](docs/DEPLOYMENT.md) | Configuración de Render y Cloudflare Pages, variables y verificaciones |
| [Contrato de la API (plan original)](docs/API_CONTRACT.md) · [Próximos pasos (plan original)](docs/NEXT_STEPS.md) | Documentos de planificación iniciales, conservados como registro histórico: la API implementada es la descrita en ARCHITECTURE.md |

## Estado de las funcionalidades

| Funcionalidad | Estado | Limitaciones |
|---------------|--------|--------------|
| **Acceso por invitación** con Cloudflare Turnstile | ✅ Implementado | Sin registro público, roles ni recuperación de cuenta. Las invitaciones se crean desde la consola del servidor |
| **Carga y perfilado de CSV/XLSX** con Pandas (hasta 3 archivos, cada uno analizado por separado) | ✅ Implementado | Tamaño, filas, columnas y celdas limitados. Solo la primera hoja del XLSX. No se unen archivos |
| **Revisión de los datos y de la privacidad**: tipo de cada columna, unidad, si se puede sumar, dependencias y marcadores de ausencia | ✅ Implementado | Las sugerencias son heurísticas: hay que confirmarlas |
| **Conversación con OpenAI** (asistente de requisitos) | ✅ Implementado | Cada mensaje requiere autorización explícita. Cuotas y presupuesto limitados |
| **Propuesta y aprobación del plan** | ✅ Implementado | Catálogo cerrado de 14 operaciones. Las operaciones incompatibles con los datos se descartan antes de aprobar |
| **Cálculos reales con Pandas** (conteos, sumas, promedios, medianas, mínimos, máximos, frecuencias, agrupaciones, comparaciones, series temporales, histogramas, correlaciones y curva ROC) | ✅ Implementado | Una fuente por plan. Tope de tiempo y de celdas por ejecución |
| **Dashboard con Recharts** (barras, líneas, torta, histograma, dispersión y ROC, con vista de tabla; eje, series y filtros elegibles en resultados con varias dimensiones) | ✅ Implementado | Hasta 6 series por gráfico. Los resultados viven en la pestaña del navegador |
| **Informe descriptivo** calculado sin IA | ✅ Implementado | Describe los resultados; no explica causas |
| **Interpretación opcional con OpenAI**, con autorización y **validación de afirmaciones** | ✅ Implementado | Cada cifra se recalcula sobre los resultados de Pandas. Las afirmaciones sin cifras se marcan «no verificadas» |
| **Descarga de PDF** con jsPDF (en el navegador) | ✅ Implementado | Fuentes estándar (Latin-1). Los gráficos usan la vista predeterminada |
| Exportación a Excel, Word o Canva | ❌ No implementado | Solo existe como formulario ilustrativo en el modo DEMO |
| Persistencia de proyectos, archivos o resultados | ❌ No implementado (por diseño) | Ver [Limitaciones](#limitaciones-conocidas) |

## Recorrido de un análisis

1. **Cargar:** se suben hasta 3 archivos CSV o XLSX (o un dataset sintético de prueba). El backend los perfila con Pandas: filas, columnas, vacíos, duplicados, tipo de cada columna y advertencias.
2. **Revisar:** la persona confirma o corrige la interpretación de cada columna y elige qué columnas puede conocer la IA y con qué nombre. Ve el contenido exacto que se compartiría.
3. **Conversar:** el asistente (OpenAI) entiende el objetivo, pregunta lo que falta y propone planes. Cada envío se autoriza; también se puede autorizar una conversación por tiempo y cantidad de mensajes acotados.
4. **Confirmar:** la persona aprueba los planes y ejecuta el análisis. Los archivos se vuelven a enviar al backend, se calculan con Pandas y se descartan.
5. **Resultados:** dashboard, tablas exactas, informe descriptivo, interpretación opcional con IA, vista previa y descarga en PDF.

## Privacidad: qué datos van a cada lugar

| Lugar | Qué recibe o guarda |
|-------|---------------------|
| **Navegador** | Los archivos elegidos, en la memoria de la pestaña, para volver a enviarlos al ejecutar. El token de sesión, en `sessionStorage`, que se borra al cerrar la pestaña. No se usa `localStorage` para datos |
| **Backend en Render** (por HTTPS) | Los **archivos completos**, para perfilarlos y calcular. Se procesan en memoria y **no se guardan**. Las cargas grandes pueden pasar por un archivo temporal que se borra al terminar el pedido. En memoria, mientras el proceso sigue activo: los planes aprobados y el contexto agregado de las últimas 2 ejecuciones de cada visitante, por 6 horas |
| **Base SQLite** (disco persistente de Render) | Huellas SHA-256 de invitaciones y sesiones (nunca los códigos), vencimientos y revocaciones. El consumo de la IA: fecha, visitante, modelo, tokens y costo. **No guarda datasets, objetivos, mensajes ni resultados** |
| **OpenAI** (solo con autorización explícita de cada envío) | En la **conversación**: el objetivo, los mensajes y los **metadatos** de las columnas autorizadas (nombre, formato, tipo, rango aproximado de valores distintos, unidad, si se puede sumar). En la **interpretación**: el objetivo, la cantidad de filas y columnas y los **resultados agregados** de Pandas (totales por grupo o período, intervalos, correlaciones, AUC), que **incluyen nombres de categorías** de los datos. **Nunca:** archivos, filas, valores individuales, nombres de archivo ni puntos de dispersión o ROC |

Las solicitudes a OpenAI se envían con `store=False`. El tratamiento de esos datos por OpenAI se rige por sus propios términos. Detalle en [docs/SEGURIDAD.md](docs/SEGURIDAD.md).

## Arquitectura

```
Navegador (React + TypeScript)        Backend (FastAPI + Python, Render)              OpenAI
Cloudflare Pages, rama main           rama beta-render, 1 instancia
──────────────────────────────        ────────────────────────────────────            ──────
Carga, revisión, chat, dashboard ──►  Acceso: invitaciones, sesiones, Turnstile
Informe y PDF (jsPDF)          HTTPS  Perfilado y motor: Pandas, NumPy, scikit-learn
                                      Frontera de IA: autorización, presupuesto ──►  Responses API
                                      SQLite (/var/data): sesiones y consumo          (salida estructurada)
```

| Capa | Tecnologías |
|------|-------------|
| Frontend | React 19, TypeScript, Vite 7, Tailwind CSS 4, React Router 7, Recharts 3, jsPDF (cargado bajo demanda), Lucide React |
| Backend | Python 3.12, FastAPI, Uvicorn, Pydantic, Pandas, NumPy, scikit-learn (curva ROC), openpyxl + defusedxml, SDK oficial de OpenAI |
| Persistencia | SQLite en un disco persistente de Render (solo acceso y consumo de la IA) |
| Plataformas | Cloudflare Pages (frontend), Render Starter (backend), GitHub (repositorio y despliegue automático), Cloudflare Turnstile |
| Pruebas | Pytest y Vitest con Testing Library: 308 pruebas de backend y 205 de frontend, con proveedores de IA falsos |

```
DataDecisionAI/
├── frontend/src/
│   ├── components/   carga, revisión, chat, análisis, gráficos, informe (report/), acceso
│   ├── pages/        Cargar, Revisar, Asistente, Confirmar, Resultados (y workspace del modo DEMO)
│   ├── lib/          contexto para la IA, dashboard, informe y PDF, controles de compilación
│   ├── services/     clientes del backend (perfilado, IA, motor) y proveedor DEMO
│   └── test/         pruebas y respuestas reales del motor como fixtures
├── backend/
│   ├── app/api/routes/   health, auth, datasets, ai, analysis
│   ├── app/services/     perfilado, semántica de columnas, motor, frontera de IA, presupuesto, informe
│   ├── app/core/         configuración, límites por IP, encabezados y registros seguros
│   ├── scripts/          servidor local con IA simulada (pruebas sin créditos)
│   └── tests/
└── docs/
```

Detalle técnico en [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Seguridad

Protecciones implementadas (no equivalen a seguridad absoluta):

- **Acceso:**
  - toda ruta de datos exige una sesión de invitación, sin modo de omitirla;
  - códigos de 144 bits y tokens de 256 bits, con solo sus huellas en la base;
  - sesiones de 12 h, como máximo 3 por invitación, y revocar una invitación cierra sus sesiones;
  - Turnstile y 10 intentos de canje cada 15 minutos por IP.
- **Aislamiento:** solicitudes, conversaciones, planes, ejecuciones e interpretaciones tienen dueño. Para otro visitante no existen (404).
- **Cargas:**
  - se rechazan antes de leer el cuerpo si vienen sin sesión, desde un origen no autorizado o con un tamaño excedido;
  - límites de bytes, filas, columnas y celdas;
  - los XLSX se descomprimen con tope real y su XML se lee con protección contra la expansión de entidades.
- **IA y gasto:**
  - autorización de uso único sobre el contenido exacto;
  - reserva del costo máximo antes de enviar, en una transacción de SQLite;
  - presupuesto global y por invitación, topes diarios y una sola consulta en curso por visitante;
  - las respuestas se validan (planes contra el catálogo, cifras recalculadas) y nunca se ejecuta código producido por la IA.
- **Recursos (Fase 4D):**
  - una sola tarea pesada a la vez en producción; el exceso recibe 429 al instante;
  - tope de 90 s por ejecución y de celdas combinadas;
  - por invitación, 30 perfilados y 10 ejecuciones cada 10 minutos, además de 120 solicitudes por minuto por IP.
- **Producción:**
  - el backend no arranca con una configuración insegura (sin Turnstile, sin HTTPS en CORS o sin el disco persistente confirmado);
  - HTTPS obligatorio, HSTS y CSP;
  - sin `/docs` público;
  - errores internos sin datos en los registros.
- **Secretos:** la clave de OpenAI vive solo en el backend. Los `.env`, las bases SQLite y los datasets están excluidos de Git.

Lo que **no** existe: cifrado propio de los datos en reposo, registro de auditoría por usuario, roles, políticas de retención configurables ni evaluación formal de privacidad. Detalle en [docs/SEGURIDAD.md](docs/SEGURIDAD.md) y [docs/AUDITORIA_SEGURIDAD.md](docs/AUDITORIA_SEGURIDAD.md).

## Limitaciones conocidas

- **Servidor chico:** Render Starter, con 512 MB de RAM y 0,5 CPU. Los archivos grandes tardan (perfilar 1 M de celdas lleva varios segundos).
- **Una tarea pesada por vez:** perfilado o ejecución, para no agotar la memoria. Si el servidor está ocupado, la respuesta es **429** y hay que reintentar en unos segundos. No hay cola.
- **El tope de 90 s es cooperativo:** deja de empezar operaciones nuevas y las informa como «no calculadas», pero no detiene una operación individual ya iniciada.
- **Datos en memoria:** un reinicio o redespliegue del backend borra los planes, los permisos de conversación y los resultados guardados para interpretar. Los resultados también viven solo en la pestaña: al recargarla se pierden y hay que volver a cargar los archivos.
- **Alcance del análisis:** una fuente por plan (no se unen archivos), operaciones de un catálogo cerrado, sin modelos predictivos (la curva ROC evalúa puntuaciones existentes) y sin causalidad.
- **IA:** puede equivocarse. Las cifras se verifican, pero el razonamiento sin cifras se marca como no verificado y conviene revisarlo.
- **PDF:** se genera en el navegador, con la vista predeterminada de cada gráfico y hasta 25 filas por tabla, con aviso.

## Pendiente y fuera de alcance del MVP

- Exportación a Excel, Word y formatos para Canva.
- Guardar proyectos y resultados entre sesiones (hoy, deliberadamente, no se guardan datos).
- Unir o relacionar varios archivos en un mismo análisis.
- Roles, auditoría por usuario, cifrado en reposo y políticas de retención, necesarios para datos confidenciales o una instalación empresarial.
- Corte duro de tiempo y memoria por tarea (exigiría procesos separados o un servidor con más recursos).

## Instalación local (Windows PowerShell)

Requisitos: Node.js 20.19 o superior (recomendado 22) y Python 3.12 (la versión con la que se probó).

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

### Iniciar el backend

```powershell
cd backend
.\.venv\Scripts\Activate.ps1
uvicorn app.main:app --reload --port 8000
```

- Salud: http://localhost:8000/api/health
- Documentación interactiva (solo fuera de producción): http://localhost:8000/docs
- Pruebas: `python -m pytest`

La IA externa está deshabilitada por defecto (`AI_ENABLED=false`). Para usarla hay que configurar `OPENAI_API_KEY` en `backend/.env` (nunca en el frontend), y cada envío igual requiere autorización.

**Invitaciones.** Con backend, la aplicación pide un código de invitación. Para generar uno, desde `backend/` con el entorno activado:

```powershell
python -m app.cli invite --label "Desarrollo" --days 30   # muestra el código UNA sola vez
python -m app.cli list                                    # invitaciones, sin códigos
python -m app.cli revoke <id>                             # revoca y cierra sus sesiones
```

- **Dónde se guarda:** el código queda solo como huella en `backend/data/datadecision.db`, excluida de Git. No lo copies en archivos versionados.
- **Turnstile en desarrollo:** no se exige si `TURNSTILE_SECRET_KEY` está vacía; en producción es obligatorio.
- **Cuota de IA:** cada invitación tiene la suya (`AI_USER_BUDGET_USD`, `AI_USER_DAILY_REQUESTS`).

### Iniciar el frontend

En `frontend/.env.local`, para usar el backend local:

```
VITE_DEMO_MODE=false
VITE_API_BASE_URL=http://127.0.0.1:8000
```

```powershell
cd frontend
npm run dev
```

Abrí http://localhost:5173. Otros comandos: `npm run build`, `npm run lint`, `npm test`, `npm run preview`.

### Prueba integral sin consumir créditos

Un backend local con la IA **simulada**: no lee `.env`, no usa tu clave y trabaja con una base temporal. Desde `backend/`:

```powershell
python scripts/simulated_ai_server.py   # muestra un código de invitación de prueba
```

Con el frontend configurado como en la sección anterior:
1. Ingresá con ese código.
2. Elegí un **dataset sintético de prueba** en «Cargar».
3. Recorré Revisar → Conversar → Confirmar → Resultados, incluida la interpretación y el PDF.

Todo es real (Pandas, validación, dashboard, informe) salvo las respuestas de la IA, que se identifican como simuladas. La interpretación simulada incluye a propósito afirmaciones incorrectas, para mostrar cómo las descarta la verificación.

## Modo DEMO (solo desarrollo)

`VITE_DEMO_MODE=true` (el valor del `.env.example`) usa un proveedor DEMO que funciona sin backend: asistente con guion fijo, resultados **ficticios** del dataset de ejemplo, workspace y formularios de exportación ilustrativos. Todo se marca como DEMO, y los archivos solo se leen en el navegador para una vista previa preliminar.

**El modo DEMO no se publica.** En Cloudflare Pages la compilación falla si `VITE_DEMO_MODE` no es `false`, si `VITE_API_BASE_URL` no usa `https://` (o apunta a localhost) o si falta `VITE_TURNSTILE_SITE_KEY` (`frontend/src/lib/buildChecks.ts`). Para compilar fuera de Pages, la variable debe estar definida explícitamente. Reiniciá `npm run dev` después de cambiar el `.env.local`.

## Publicación

| Parte | Plataforma | Rama | Configuración |
|-------|-----------|------|---------------|
| Frontend | Cloudflare Pages | `main` | Directorio raíz `frontend`, build `npm run build`, salida `dist`. Variables `VITE_DEMO_MODE=false`, `VITE_API_BASE_URL` (https) y `VITE_TURNSTILE_SITE_KEY` |
| Backend | Render Starter (512 MB) | `beta-render` | Directorio raíz `backend`, build `pip install -r requirements.txt` (incluye `defusedxml`), una instancia, disco persistente en `/var/data` |

Un cambio en la API debe llegar primero a `beta-render` (backend) y después a `main` (frontend). Paso a paso, variables y verificaciones en [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md), sección C. Controles a revisar en los paneles: [docs/AUDITORIA_SEGURIDAD.md](docs/AUDITORIA_SEGURIDAD.md), sección 7.6.
