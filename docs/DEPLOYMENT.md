# Despliegue e instalación — DataDecision AI

DataDecision AI se usa de tres formas con **el mismo código**:

| Modalidad | Qué se publica | Para quién | Estado |
|-----------|----------------|------------|--------|
| **A. Demo pública** | Solo el frontend en modo DEMO (Cloudflare Pages, gratis) | Cualquier persona que quiera conocer la herramienta | ⏹ Reemplazada por C (la compilación pública ya no admite DEMO) |
| **B. Instalación privada** | Frontend + backend FastAPI en una computadora o servidor interno | Una empresa u organización, con sus propios datos | 🟡 Documentada (mismo backend completo que C); sin controles empresariales (ver la sección B) |
| **C. Beta pública con acceso por invitación** | Frontend en Cloudflare Pages + backend FastAPI en Render (Starter, 512 MB, 0,5 CPU) con disco persistente | Invitados (por ejemplo, docentes), con funcionalidad real | ✅ Desplegada. Controles a revisar en los paneles: [AUDITORIA_SEGURIDAD.md](AUDITORIA_SEGURIDAD.md), sección 7.6 |

---

## A. Demo pública en Cloudflare Pages

> **Reemplazada por la sección C.** La versión pública pasa a ser la aplicación real con acceso por invitación. Desde las correcciones de seguridad, la compilación en Cloudflare Pages **falla** con `VITE_DEMO_MODE=true` (o sin definir): antes del próximo `git push` a `main`, configurá las variables de la sección C o el despliegue automático fallará (el sitio ya publicado sigue funcionando hasta que una compilación nueva tenga éxito). Esta sección queda como registro histórico.

**Publicada:** https://datadecisionai.pages.dev

| Evidencia | Tipo |
|-----------|------|
| Publicación exitosa confirmada con captura del panel de Cloudflare, provista por el desarrollador | Comunicada |
| El 24/10/2026 la URL respondió HTTP 200 con el título "DataDecision AI", y la ruta interna `/analisis/cargar` también respondió 200 (las rutas de React Router funcionan al recargar) | Verificada (consulta HTTP) |

La configuración `VITE_DEMO_MODE=true` del despliegue consta en la captura comunicada; no se verificó directamente en el panel.

### Qué funciona en la demo pública

- Recorrido completo: inicio → carga → asistente → confirmación → workspace → exportación.
- Vista previa **local** de CSV: el archivo se lee en el navegador del visitante y **no se envía a ningún servidor** (verificado por la prueba `procesa el archivo localmente sin enviarlo por la red`).
- Asistente simulado (guion fijo) y resultados de ejemplo **ficticios**, siempre marcados como DEMO.
- Avisos visibles: datos ficticios, funciones avanzadas que requieren backend y recomendación de no cargar datos confidenciales.

### Qué NO funciona en la demo pública

- No hay backend, IA real, base de datos ni exportación de archivos.
- Los proyectos viven en memoria: al recargar la página se pierden.
- La vista previa de Excel requiere backend.

### Configuración (una sola vez)

1. Subí el repositorio a GitHub (`CristianBoto/DataDecisionAI`, rama `main`).
2. Entrá a <https://dash.cloudflare.com> con una cuenta gratuita.
3. **Workers & Pages** → **Create** → pestaña **Pages** → **Connect to Git**.
4. Autorizá a Cloudflare a leer tu cuenta de GitHub y elegí el repositorio `CristianBoto/DataDecisionAI`.
5. Completá **Set up builds and deployments**:

   | Campo | Valor |
   |-------|-------|
   | Project name | `datadecisionai` (define la URL `https://datadecisionai.pages.dev`) |
   | Production branch | `main` |
   | Framework preset | `React (Vite)` o `None` |
   | Build command | `npm run build` |
   | Build output directory | `dist` |
   | Root directory (advanced) | `frontend` |

6. En **Environment variables (advanced)** agregá:

   | Variable | Valor |
   |----------|-------|
   | `VITE_DEMO_MODE` | `true` |

   No agregues claves ni secretos: todas las variables `VITE_*` quedan visibles en el navegador.
   **No** definas `VITE_BACKEND_PROFILING`: sin esa variable (o en `false`) la demo pública no hace ninguna llamada al backend.
7. **Save and Deploy**. Al terminar, Cloudflare muestra la URL pública.

Cada `git push` a `main` vuelve a publicar automáticamente. Las ramas distintas de `main` generan URLs de vista previa.

### Versión de Node

Vite 7 necesita Node 20.19 o superior. El archivo `frontend/.node-version` fija **Node 22**, y Cloudflare Pages lo lee porque está en el directorio raíz del build. Si el build fallara por la versión de Node, agregá la variable `NODE_VERSION=22`.

### Rutas de React Router (recargar páginas)

No hace falta configurar redirecciones. Cuando el proyecto **no tiene** un archivo `404.html`, Cloudflare Pages lo trata como una aplicación de una sola página (SPA) y responde `index.html` para cualquier ruta desconocida, por ejemplo `/analisis/cargar`. React Router toma el control desde ahí.

- No agregues `frontend/public/404.html`: desactivaría ese comportamiento.
- No agregues un `_redirects` con `/* /index.html 200`: no es necesario y Cloudflare puede marcarlo como bucle infinito.
- Al recargar `/proyectos/...` en la demo, la app muestra "No se encontró el proyecto": es lo esperado, porque los datos DEMO viven solo en memoria.

### Probar la build localmente antes de publicar

```powershell
cd frontend
npm run build
npm run preview
```

Abrí la URL que muestra la consola (por defecto <http://localhost:4173>) y recorré el flujo.

---

## B. Instalación privada (computadora o servidor interno)

> **Importante:** el backend es el mismo de la beta pública (perfilado, IA, motor Pandas e informe). **La aplicación todavía no garantiza confidencialidad empresarial**: ver "Controles de seguridad pendientes".

### Arquitectura de una instalación

```
Equipo o servidor interno de la organización
├── Frontend (archivos estáticos de frontend/dist)      VITE_DEMO_MODE=false
│        │  HTTP en la red interna
├── Backend FastAPI (uvicorn)                            backend/.env
│   ├── Python + Pandas → lectura y cálculos
│   ├── SQLite → backend/data/datadecision.db
│   ├── Archivos subidos → backend/data/uploads/
│   └── OpenAI (OPCIONAL) → solo si la organización lo autoriza y configura su propia clave
```

Cada instalación tiene **sus propios datos y su propia configuración**: no comparte base de datos, archivos ni claves con la demo pública ni con otras instalaciones.

### Requisitos

- Windows 10/11, Linux o macOS.
- Python 3.11 o superior, Node.js 20.19 o superior y Git.

### Pasos (Windows PowerShell)

```powershell
git clone https://github.com/CristianBoto/DataDecisionAI.git
cd DataDecisionAI
```

**Backend:**

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env
# Editar .env: CORS_ORIGINS con la dirección del frontend interno,
#   por ejemplo CORS_ORIGINS=http://127.0.0.1:4173 si se usa "npm run preview".
# OPENAI_API_KEY queda vacía salvo que la organización autorice usar OpenAI.
uvicorn app.main:app --host 127.0.0.1 --port 8000
```

**Frontend:**

```powershell
cd frontend
npm ci
Copy-Item .env.example .env.local
# Editar .env.local:
#   VITE_DEMO_MODE=false
#   VITE_API_BASE_URL=http://127.0.0.1:8000   (o la dirección interna del backend)
npm run build
npm run preview -- --host 127.0.0.1
```

Para uso en una sola computadora alcanza con `127.0.0.1`. Para un servidor compartido en la red interna, el área de sistemas debería servir `frontend/dist` con un servidor web interno y publicar el backend solo dentro de la red.

### OpenAI como integración opcional

- Desactivada por defecto (`OPENAI_API_KEY` vacía).
- Activarla es una **decisión de la organización**: implica enviar a OpenAI el perfil del dataset y resúmenes agregados (no el archivo completo, según el diseño previsto). Debe revisarse con la política de datos de la organización y los términos del proveedor.
- La clave se configura solo en `backend/.env` del servidor. Nunca en el frontend.
- Sin OpenAI, la instalación podrá cargar, perfilar y calcular con Pandas, pero sin las funciones del asistente con IA.

### Controles de seguridad pendientes

Estos controles **no están implementados** y son necesarios antes de usar datos sensibles:

| Control | Estado |
|---------|--------|
| Autenticación de usuarios y permisos | 🟡 Acceso por invitación con sesión (sección C); sin roles |
| HTTPS en la red interna | ❌ Pendiente (configuración del servidor) |
| Cifrado de archivos y base de datos en reposo | ❌ Pendiente |
| Políticas de retención y borrado de datasets | ❌ Pendiente |
| Registro de auditoría (quién subió y analizó qué) | ❌ Pendiente |
| Validación de contenido de archivos (fórmulas maliciosas, tamaño, codificación) | 🟡 Solo validación preliminar en el frontend |
| Control de qué datos se envían a OpenAI y consentimiento explícito | ❌ Pendiente |
| Copias de seguridad de SQLite | ❌ Pendiente |
| Límites de uso y tiempos de espera de la IA | ✅ Presupuesto global, cuotas por visitante y tiempo máximo (ver [SEGURIDAD.md](SEGURIDAD.md)) |

Ya existe: secretos fuera del repositorio (`.env` ignorado), clave de OpenAI prevista solo en el backend, CORS restringido por configuración y sin almacenamiento de archivos en el navegador.

---

## C. Beta pública con acceso por invitación (FastAPI + Cloudflare Pages)

La misma aplicación que en `localhost` (Pandas, OpenAI y dashboards), protegida por invitación. Controles y pruebas: [AUDITORIA_SEGURIDAD.md](AUDITORIA_SEGURIDAD.md), secciones 6 y 7. **Desplegada** en Render y Cloudflare Pages.

### Backend

Requisitos de la plataforma: HTTPS incluido, **una sola instancia** y un **disco persistente** (en Render, un *Persistent Disk* montado, por ejemplo, en `/var/data`; no todos los planes lo incluyen y sin él el disco se borra en cada despliegue).

Variables (los secretos, en el gestor de secretos de la plataforma, nunca en archivos versionados):

```
ENVIRONMENT=production
FORWARDED_IP_HOPS=1
DATABASE_URL=sqlite:////var/data/datadecision.db
PERSISTENT_STORAGE_CONFIRMED=true
CORS_ORIGINS=https://datadecisionai.pages.dev
TURNSTILE_SECRET_KEY=<secreto>
TURNSTILE_EXPECTED_HOSTNAME=datadecisionai.pages.dev
OPENAI_API_KEY=<secreto>
AI_ENABLED=true
AI_BUDGET_USD=2
AI_USER_BUDGET_USD=0.10
AI_USER_DAILY_REQUESTS=15
AI_GLOBAL_DAILY_REQUESTS=150
MAX_UPLOAD_MB=10
MAX_DATASET_CELLS=1000000
```

Servicio web en Render:

| Campo | Valor |
|-------|-------|
| Runtime | Python 3 (`PYTHON_VERSION=3.12.9`, la versión con la que se probó) |
| Branch | `beta-render` (el frontend se publica desde `main` en Cloudflare Pages) |
| Root Directory | `backend` |
| Build Command | `pip install -r requirements.txt` |
| Health Check Path | `/api/health` |
| Instancias | 1 (sin autoescalado) |
| Tareas pesadas simultáneas | 1 en producción (`MAX_HEAVY_TASKS` sin definir). Ver «Concurrencia y memoria» |
| Disco | Persistent Disk montado en `/var/data` (requiere un plan pago; el plan gratuito no lo incluye y el backend no arrancaría) |

Comando de inicio (desde `backend/`):

```
uvicorn app.main:app --host 0.0.0.0 --port $PORT --workers 1 --no-proxy-headers
```

- `--workers 1`: los límites por IP y los almacenes en memoria son de un solo proceso.
- **Dependencias:** `backend/requirements.txt` es el único archivo que instala Render e incluye `defusedxml==0.7.1` (lectura segura del XML de los XLSX).
- **Ramas:** Render despliega `beta-render` y Cloudflare Pages, `main`. Un cambio que toca la API debe llegar primero a `beta-render` (backend) y después a `main` (frontend); si el frontend nuevo se publica antes, puede llamar a un endpoint que el backend todavía no tiene.
- **Concurrencia y memoria:** en producción corre **una sola tarea pesada a la vez** (perfilado o ejecución). Medición local: cada una suma ~60 MB y las dos juntas ~120 MB, sobre ~165–190 MB del proceso, más las copias de la carga, la respuesta JSON y la fragmentación de memoria de Linux. Dos a la vez dejaban un margen de apenas 60–110 MB sobre 512 MB. Si el cupo está ocupado, el pedido se rechaza al instante con 429 y `Retry-After: 30`, sin cola ni espera indefinida. `MAX_HEAVY_TASKS=2` solo es razonable con más memoria.
- **Tope de tiempo cooperativo:** una ejecución deja de **empezar** operaciones a los 90 s, y las pendientes se informan como «no calculadas». No detiene una operación individual ya iniciada: una operación lenta puede terminar después de ese límite.
- **Proxy de confianza (`FORWARDED_IP_HOPS=1`):** el proxy HTTPS de la plataforma agrega a la derecha de `X-Forwarded-For` la IP que vio. El backend toma **esa** entrada, no la primera, que la escribe el visitante y podría falsificar para esquivar el límite por IP. Por eso no se usa `--forwarded-allow-ips="*"` y se desactiva el manejo de uvicorn (`--no-proxy-headers`). Si delante hubiera otro proxy propio (por ejemplo, Cloudflare con proxy activado), el valor pasa a 2.
- **HTTPS obligatorio:** en producción se rechaza (403) todo pedido cuyo `X-Forwarded-Proto` no sea `https`, salvo `/api/health` (control de salud interno).
- **Disco:** la carpeta de `DATABASE_URL` debe existir antes de arrancar (el disco montado). En producción la aplicación no la crea: si falta, no arranca.
- Si falta algo de lo anterior (Turnstile con su dominio, CORS https, disco confirmado, proxy), el backend **no arranca** y explica qué falta.

Invitaciones, desde la consola del servidor:

```
python -m app.cli invite --label "Docente" --days 14
python -m app.cli list
python -m app.cli revoke <id>
```

Además, configurar un **límite de gasto del proyecto en OpenAI Platform** como última barrera.

### Frontend (Cloudflare Pages)

Variables de compilación:

```
VITE_DEMO_MODE=false
VITE_API_BASE_URL=https://<backend>
VITE_TURNSTILE_SITE_KEY=<clave del sitio, pública>
```

La build genera `dist/_headers` con la CSP (`connect-src` solo hacia `VITE_API_BASE_URL`), HSTS, `nosniff` y `X-Frame-Options: DENY`. En Turnstile, el widget debe autorizar el dominio `datadecisionai.pages.dev`.

En Cloudflare Pages (`CF_PAGES=1`) la compilación **se corta** si `VITE_DEMO_MODE` no es `false`, si `VITE_API_BASE_URL` no es `https://` (o apunta a localhost) o si falta `VITE_TURNSTILE_SITE_KEY`. Así el modo DEMO no puede quedar activo por accidente en la versión pública.

### Verificación después de desplegar

- `https://<backend>/docs` y `/openapi.json` responden 404.
- `https://<backend>/api/ai/status` sin sesión responde 401.
- La respuesta de la página incluye `Content-Security-Policy`.
- Ingresar con un código de prueba, perfilar un CSV sintético y cerrar sesión.
