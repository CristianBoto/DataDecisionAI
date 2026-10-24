# Pruebas y validaciones — DataDecision AI

Este documento separa tres tipos de evidencia:

| Marca | Significado |
|-------|-------------|
| ✅ **Verificada** | Ejecutada de nuevo el 24/10/2026 al redactar este documento, con el resultado registrado. |
| 📄 **Constatada en el repositorio** | Se comprobó en el historial de git (por ejemplo, la cantidad de pruebas de cada commit), pero no se volvió a ejecutar esa versión. |
| 🗣️ **Comunicada** | Informada por el autor o en sesiones anteriores; no se pudo reproducir con lo disponible en el repositorio. |

Entorno de la verificación: Windows 11, Node 22.17.0, Python 3.12.9.

## 1. Resumen

| Prueba | Resultado | Evidencia |
|--------|-----------|-----------|
| Frontend inicial (commit `797fdd7`) | 28 pruebas | 📄 28 casos `it(` en los archivos de prueba de ese commit |
| Preparación para Cloudflare (commit `1fe248a`) | 29 pruebas | 📄 29 casos en ese commit (se agregó la prueba de "sin envío por red") |
| Frontend actual (integración React + Pandas) | **41 de 41 aprobadas**, 7 archivos | ✅ `npm test` |
| Lint del frontend | Sin errores | ✅ `npm run lint` |
| Build de producción del frontend | Correcta | ✅ `npm run build` |
| Backend FastAPI + Pandas | **15 de 15 aprobadas** (1 advertencia de librería) | ✅ `python -m pytest -v` |
| Swagger con el dataset SIACAM: HTTP 200, 102.254 registros, 8 columnas | Informado como correcto | 🗣️ El archivo no está en el repositorio |
| Integración local React + FastAPI + Pandas con `impominerales-siacam.csv` | 7,4 MB, 102.254 registros, 8 columnas, 0 duplicados, 100 % de completitud, "Perfil del backend" | 🗣️ Capturas del autor (sección 7) |
| Errores del backend en el navegador | Mensaje 422 visible, sin vista previa sustituta | ✅ Prueba manual (sección 4) |
| Modo DEMO sin envío de datasets | Sin solicitudes de red con el archivo | ✅ Prueba automática y manual (sección 5) |
| Asistente DEMO con dataset de minerales | Ya no responde en términos de ventas | ✅ Prueba manual y automática (sección 6) |
| Publicación en Cloudflare Pages (https://datadecisionai.pages.dev) | Publicación exitosa | 🗣️ Captura de Cloudflare provista por el autor |
| Disponibilidad de la demo publicada | HTTP 200 en `/` y en `/analisis/cargar`; título "DataDecision AI" | ✅ Consulta HTTP del 24/10/2026 |

## 2. Frontend — 41 pruebas (✅ verificada)

| Archivo | Pruebas | Qué cubre |
|---------|:------:|-----------|
| `lib/csv.test.ts` | 8 | Separadores, comillas, tipos inferidos y perfil local de CSV |
| `lib/fileValidation.test.ts` | 3 | Acepta CSV/XLSX; rechaza PDF, vacíos y archivos grandes |
| `lib/config.test.ts` | 3 | Lectura de variables de entorno y formatos de exportación |
| `mocks/demoAssistant.test.ts` | 5 | Intención, pedido de stock faltante, propuesta solo con columnas reales, respuestas neutrales para otros rubros, Excel sin columnas |
| `services/demoProvider.test.ts` | 5 | Flujo DEMO completo con aprobación obligatoria, versiones de la propuesta, sin resultados inventados para archivos propios, **sin envío por red**, exportación que requiere backend |
| `services/backendProfile.test.ts` | 9 | Adaptación de la respuesta de Pandas, envío `multipart` en el campo `file`, errores 422 y backend apagado, sin respaldo silencioso, Excel, **separación entre demo pública y ejecución local** |
| `test/navigation.test.tsx` | 8 | Navegación, avisos de la demo, rechazo de PDF, vista previa, perfil real en pantalla, error del backend, rutas inexistentes |

Las pruebas de integración con el backend usan respuestas simuladas de `fetch` con la misma forma que devuelve Python; no requieren el servidor encendido.

## 3. Backend — 15 pruebas (✅ verificada)

| Archivo | Pruebas | Qué cubre |
|---------|:------:|-----------|
| `test_health.py` | 2 | `/api/health` responde; CORS permite el frontend de desarrollo |
| `test_config.py` | 2 | Lista de orígenes CORS; la clave de OpenAI no tiene valor por defecto |
| `test_dataset_profiler.py` | 11 | Separador `;` y ceros a la izquierda; vacíos informados sin reemplazo; duplicados no eliminados; primera hoja de XLSX; rechazo de PDF, CSV vacío y XLSX falso; endpoint con CSV; endpoint rechaza PDF; más de 100.000 filas; más de 25 MB |

La advertencia es un aviso de deprecación de la librería de pruebas de Starlette; no afecta los resultados.

## 4. Errores del backend en la interfaz (✅ verificada)

Con el backend en ejecución y `VITE_BACKEND_PROFILING=true`:

- Un CSV sintético de 3.002 filas devolvió **HTTP 200** y la pantalla mostró filas, columnas, vacíos por columna, filas duplicadas, primeras filas y advertencias.
- Un CSV con solo encabezado devolvió **HTTP 422** y la pantalla mostró "El backend no pudo perfilar el archivo — No se encontraron filas y columnas de datos.", **sin** vista previa alternativa.

La prueba de errores del backend informada por el autor (vía Swagger) es 🗣️ comunicada; las pruebas automáticas de la sección 3 cubren los rechazos principales.

## 5. Modo DEMO sin envío de datasets (✅ verificada)

- **Automática:** `procesa el archivo localmente sin enviarlo por la red` y `la demo pública (sin VITE_BACKEND_PROFILING) no llama al backend` espían `fetch` y `navigator.sendBeacon` y comprueban que no se llaman.
- **Manual:** en el navegador, con la configuración por defecto, se cargó un CSV y se conversó con el asistente. El registro de red mostró solo recursos de la propia aplicación (`localhost`); ninguna solicitud con el archivo.

## 6. Asistente DEMO y respuestas sectoriales

- 🗣️ **Error comunicado por el autor:** al consultar sobre un dataset de **importaciones de minerales**, el asistente respondió en términos de ventas.
- **Causa:** el guion detecta palabras como "comprar" o "stock" y usaba un mensaje pensado para el dataset ficticio de ventas.
- **Corrección:** para archivos propios, el saludo aclara que el asistente no interpreta el rubro; la pregunta sobre stock y la propuesta usan términos neutrales ("columnas disponibles").
- ✅ **Reproducción manual posterior a la corrección:** CSV sintético `importaciones_minerales.csv` (año, mes, país de origen, mineral, toneladas, valor USD) y la consulta "Quiero saber qué minerales conviene comprar más el próximo año". Ninguna respuesta ni la propuesta mencionaron ventas; se indicó la falta de una columna de stock.
- ✅ **Prueba automática:** `no presenta conclusiones de ventas sobre archivos de otros rubros`.

## 7. Prueba local con el dataset real SIACAM (🗣️ comunicada)

**Evidencia aportada por el autor (capturas de pantalla), 24/10/2026.** No fue reproducida por el asistente porque el archivo no está en el repositorio (y no debe estarlo).

| Aspecto | Resultado observado |
|---------|---------------------|
| Archivo | `impominerales-siacam.csv`, 7,4 MB, carga exitosa |
| Registros / columnas | 102.254 / 8 |
| Filas duplicadas exactas | 0 |
| Completitud informada | 100 % |
| Vista previa | Primeras cinco filas devueltas por Python |
| Origen del perfil en pantalla | "Perfil del backend" |
| Entorno | FastAPI en el puerto 8000; Vite en el puerto 5174 |

**Incidencia y solución.** El puerto 5173 estaba ocupado por Docker/WSL, por lo que Vite inició en 5174, un origen que el backend no autorizaba por CORS. Se habilitó **temporalmente** `http://localhost:5174` con la variable de entorno `CORS_ORIGINS` en la sesión de PowerShell antes de iniciar uvicorn. **No se modificó el código**: la configuración por variables de entorno permitió resolverlo. La configuración por defecto sigue autorizando solo el puerto 5173.

**Qué demuestra.** El flujo completo funciona con un archivo real de más de 100.000 filas: el navegador envía el CSV, Pandas lo perfila y la interfaz muestra el resultado marcado como proveniente del backend.

**Limitaciones conocidas (no resueltas).**

- **Tipos de columna estimados:** Pandas lee todo como texto y el frontend estima el tipo con los valores de ejemplo y las primeras filas. No es un tipado definitivo.
- **Códigos numéricos que pueden ser categorías:** columnas como años, meses o códigos de producto o de país se ven como números, pero pueden ser variables categóricas; sumarlas o promediarlas no tendría sentido.
- **`NA` y marcadores de vacío:** el backend cuenta como faltante solo la celda vacía (`keep_default_na=False`), por lo que `NA`, `N/A`, `null` o `-` se cuentan como valores presentes. La vista previa local del navegador, en cambio, los considera vacíos. Un 100 % de completitud informado por el backend **no descarta** la presencia de esos marcadores. Además, `NA` puede ser un valor legítimo (por ejemplo, el código ISO de Namibia), así que su tratamiento requiere una decisión explícita por columna.

### Re-ejecución al cerrar la etapa (✅ verificada)

Al volver a ejecutar las pruebas con el `.env.local` del autor presente (`VITE_BACKEND_PROFILING=true`), falló 1 de 41: `procesa el archivo localmente sin enviarlo por la red` agotó su tiempo de 10 s. **Causa:** la prueba llamaba a `createService(true)` y tomaba la opción de perfilado del entorno local, por lo que intentaba contactar un backend real. **Corrección (solo en la prueba):** `createService(true, false)`, que reproduce explícitamente la demo pública. Resultado posterior: **41 de 41**, lint sin errores, build correcta y backend **15 de 15**. Aprendizaje: las pruebas no deben depender de la configuración personal de cada equipo.

## 8. Limitaciones y verificaciones pendientes

- La prueba con el dataset **SIACAM** no se pudo repetir porque el archivo no está en el repositorio. Las capturas del autor son la evidencia; para hacerla reproducible se podría agregar una prueba con una muestra anonimizada.
- No hay pruebas de punta a punta automatizadas con navegador real (por ejemplo, Playwright); las verificaciones en navegador fueron manuales.
- No se midió rendimiento ni consumo de memoria con archivos cercanos al límite de 25 MB desde la interfaz.
- No hay pruebas de seguridad (CSV con fórmulas, nombres de archivo maliciosos, carga concurrente).
- De la demo publicada solo se verificó la disponibilidad (respuestas HTTP). La configuración `VITE_DEMO_MODE=true` y el recorrido completo en el sitio publicado constan en la evidencia comunicada; conviene repetir el recorrido manual en la URL pública antes de la exposición.
- La política de minimización de datos para OpenAI está decidida pero sin implementar; no hay pruebas que la validen.
- El asistente, los resultados y la exportación son DEMO; no hay pruebas de cálculos reales porque todavía no existen.
