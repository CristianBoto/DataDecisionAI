# Despliegue e instalación — DataDecision AI

DataDecision AI se usa de dos formas con **el mismo código**:

| Modalidad | Qué se publica | Para quién | Estado |
|-----------|----------------|------------|--------|
| **A. Demo pública** | Solo el frontend en modo DEMO (Cloudflare Pages, gratis) | Cualquier persona que quiera conocer la herramienta | ✅ Lista para publicar |
| **B. Instalación privada** | Frontend + backend FastAPI en una computadora o servidor interno | Una empresa u organización, con sus propios datos | 🟡 Documentada; el backend todavía es un esqueleto |

---

## A. Demo pública en Cloudflare Pages

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

> **Importante:** hoy el backend solo responde `/api/health`. Esta sección describe cómo se instalará cuando estén implementadas las etapas de [NEXT_STEPS.md](NEXT_STEPS.md). **La aplicación todavía no garantiza confidencialidad empresarial**: ver "Controles de seguridad pendientes".

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
| Autenticación de usuarios y permisos | ❌ Pendiente |
| HTTPS en la red interna | ❌ Pendiente (configuración del servidor) |
| Cifrado de archivos y base de datos en reposo | ❌ Pendiente |
| Políticas de retención y borrado de datasets | ❌ Pendiente |
| Registro de auditoría (quién subió y analizó qué) | ❌ Pendiente |
| Validación de contenido de archivos (fórmulas maliciosas, tamaño, codificación) | 🟡 Solo validación preliminar en el frontend |
| Control de qué datos se envían a OpenAI y consentimiento explícito | ❌ Pendiente |
| Copias de seguridad de SQLite | ❌ Pendiente |
| Límites de uso y tiempos de espera de la IA | ❌ Pendiente |

Ya existe: secretos fuera del repositorio (`.env` ignorado), clave de OpenAI prevista solo en el backend, CORS restringido por configuración y sin almacenamiento de archivos en el navegador.
