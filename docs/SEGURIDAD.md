# Seguridad y privacidad — DataDecision AI

> **Estado:** DataDecision AI es un MVP académico. Tiene protecciones básicas, pero **no ofrece todavía seguridad ni confidencialidad de nivel empresarial**. No debe usarse con datos confidenciales hasta implementar los controles de la sección 5.

## 1. Protecciones básicas existentes

**Frontend**

- Validación previa de archivos: solo CSV y XLSX; rechaza PDF, archivos vacíos y archivos de más de 25 MB.
- No guarda archivos ni datos en `localStorage`; el estado vive en memoria y se borra al recargar la página.
- No contiene claves: todas las variables `VITE_*` son públicas y solo guardan configuración.
- En la demo pública no se envía ningún archivo por la red (verificado con pruebas; ver [PRUEBAS_Y_VALIDACIONES.md](PRUEBAS_Y_VALIDACIONES.md)).
- Avisos visibles: datos ficticios, funciones que requieren backend y la indicación de no cargar datos confidenciales.

**Backend**

- CORS limitado a una lista explícita de orígenes (`CORS_ORIGINS`), sin credenciales.
- Lectura del archivo por fragmentos, con corte a los 25 MB (HTTP 413). **Aclaración (auditoría, sección 6):** el corte ocurre después de que el servidor recibió la solicitud completa.
- Límites de 250.000 filas y 250 columnas; límite de 60 MB descomprimidos para XLSX (protección ante archivos comprimidos maliciosos).
- Rechazo de extensiones no admitidas, archivos vacíos, XLSX dañados y CSV con caracteres nulos (HTTP 422, mensajes sin rutas internas).
- Lectura de todas las celdas **como texto**: no se evalúan fórmulas ni se convierten tipos automáticamente.
- El archivo **no se persiste**: se procesa en memoria y no se eliminan duplicados ni se rellenan vacíos. **Aclaración (auditoría, sección 6):** los archivos de más de 1 MB pasan por un archivo temporal del sistema durante la solicitud, que se elimina al terminar.

**Repositorio**

- `.gitignore` excluye `.env`, claves (`*.pem`, `*.key`), datos de usuario (`backend/data/`, `backend/uploads/`) y archivos generados.
- Solo se versionan `.env.example` sin secretos. `OPENAI_API_KEY` no tiene valor por defecto (cubierto por una prueba).

## 2. Cómo funciona el procesamiento local

| Modalidad | Dónde se procesa el archivo | ¿Sale del equipo o de la red? |
|-----------|-----------------------------|-------------------------------|
| Demo pública (`VITE_DEMO_MODE=true`) | En el navegador del visitante (vista previa de CSV) | No |
| Ejecución local con perfilado (`VITE_BACKEND_PROFILING=true`) | En FastAPI + Pandas, en la misma computadora (`127.0.0.1:8000`) | No sale del equipo |
| Instalación privada (planificada) | En el servidor interno de la organización | Solo dentro de la red interna |

En ningún caso actual se envían datos a servicios externos.

## 3. Minimización de datos con OpenAI (política decidida, pendiente de implementación)

> ⚠️ **Esta política está decidida pero todavía no está implementada ni validada.** Hoy no existe integración con OpenAI, así que no se envía nada; cuando se integre, estas reglas deberán programarse y probarse antes de considerarse una protección.

**Principio.** Python y Pandas procesan el dataset en el entorno correspondiente (el navegador en la demo, o el backend local o interno). OpenAI recibe únicamente la información **mínima, necesaria y autorizada** para comprender objetivos, planificar análisis o interpretar resultados.

OpenAI sería **opcional**: desactivado por defecto y habilitado solo con una clave propia en `backend/.env`. La clave nunca llegaría al frontend.

| Podría enviarse (mínimo necesario) | No se envía por defecto |
|------------------------------------|-------------------------|
| Nombres y tipos de columna, cantidad de filas, vacíos y duplicados | El archivo completo |
| Mensajes que la persona escribe al asistente | Filas originales |
| Resultados **agregados** calculados por Pandas (sumas, promedios, conteos) | Valores de ejemplo (`examples`) y vistas previas (`preview`) |
| | Claves, rutas del servidor u otros datos de configuración |

**Reglas de la política**

1. **Minimización por defecto:** el backend arma un resumen filtrado; `examples` y `preview` del perfil actual (que son **datos reales**) se excluyen.
2. **Autorización explícita:** si la información que se pretende enviar puede ser confidencial (por ejemplo, nombres de categorías, valores puntuales o nombres de columnas sensibles), el sistema debe mostrar qué se enviará y pedir autorización antes de hacerlo.
3. **Planes estructurados, no código:** la IA propone planes de análisis estructurados (operaciones de un catálogo cerrado sobre columnas existentes) que Pandas ejecuta y valida. **La IA no puede modificar ni generar libremente el código del backend**, ni se ejecuta código producido por ella.

**Pendiente para implementarla:** función de minimización con pruebas que verifiquen que filas, ejemplos y vistas previas nunca salen; pantalla de autorización; opción para ocultar columnas; registro de lo enviado; validación del plan contra un esquema cerrado.

## 4. Ollama como alternativa de IA local

Ollama permite ejecutar modelos de lenguaje abiertos en el propio equipo o servidor. Para DataDecision AI tiene tres ventajas:

- **Privacidad:** ni el perfil ni los mensajes salen de la organización.
- **Sin costo por uso y sin cuenta externa.**
- **Funciona sin Internet**, en línea con la arquitectura local-first.

Las contras: requiere más memoria y procesamiento, y los modelos locales suelen ser menos precisos, por lo que la validación de la IA contra los cálculos de Pandas sigue siendo obligatoria. **Todavía no está implementado.**

## 5. Controles de seguridad empresarial pendientes

| Control | Estado |
|---------|--------|
| Autenticación de usuarios (contraseña con hash) y roles | ❌ Pendiente |
| HTTPS en la red interna o pública | ❌ Pendiente |
| Límite de solicitudes por usuario y protección ante abuso | ❌ Pendiente |
| Ocultar la documentación interactiva (`/docs`) fuera de desarrollo | ❌ Pendiente |
| Cifrado de los datos guardados (cuando exista persistencia) | ❌ Pendiente |
| Política de retención y borrado de datasets y resultados | ❌ Pendiente |
| Registro de auditoría (quién cargó, analizó y exportó) | ❌ Pendiente |
| Minimización de datos y autorización explícita antes de enviar información a OpenAI (sección 3) | ❌ Política decidida; implementación pendiente |
| Protección contra fórmulas en exportaciones a Excel/CSV (`=`, `+`, `-`, `@`) | ❌ Pendiente (aún no hay exportación) |
| Pruebas de seguridad automatizadas | ❌ Pendiente |

Plan de trabajo detallado en [NEXT_STEPS.md](NEXT_STEPS.md) (tareas 12 a 15) y [DEPLOYMENT.md](DEPLOYMENT.md).

## 6. Auditoría de privacidad, seguridad y flujo de datos (24/10/2026, durante la Fase 3A)

Auditoría acotada sobre el código real, antes de integrar OpenAI. Cada conclusión indica su evidencia; las comprobaciones usaron **solo datos sintéticos** (incluido un archivo `clientes_confidencial.csv` inventado) y ningún servicio externo. Detalle de las ejecuciones en [PRUEBAS_Y_VALIDACIONES.md](PRUEBAS_Y_VALIDACIONES.md), sección 11.

**Clasificación:** ✅ control implementado y verificado · 🟡 control parcial · 🔴 riesgo o defecto detectado · 🔒 pendiente antes de OpenAI · 🔭 mejora futura fuera del alcance del MVP.

### 6.1 Flujo de datos real

```
Archivo elegido (File, en memoria del navegador)
  ├─ Demo pública (VITE_BACKEND_PROFILING sin definir):
  │    CSV: se leen como máximo los primeros 2 MB (csv.ts:247, 262-263) → perfil local
  │    XLSX: no se lee; perfil vacío ("pendiente de backend")
  │    → sin solicitudes de red
  └─ Perfilado local (VITE_BACKEND_PROFILING=true):
       POST multipart, campo "file", un archivo por vez (backendProfile.ts:112-117)
       → FastAPI 127.0.0.1 → Starlette lo recibe completo (≤1 MB en memoria, >1 MB en archivo temporal)
       → Pandas en memoria → JSON (conteos, tipos, 3 ejemplos y 5 primeras filas por archivo) → navegador
Perfil → sesión de React (sources[]) y mapas del proveedor DEMO → pantallas
```

| # | Hallazgo | Evidencia | Clase |
|---|----------|-----------|-------|
| F1 | Un único punto del frontend realiza solicitudes de red: `fetch` en `httpClient.ts:50`. Solo se instancia si `VITE_DEMO_MODE=false` o `VITE_BACKEND_PROFILING=true` (`services/index.ts:12-17`). | Búsqueda de `fetch`, `XMLHttpRequest`, `sendBeacon`, `WebSocket` en `src/` | ✅ |
| F2 | Sin persistencia en el navegador: no se usan `localStorage`, `sessionStorage`, `IndexedDB`, cookies, Cache Storage ni service workers. | Búsqueda en `src/`; en el navegador, tras cargar, quitar y reemplazar 3 archivos: todos vacíos | ✅ |
| F3 | Demo pública: **0 solicitudes** al cargar 3 archivos, quitar uno, reemplazar otro y continuar al asistente; solo se descargaron recursos propios (JS, CSS, fuente). | Instrumentación de `fetch`/XHR/`sendBeacon`/`WebSocket` + registro de red del navegador sobre la build pública | ✅ |
| F4 | Perfilado local: exactamente **una POST por archivo**, secuenciales, solo al backend configurado, con un único campo `file`. | Instrumentación de `fetch` con 2 archivos | ✅ |
| F5 | Sin telemetría ni analítica: la build no incluye URLs externas salvo textos de librerías (documentación, espacios de nombres XML); la demo publicada no tiene scripts inyectados (`cloudflareinsights`, Zaraz, GTM). Las fuentes tipográficas se sirven localmente. | Análisis de `dist/` y del HTML de https://datadecisionai.pages.dev | ✅ |
| F6 | Al recargar o cerrar la pestaña se pierde todo (estado solo en memoria). La URL contiene solo la ruta: nunca nombres de archivo ni datos. | Recarga en `/analisis/asistente`: "Primero cargá un dataset"; ningún dato en el DOM | ✅ |
| F7 | Al **quitar o reemplazar** una fuente, la sesión la descarta (`AppProviders.tsx:26-34`), pero el proveedor DEMO conserva su `Dataset` y su perfil (con ejemplos y primeras filas) en sus mapas hasta recargar: no existe ningún `.delete()` (`demoProvider.ts:62-63, 128-129`). No sale del navegador, pero contradice la expectativa de "quitar". | Lectura de código | 🔴 menor |
| F8 | El frontend conserva por archivo: nombre, tamaño, fecha, formato y el perfil (conteos, tipos, interpretación, hasta 3 ejemplos por columna y 5-8 primeras filas). El objeto `File` no se guarda en el estado. | `SourceList.tsx` (`UploadItem`), `csv.ts:132, 217`, `backendProfile.ts:91-96` | ✅ (documentado) |
| F9 | Una build hecha a mano con un `.env.local` que active `VITE_BACKEND_PROFILING` llevaría esa opción a la demo publicada. Cloudflare compila desde git, donde `.env.local` está excluido. | `.gitignore` (`*.local`); variables `VITE_*` se fijan en la compilación | 🟡 |
| F10 | La demo publicada no envía `Content-Security-Policy`; sí `nosniff` y `Referrer-Policy`. Un CSP `connect-src 'self'` haría cumplir técnicamente "sin envío de datos" aunque se introdujera un error en el código. | Cabeceras de https://datadecisionai.pages.dev | 🔭 (recomendado) |

### 6.2 Backend (`POST /api/datasets/profile`)

| # | Hallazgo | Evidencia | Clase |
|---|----------|-----------|-------|
| B1 | Validaciones: extensión `.csv`/`.xlsx`, vacío, 25 MB, CSV con caracteres nulos, XLSX que no es ZIP o está dañado, 60 MB descomprimidos, 250.000 filas, 250 columnas; mensajes en español sin rutas internas. | `dataset_profiler.py:17-20, 31-40, 65-81, 116`; 26 pruebas | ✅ |
| B2 | Todo se lee **como texto** (`dtype=str`); Excel se abre con `data_only=True` y `keep_links=False` (no evalúa fórmulas ni sigue vínculos externos). Python 3.12 incluye expat 2.6.4, con protección ante expansión de entidades XML. | `dataset_profiler.py:50, 81`; `pandas/io/excel/_openpyxl.py:571` | ✅ |
| B3 | **Archivos temporales:** Starlette guarda en memoria hasta 1 MB y, por encima, escribe el archivo subido en un **archivo temporal del sistema**, que se elimina al cerrarse (`finally: await file.close()`). Por lo tanto, "no se guarda" significa *no se persiste*, pero sí existe una copia transitoria en disco durante la solicitud. | `starlette/formparsers.py:135, 218`; prueba: 8 KB en memoria, 3,2 MB y 40 MB volcados a disco y cerrados | 🟡 |
| B4 | **Sin límite de tamaño antes de recibir:** la solicitud se recibe completa antes de ejecutar el endpoint; el corte de 25 MB ocurre después. Un archivo de 40 MB se escribió entero en el temporal antes del HTTP 413. | Prueba con 40 MB | 🔴 |
| B5 | **Memoria y bloqueo:** los límites de filas y columnas se comprueban **después** de construir el DataFrame. Un CSV adversario de 24,8 MB (12,4 millones de celdas de un carácter, dentro de los límites) consumió ≈ 409 MB de memoria Python y 37,8 s. Como el endpoint es `async def` y llama a Pandas de forma síncrona, durante ese tiempo el servidor no atiende otras solicitudes. | `datasets.py:15, 26`; `dataset_profiler.py:116`; prueba con `tracemalloc` | 🔴 |
| B6 | **CORS no es control de acceso:** bloquea que otro sitio *lea* la respuesta, pero una POST `multipart` es una solicitud "simple" sin verificación previa: el backend la **procesa** igual. Una página externa abierta en el mismo equipo podría hacer trabajar al backend local (por ejemplo, con el archivo de B5), sin poder leer el resultado. | Prueba: origen externo → HTTP 200 sin `Access-Control-Allow-Origin` | 🟡 |
| B7 | Exposición: uvicorn escucha en `127.0.0.1` por defecto y así lo indican las guías; `/docs` y `/openapi.json` están disponibles. Sin autenticación: no debe exponerse en una red. | `README.md:125`, `DEPLOYMENT.md:131`; `/docs` → 200 | 🟡 (proporcional al MVP) |
| B8 | Registros: el código no registra nada; uvicorn registra IP, método, ruta y estado, **sin** nombres de archivo ni contenido. Los errores devueltos no incluyen datos. | Búsqueda de `logging`/`print` en `app/`; registro del servidor durante la prueba | ✅ |
| B9 | Varias cargas: cada solicitud es independiente y no comparte estado (3 pruebas). Sin límite de solicitudes simultáneas; el frontend las envía de a una. | `test_multiple_sources.py`; F4 | 🟡 |
| B10 | Inyección de fórmulas (`=CMD…`): los valores se devuelven como texto y React los muestra escapados; el riesgo aparecerá recién al **exportar** a Excel/CSV. | Interfaz de exportación sin generación | 🔭 (al implementar exportaciones) |

### 6.3 Contexto para la futura IA (`datasetCatalog.ts` y estructuras relacionadas)

No alcanza con que el catálogo no tenga filas: **nombres de archivo y de columnas, esquemas, preguntas del usuario y estadísticas agregadas también pueden ser confidenciales** (por ejemplo, un archivo `despidos_2027.csv`, una columna `diagnostico_vih` o un conteo que revela la cantidad de empleados).

| Campo | Dónde | Riesgo | ¿Enviar a OpenAI? |
|-------|-------|--------|-------------------|
| `fileName`, `Dataset.name` | catálogo, `Dataset` | Alto: suele describir el contenido o el cliente | **No.** Usar alias `A`, `B`, `C` |
| Nombres de columna | catálogo, perfil | Medio-alto: revelan qué se registra | Solo con autorización; ofrecer ocultar o renombrar columnas |
| `format`, `semanticType`, `semanticConfidence` | catálogo | Bajo | Sí, como mínimo necesario |
| `rowCount`, `columnCount`, `distinct`, `missing`, `suspectedMissing`, `completeness`, `duplicateRows` | catálogo | Medio: cifras del negocio | Por defecto, redondeadas o en rangos; exactas solo si el usuario lo autoriza |
| `sharedColumns`, `sameColumnSets` | catálogo | Igual que los nombres de columna | Con los nombres autorizados (o alias de columna) |
| `sampleValues`, `previewRows` | perfil (no catálogo) | **Alto: datos reales** | **Nunca** de forma automática |
| `semanticReason` | perfil | Medio: incluye rangos reales ("entre 2015 y 2024", `column_semantics.py:161-175`) | No |
| `issues` (mensajes) | perfil | Medio: nombres de columna y conteos | No |
| Nombre del proyecto, mensajes y objetivo del usuario | `Project`, conversación | Variable: pueden contener cualquier dato | Solo el mensaje concreto que el usuario envía, mostrando antes qué sale |
| Resultados agregados de Pandas | futuro | Medio | Solo los necesarios para interpretar, con autorización |

**Diseño requerido antes de OpenAI** (estado actualizado en la sección 9: puntos 1 a 4 implementados en la Fase 3B.1; 5 y 6 pendientes):

1. **Denegar por defecto.** `AI_ENABLED=false` en `backend/.env`; sin clave o sin esa opción, ningún dato sale.
2. **La clave solo en el backend.** `OPENAI_API_KEY` en `backend/.env` (`config.py:28`, sin valor por defecto, con prueba); el frontend nunca llama a OpenAI ni recibe la clave; ninguna variable `VITE_*` contiene secretos.
3. **El backend arma el contenido a enviar**, a partir de una lista blanca de campos (modelo Pydantic con `extra="forbid"`): nunca reenvía lo que mande el navegador.
4. **Autorización explícita por transmisión:** antes de cada envío, la interfaz muestra el contenido exacto (JSON legible) y el usuario lo aprueba; la aprobación no se extiende a envíos posteriores. Opciones para ocultar columnas o usar alias.
5. **Registro local** de cada envío (fecha, campos y tamaño; no el contenido completo).
6. **Salida estructurada:** la IA devuelve un plan (operaciones de un catálogo cerrado sobre columnas existentes), validado con un esquema; nunca código. **No se ejecuta código generado por la IA** ni puede modificar el backend.

### 6.4 Por qué separar los cálculos de Pandas de la interpretación del modelo de lenguaje

- **Exactitud:** un modelo de lenguaje predice texto; puede producir números plausibles pero incorrectos. Pandas calcula de forma determinista y reproducible.
- **Verificabilidad:** cada cifra puede rastrearse hasta una operación de Pandas sobre columnas concretas y probarse con datos sintéticos de resultado conocido.
- **Privacidad:** si la IA solo planifica e interpreta, no necesita las filas; el cálculo ocurre donde están los datos.
- **Seguridad:** ejecutar código generado por un modelo permitiría acciones no previstas (leer archivos, llamar a la red). Un catálogo cerrado de operaciones acota lo que puede pasar.
- **Responsabilidad:** el usuario aprueba un plan comprensible antes de que se calcule nada.

### 6.5 Correcciones propuestas (no implementadas)

| Prioridad | Corrección mínima | Resuelve |
|-----------|-------------------|----------|
| ✅ Implementado (sección 7) | Rechazar en un *middleware* las solicitudes a `/api/datasets/profile` con `Content-Length` mayor a ~26 MB, cortar la lectura real al superar el límite y rechazar un `Origin` que no esté en `CORS_ORIGINS`, antes de leer el cuerpo. | B4, B6 |
| 🟡 Implementado, mitigación parcial (sección 7) | Límite de celdas calculado **antes** de Pandas; perfilado fuera del bucle de eventos; concurrencia limitada. | B5 |
| ✅ Implementado (sección 7) | Método `discardDataset(id)`, invocado al quitar o reemplazar una fuente. | F7 |
| 🔒 Antes de OpenAI | Los 6 puntos de 6.3. | 6.3 |
| 🔭 Futuro | CSP en Cloudflare (`frontend/public/_headers` con `connect-src 'self'`); autenticación y HTTPS si se expone en red; límite de solicitudes; neutralizar fórmulas al exportar. | F10, B7, B10 |

## 7. Endurecimiento mínimo de la carga (B4, B5, B6, F7)

Corrige los hallazgos de la sección 6 con controles proporcionales a un MVP académico. Pruebas en [PRUEBAS_Y_VALIDACIONES.md](PRUEBAS_Y_VALIDACIONES.md), sección 12.

| Hallazgo | Riesgo | Solución elegida y fundamento | Prueba | Estado |
|----------|--------|-------------------------------|--------|--------|
| **B4** Límite de tamaño tardío | Disco y ancho de banda: el servidor aceptaba y escribía en un temporal cualquier tamaño antes de rechazarlo | *Middleware* ASGI (`app/core/upload_guard.py`) en la ruta de carga: 413 inmediato si `Content-Length` supera 26 MB (25 MB + 1 MB de margen para multipart); además cuenta los **bytes reales** recibidos y corta la lectura al superar el límite aunque el encabezado falte o mienta. Starlette cierra y borra el temporal parcial. Encabezado inválido → 400. | 413 sin leer el cuerpo; 40 MB por fragmentos sin `Content-Length` y con `Content-Length` falso → 413 tras leer ≤ 27 MB y temporal cerrado; archivo válido de 24 MB aceptado; servidor real: 413 en 0,7 s | ✅ |
| **B5** Memoria y bloqueo | Un CSV de 25 MB con 12,4 M celdas usaba ≈ 409 MB y bloqueaba el servidor 37,8 s | (1) **Límite de celdas** (5 M; SIACAM ≈ 0,8 M) además de filas y columnas, verificado **antes** de Pandas: en CSV con `csv.reader` incremental (o una cota rápida por cantidad de líneas); en XLSX contando filas por flujo con `openpyxl` en solo lectura. (2) XLSX: se descomprime **de verdad** con tope de 60 MB (no se confía en los tamaños declarados) y máximo 1.000 componentes. (3) Pandas corre en un **hilo** (`run_in_threadpool`), no en el bucle de eventos. (4) Máximo **2 perfilados simultáneos**; el exceso recibe 429 (sin colas). | Caso adversario rechazado en 0,6 s sin llamar a Pandas; filas/columnas/celdas en CSV y XLSX; bomba ZIP de 5 MB comprimida en pocos KB; saltos de línea entre comillas sin falsos rechazos; perfilado fuera del bucle; 429 y liberación del contador; servidor real: `/api/health` respondió durante un perfilado de 8 s (máx. 481 ms) | 🟡 mitigado, no eliminado |
| **B6** Origen no controlado | Una página externa podía hacer procesar archivos al backend local | El mismo *middleware* rechaza con 403, **antes de leer el cuerpo**, toda carga con `Origin` fuera de `CORS_ORIGINS` (incluido `null`). Sin `Origin` (curl, pruebas) se permite. Se agregó el puerto 5174 a los orígenes locales por defecto. Va dentro de CORS para que sus errores sean legibles por el frontend autorizado. | 403 para externo, `null` y puerto no autorizado sin ejecutar el perfilado ni leer el cuerpo; 200 sin `Origin`; otras rutas no afectadas; servidor real: `Origin: null` → 403 | ✅ (no es autenticación) |
| **F7** Fuentes retenidas en memoria | Perfiles con ejemplos y primeras filas quedaban en memoria tras quitarlos | `discardDataset(id)` en el contrato del servicio: el proveedor DEMO borra el dataset y su perfil al **quitar**, **reemplazar** o **empezar de nuevo**; no libera los que usa un proyecto ya creado. El proveedor HTTP no tiene nada que liberar (el backend no guarda). | Liberación efectiva (el perfil deja de existir); otras fuentes intactas; reemplazo fallido no libera nada; dataset en uso por un proyecto se conserva | ✅ |

**Riesgos residuales (no eliminados):**

- **Recursos:** el peor archivo aceptado (≈ 5 M celdas) tarda ≈ 8 s y usa ≈ 180 MB de memoria Python trazada; con 2 perfilados simultáneos, ≈ 2 veces eso. Es una **mitigación**: un usuario local puede seguir ocupando el servidor con cargas repetidas dentro de los límites.
- **Archivo temporal (B3):** las cargas válidas de más de 1 MB siguen pasando por un archivo temporal del sistema durante la solicitud (hasta ≈ 26 MB), que se elimina al terminar.
- **Origen:** el control depende del encabezado `Origin` que envían los navegadores; un programa local puede omitirlo. Por eso no es autenticación.
- **Pandas y openpyxl** siguen siendo responsables de leer el contenido; los límites acotan el tamaño, no garantizan la ausencia de fallas en esas librerías.
- **Concurrencia:** el contador vale por proceso; con varios procesos de uvicorn el límite se multiplica.

**Controles dejados fuera deliberadamente (proporcionalidad del MVP):** autenticación y HTTPS (la API escucha solo en `127.0.0.1`), límite de solicitudes por cliente, colas de trabajo, cuotas de memoria del proceso, aislamiento en contenedores, antivirus de archivos y CSP en la demo publicada (recomendado como mejora).


## 8. Estado de seguridad al cierre de la Fase 3A

**Controles vigentes (implementados y con pruebas automáticas):**

| Control | Dónde |
|---------|-------|
| Rechazo temprano de cargas excesivas por `Content-Length` y por bytes reales recibidos | `app/core/upload_guard.py` |
| Restricción del `Origin` en las cargas desde el navegador (incluido `null`) | `app/core/upload_guard.py`, `CORS_ORIGINS` |
| Límites de 250.000 filas, 250 columnas y 5.000.000 de celdas antes de Pandas | `app/services/dataset_profiler.py` |
| XLSX: descompresión real con tope, máximo de componentes y conteo por flujo | `app/services/dataset_profiler.py` |
| Perfilado fuera del bucle de eventos y máximo 2 simultáneos por proceso | `app/api/routes/datasets.py` |
| Liberación de datasets quitados o reemplazados en el proveedor DEMO | `frontend/src/services/demoProvider.ts` |
| Exclusión de `.env`, `.env.local`, claves, datos y archivos generados | `.gitignore` |

Estos controles **no interfirieron** con archivos válidos: SIACAM (102.254 × 8) e indicadores provinciales (15.874 × 14) se procesaron correctamente según la validación manual del autor (PRUEBAS, sección 13), y un dataset sintético tipo SIACAM mantiene su tiempo de perfilado (≈ 2,1 s).

**Incidencia intermitente de CORS (🗣️ comunicada por el autor, causa no confirmada).** Durante las pruebas locales el navegador informó errores de CORS desde `http://localhost:5174` hacia `http://127.0.0.1:8000/api/datasets/profile`. Luego el autor verificó: `GET /api/health` → 200; `OPTIONS` con `Origin: http://localhost:5174` → 200 con `Access-Control-Allow-Origin` correcto; `POST` sin archivo → 422 con cabecera CORS; `POST` con SIACAM desde curl → 200 con cabecera CORS; y cargas posteriores desde React exitosas con ambos archivos.

La causa **no fue confirmada** y la incidencia **no se declara resuelta**. Hipótesis sin verificar, útiles para un próximo diagnóstico: (a) el backend no estaba en ejecución o se estaba reiniciando (`--reload`) en ese momento; (b) un error no controlado (500) se responde fuera de la capa CORS y el navegador lo muestra como error de CORS; (c) caché del navegador o un servidor anterior todavía en el puerto. Si se repite, conviene registrar en ese momento la consola de uvicorn y la pestaña Red del navegador (código de estado real). No se modificaron CORS ni los middlewares de forma especulativa.

**Límites que permanecen (aceptados en el MVP):**

- No existe autenticación de usuarios.
- CORS y la validación de `Origin` **no equivalen a autenticación**.
- Los archivos válidos de más de 1 MB pueden pasar por almacenamiento temporal durante la solicitud.
- Los controles de memoria **mitigan** el agotamiento de recursos, pero no lo eliminan.
- La demo pública (solo navegador, sin red) y el backend local (recibe archivos) tienen **alcances distintos**.
- La frontera de transmisión de datos a OpenAI **todavía no está implementada** (requisitos en la sección 6.3).

DataDecision AI es un MVP académico: **no es una solución empresarial certificada ni un sistema libre de vulnerabilidades.**


## 9. Frontera de privacidad para la IA (Fase 3B.1)

> **Actualización (Fase 3B.2):** la conexión real con OpenAI ya está implementada detrás de esta misma frontera. Las referencias a "sin llamadas externas" describen la Fase 3B.1. Ver la sección 10.

**Decisión central: Python/Pandas calcula; OpenAI interpretará objetivos y propondrá planes; el usuario confirma.** Esta fase prepara **qué** podría salir del sistema y **cómo** se autoriza, **sin ninguna llamada real a OpenAI**.

**Dónde llega el JSON en esta fase.** El contexto revisado **sí viaja al backend FastAPI local** (`POST /api/ai/requests`) para que lo valide la lista blanca; **no sale hacia ningún proveedor externo**: no hay SDK, URL ni llamada a OpenAI en el código, y el proveedor de esta fase no tiene red.

**Los metadatos también son datos.** Los nombres de columna y el objetivo escrito por el usuario pueden contener información sensible (por ejemplo, `diagnostico_medico` o "despidos de la planta Norte"). El backend valida su **forma**, no su **significado**: por eso el panel permite ocultarlos o editarlos y exige revisarlos antes de cada autorización. El sistema **no garantiza privacidad absoluta**; reduce y hace visible lo que podría compartirse.

**Por qué estas tres decisiones.**

- **Autorización individual** (una solicitud, 5 minutos, contenido exacto por huella SHA-256): una autorización general e indefinida dejaría de reflejar lo que la persona vio; si el contenido cambia, la decisión debe volver a tomarse.
- **Minimización de metadatos** (alias en lugar de archivos, columnas elegibles y renombrables, tamaño solo por rango): la IA necesita la *estructura* para proponer un plan, no los registros ni las cifras exactas; compartir menos reduce lo que podría filtrarse.
- **Validación en el backend** (lista blanca Pydantic): las comprobaciones de React se pueden saltear modificando el navegador; el backend es la última puerta antes de cualquier proveedor y no acepta nada fuera de lo permitido.

### Qué puede compartirse (solo después de revisarlo y autorizarlo)

| Dato | Condición |
|------|-----------|
| Alias de las fuentes (`A`, `B`, `C`) | Siempre en lugar del nombre del archivo |
| Nombres de columna | Revisados por el usuario: puede ocultar cada columna o renombrarla |
| Formato e interpretación estimada (y su confianza) | Por columna incluida |
| Objetivo escrito por el usuario | Mostrado y editable antes de validar |
| Rango de tamaño (`<1k`, `1k-10k`, `10k-100k`, `100k-1M`, `>1M`) | Solo si el usuario lo marca; nunca la cantidad exacta |

### Qué está restringido (el backend lo rechaza con 422)

Archivos CSV/XLSX, nombres de archivo, filas, vistas previas, ejemplos, valores individuales, conteos exactos, completitud, valores distintos, motivos de interpretación y observaciones. La restricción es una **lista blanca** (`backend/app/schemas/ai_context.py`, `extra="forbid"`): no depende de que el navegador "se porte bien".

### Controles implementados

| Control | Dónde |
|---------|-------|
| Lista blanca del contexto, máximo 3 fuentes con alias únicos, 250 columnas y 2.000 caracteres de objetivo | `app/schemas/ai_context.py` |
| **Denegado por defecto** (`AI_ENABLED=false`); si está deshabilitado, la solicitud se descarta (no queda una autorización guardada) | `app/core/config.py`, `app/services/ai_gateway.py` |
| Preparar → revisar → autorizar: la autorización vale para **una** solicitud, **5 minutos**, y solo para el contenido exacto mostrado (huella SHA-256 del JSON canónico) | `app/services/ai_gateway.py` |
| Cualquier edición posterior invalida la solicitud preparada | `frontend/src/components/ai/AIContextReview.tsx` |
| Máximo 20 solicitudes pendientes por proceso | `app/services/ai_gateway.py` |
| Proveedor sin red en esta fase: responde 501 "No se envió nada" | `NotImplementedProvider` |
| `OPENAI_API_KEY` solo en `backend/.env`; `/api/ai/status` informa si hay clave, **nunca su valor**; ninguna variable `VITE_*` | `app/api/routes/ai.py`, `.env.example` |
| Mismo control de `Origin` que las cargas y cuerpo máximo de 64 KB en `/api/ai/*` (POST y DELETE) | `app/main.py`, `app/core/upload_guard.py` |
| No se registra el contenido de las solicitudes | Prueba con captura de registros |
| Demo pública aislada: sin cliente de la frontera | `frontend/src/services/aiGateway.ts` |

### Limitaciones (aceptadas en esta fase)

- **El backend no puede saber si un nombre de columna o el objetivo es confidencial**: valida la estructura, no el significado. La protección de esos textos depende de la revisión del usuario.
- **La autorización no es autenticación:** cualquier persona con acceso al equipo y al navegador autorizado puede autorizar.
- Las solicitudes preparadas viven en la memoria del proceso: se pierden al reiniciar y no se comparten entre procesos.
- **Pendiente para la Fase 3B.2:** registro local de envíos (metadatos, sin contenido) y validación estructurada de la respuesta de la IA (plan con operaciones de un catálogo cerrado y solo columnas autorizadas). La IA no podrá ejecutar Python, modificar el backend ni alterar archivos originales.


## 10. Integración con OpenAI (Fase 3B.2)

**Qué cambia.** El proveedor sin red se reemplazó por `OpenAIProvider` (SDK oficial `openai` 3.37.0, Responses API con salida estructurada). Solo se invoca desde `authorize_and_send`, en este orden:
1. IA habilitada.
2. Autorización de uso único válida (huella, vencimiento).
3. Clave configurada.
4. Precio del modelo conocido.
5. Contexto dentro del límite.
6. Presupuesto reservado.
7. Envío.
8. Validación de la respuesta.

**Qué NO cambia.** La lista blanca del contexto, los alias A/B/C, la exclusión de archivos, filas, ejemplos, valores y nombres de archivo, la autorización por mensaje y el control de `Origin`. La revisión confirmada **no** autoriza envíos: en el paso 2 ya no hay botones para validar ni autorizar.

**Qué se agrega al contexto.**
- `history`: los turnos anteriores con la IA real, como máximo 8. Son textos que el usuario ya vio, y forman parte del contenido que se revisa y se aprueba (cambian la huella).
- El primer mensaje igual al objetivo **no se envía dos veces**: `message` queda vacío.

### Controles de consumo (aplicados en el backend)

| Control | Dónde | Valor por defecto |
|---------|-------|-------------------|
| IA deshabilitada salvo configuración explícita | `AI_ENABLED` | `false` |
| Clave solo en el backend; nunca en `VITE_*`, respuestas, registros ni Git | `OPENAI_API_KEY` en `backend/.env` (excluido de Git) | vacía |
| Modelo configurable | `OPENAI_MODEL` | `gpt-6-luna` |
| Razonamiento acotado (sus tokens se cobran como salida) | `OPENAI_REASONING_EFFORT` | `low` |
| Límite de tokens de salida por solicitud | `AI_MAX_OUTPUT_TOKENS` | 2.500 |
| Límite de tamaño del contexto (estimado antes de enviar; 413 si se supera) | `AI_MAX_INPUT_TOKENS` | 8.000 |
| Tiempo máximo de espera, **sin reintentos automáticos** (`max_retries=0`) | `AI_TIMEOUT_SECONDS` | 40 s |
| Límite de solicitudes por sesión del servidor (429) | `AI_MAX_REQUESTS_PER_SESSION` | 25 |
| Presupuesto local acumulado; bloqueo preventivo si no alcanza (402) | `AI_BUDGET_USD` | USD 1,00 |
| Registro del consumo real (tokens y costo, sin contenido) | `AI_USAGE_FILE` (en `backend/data/`, excluido de Git) | `./data/ai_usage.json` |
| `store=False`: se pide al proveedor no conservar la respuesta para reutilizarla | `app/services/openai_provider.py` | — |

- **Estimación previa:** se estiman los tokens de entrada (instrucciones + contexto + esquema, a razón de 3 caracteres por token, de forma conservadora) y el costo máximo con la salida máxima permitida. Se muestran antes de autorizar.
- **Reserva:** antes de enviar se reserva ese máximo. Si `gastado + reservado + estimado` supera el presupuesto, no se envía (402).
- **Consumo real:** después de la respuesta se registran los tokens que informa OpenAI y su costo. Si la solicitud pudo haberse cobrado sin respuesta (tiempo agotado o error del servidor), se registra el **máximo estimado**, marcado como estimación. Un error de conexión previo al envío no registra costo.
- **Persistencia:** el presupuesto se acumula entre reinicios. Si el registro está dañado, se bloquean los envíos en lugar de asumir cero, y el archivo no se sobrescribe.
- **El presupuesto de OpenAI Platform no sustituye estos controles internos** (ni viceversa): conviene configurar también un límite en la cuenta. Las estimaciones pueden diferir del consumo real.

**Elección del modelo.** `gpt-6-luna`, verificado el 25/10/2026 en la documentación oficial de OpenAI (página del modelo y de precios):
- descripción: el modelo más eficiente de la familia GPT-6;
- precio: USD 0,10 por millón de tokens de entrada (0,01 en caché) y USD 0,50 de salida, para contextos de hasta 272.000 tokens;
- compatible con la Responses API y Structured Outputs.

Si se cambia de modelo y no figura en la tabla interna (`app/services/ai_budget.py`), hay que configurar su precio (`OPENAI_PRICE_INPUT_PER_1M` y `OPENAI_PRICE_OUTPUT_PER_1M`); sin precio, el backend no envía nada (503).

### Respuesta estructurada y validación

- **Esquema** (`app/schemas/ai_plan.py`): mensaje breve, objetivo interpretado, relación entre fuentes, preguntas, planes y advertencias. Cada plan incluye:
  - **una sola fuente**;
  - columnas necesarias;
  - operaciones de un **catálogo cerrado** (conteo, suma, promedio, mediana, serie temporal, ranking y otras);
  - tipos de gráfico permitidos;
  - limitaciones.
- **Validación en el backend:** la respuesta se descarta (502), y no se guarda ningún plan, si:
  - menciona alias o columnas no autorizados;
  - no trae preguntas ni planes;
  - supera las cantidades máximas;
  - contiene bloques de código.
- **Sin unir fuentes:** si la IA sugiere unir o concatenar fuentes, se agrega una advertencia, porque esa operación no está disponible en esta etapa.
- **Planes:** los planes válidos se guardan en la memoria del proceso. El usuario puede aprobarlos (`POST /api/ai/plans/{id}/approve`), pero **no se ejecuta ningún cálculo** en esta fase.
- **Seguridad:** el sistema **nunca ejecuta código** generado por el modelo.

### Errores comprensibles

Credenciales (502), cuota o saldo (429), límite temporal (429), modelo inexistente (502), conexión (502), tiempo agotado (504) y respuesta incompleta, rechazada o malformada (502). Los mensajes no incluyen la clave ni el contenido.

### Limitaciones

- **El control de `Origin` no es autenticación.** La API de IA está pensada solo para uso **local** (`127.0.0.1`). No debe publicarse: cualquiera con acceso al backend podría consumir el presupuesto.
- El límite por sesión se reinicia al reiniciar el backend; el presupuesto acumulado, no.
- Los tokens de entrada se estiman antes de enviar; el costo real puede ser menor o, en casos raros, mayor que la estimación.
- Los planes aprobados viven en memoria: se pierden al reiniciar el backend. Persistirlos queda para la etapa del motor de análisis.
- La calidad de las preguntas y los planes depende del modelo. Por eso se valida la **forma** y el uso de columnas autorizadas, no la pertinencia analítica: esa la juzga el usuario al aprobar.


### Autorización por conversación (Fase 3B.2)

- **Opcional y explícita.** La opción por defecto sigue siendo autorizar cada envío. En el primer envío, el panel ofrece «Autorizar solo este mensaje» y «Autorizar esta conversación», y explica qué se compartirá: cada mensaje nuevo, un historial limitado, el objetivo y los metadatos ya autorizados.
- **Controlada por el backend** (`AIConversationStore`):
  - identificador aleatorio;
  - huella SHA-256 de la frontera de privacidad (objetivo y metadatos, sin mensaje ni historial);
  - vencimiento de 30 minutos (`AI_CONVERSATION_TTL_MINUTES`);
  - máximo de 20 mensajes (`AI_CONVERSATION_MAX_MESSAGES`);
  - sin envíos simultáneos en la misma conversación.
- **Respuestas del backend:** sin permiso, 404; vencido, 410; frontera distinta, 409, y el permiso se elimina; tope alcanzado, 429; IA deshabilitada, 403, y el permiso se revoca.
- **Sin atajos de consumo.** Cada mensaje pasa por los mismos límites que un envío individual (tamaño del contexto, solicitudes por sesión, presupuesto con reserva previa) y por la misma validación de la respuesta. Una prueba con seis envíos simultáneos y presupuesto para cuatro confirma que solo se envían cuatro.
- **Sin llamadas automáticas.** Cada envío nace de «Enviar» o de «Comenzar conversación». No hay reintentos ni envíos en segundo plano.
- **Revocación:**
  - desde el asistente, con «Desactivar autorización de conversación»;
  - automática, al cambiar las fuentes o la revisión (se revoca también en el backend);
  - al vencer o al reiniciar el backend.
- **Limitaciones:**
  - el permiso vive en la memoria del proceso;
  - el control de `Origin` sigue sin ser autenticación: el backend con la IA habilitada debe usarse solo en el propio equipo;
  - el historial que se comparte son textos que el usuario ya vio, pero sale del equipo en cada mensaje autorizado.


## 11. Motor de análisis con Pandas (Fase 4A)

- **Sin código del modelo:** solo se ejecutan las funciones del catálogo (`OPERATIONS` en `analysis_engine.py`). No hay `eval`, `exec`, SQL ni texto del plan que se interprete como código.
- **Ningún dato va a OpenAI para calcular.** `POST /api/analysis/execute` no usa el proveedor de IA ni la autorización de envíos. Ejecutar un análisis y autorizar un envío a la IA son acciones separadas.
- **Planes del backend, no del navegador:** solo se ejecutan planes que el backend validó y que están aprobados (404 o 409 en otro caso).
- **Mismos límites que la carga:**
  - `Origin` autorizado;
  - 25 MB por archivo y 60 MB por pedido;
  - filas, columnas, celdas y descompresión de XLSX (con `read_dataset`);
  - una ejecución simultánea;
  - como máximo 500 filas por resultado.
- **Sin persistencia:** los archivos se procesan en memoria y se descartan; los originales no se modifican. El navegador guarda el `File` solo en memoria.
- **Demo pública:** sin motor, porque no tiene backend.
- **Limitación:** el control de `Origin` no es autenticación. El backend debe usarse solo en el propio equipo.


### Metadato `distinct_values` (Fase 4B.1)

Se agregó a la lista blanca del contexto un rango aproximado de valores distintos por columna (`1`, `2`, `3-10`, `11-50`, `51-500`, `>500`):
- se calcula en el navegador y aparece en el JSON que el usuario revisa antes de autorizar;
- no revela la cantidad exacta ni ningún valor;
- el backend rechaza cualquier otro valor (422).

El modo real ya no tiene respuestas simuladas: si la IA no está disponible, no hay respuestas de ningún tipo.
