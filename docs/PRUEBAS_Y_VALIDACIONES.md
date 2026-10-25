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
| Frontend al cierre de la integración React + Pandas (commit `7971702`) | 41 de 41 aprobadas, 7 archivos | ✅ ejecutada en esa etapa |
| Frontend al cierre de la Fase 2 (commit `106bb9d`) | 51 de 51 aprobadas, 8 archivos | ✅ ejecutada en esa etapa |
| Frontend con la Fase 3A, antes del endurecimiento | 63 de 63 aprobadas, 9 archivos | ✅ (sección 10) |
| **Frontend actual (Fase 3A + endurecimiento)** | **66 de 66 aprobadas**, 9 archivos | ✅ `npm test` (sección 12) |
| Lint del frontend | Sin errores | ✅ `npm run lint` |
| Build de producción del frontend | Correcta | ✅ `npm run build` |
| Backend al cierre de la integración (commit `7971702`) | 15 de 15 aprobadas | ✅ ejecutada en esa etapa |
| Backend al cierre de la Fase 2 (commit `106bb9d`) | 26 de 26 aprobadas | ✅ ejecutada en esa etapa |
| Backend con la Fase 3A, antes del endurecimiento | 29 de 29 aprobadas | ✅ (sección 10) |
| **Backend actual (Fase 3A + endurecimiento)** | **52 de 52 aprobadas** (1 advertencia de librería) | ✅ `python -m pytest` (sección 12) |
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

**Limitaciones conocidas al cierre de esa etapa** (la Fase 2, sección 9, aborda parte de ellas; las que permanecen se listan allí).

- **Tipos de columna estimados:** Pandas lee todo como texto y el frontend estima el tipo con los valores de ejemplo y las primeras filas. No es un tipado definitivo.
- **Códigos numéricos que pueden ser categorías:** columnas como años, meses o códigos de producto o de país se ven como números, pero pueden ser variables categóricas; sumarlas o promediarlas no tendría sentido.
- **`NA` y marcadores de vacío:** el backend cuenta como faltante solo la celda vacía (`keep_default_na=False`), por lo que `NA`, `N/A`, `null` o `-` se cuentan como valores presentes. La vista previa local del navegador, en cambio, los considera vacíos. Un 100 % de completitud informado por el backend **no descarta** la presencia de esos marcadores. Además, `NA` puede ser un valor legítimo (por ejemplo, el código ISO de Namibia), así que su tratamiento requiere una decisión explícita por columna.

### Re-ejecución al cerrar la etapa (✅ verificada)

Al volver a ejecutar las pruebas con el `.env.local` del autor presente (`VITE_BACKEND_PROFILING=true`), falló 1 de 41: `procesa el archivo localmente sin enviarlo por la red` agotó su tiempo de 10 s. **Causa:** la prueba llamaba a `createService(true)` y tomaba la opción de perfilado del entorno local, por lo que intentaba contactar un backend real. **Corrección (solo en la prueba):** `createService(true, false)`, que reproduce explícitamente la demo pública. Resultado posterior: **41 de 41**, lint sin errores, build correcta y backend **15 de 15**. Aprendizaje: las pruebas no deben depender de la configuración personal de cada equipo.

## 8. Limitaciones y verificaciones pendientes

> Ver también las limitaciones propias de la Fase 2 en la sección 9.

- La prueba con el dataset **SIACAM** no se pudo repetir porque el archivo no está en el repositorio. Las capturas del autor son la evidencia; para hacerla reproducible se podría agregar una prueba con una muestra anonimizada.
- No hay pruebas de punta a punta automatizadas con navegador real (por ejemplo, Playwright); las verificaciones en navegador fueron manuales.
- No se midió rendimiento ni consumo de memoria con archivos cercanos al límite de 25 MB desde la interfaz.
- No hay pruebas de seguridad (CSV con fórmulas, nombres de archivo maliciosos, carga concurrente).
- De la demo publicada solo se verificó la disponibilidad (respuestas HTTP). La configuración `VITE_DEMO_MODE=true` y el recorrido completo en el sitio publicado constan en la evidencia comunicada; conviene repetir el recorrido manual en la URL pública antes de la exposición.
- La política de minimización de datos para OpenAI está decidida pero sin implementar; no hay pruebas que la validen.
- El asistente, los resultados y la exportación son DEMO; no hay pruebas de cálculos reales porque todavía no existen.


## 9. Fase 2 — Calidad y confiabilidad del dataset (✅ verificada)

Las pruebas automáticas usan datos **sintéticos**. La validación con el archivo real SIACAM fue realizada por el autor (subsección "Validación con SIACAM").

### Resultados

| Verificación | Resultado |
|--------------|-----------|
| Backend (`python -m pytest`) | **26 de 26** (15 anteriores + 11 nuevas en `test_data_quality.py`), 1 advertencia de librería |
| Frontend (`npm test`) | **51 de 51** en 8 archivos (41 anteriores + 9 en `lib/dataQuality.test.ts` + 1 en `navigation.test.tsx`) |
| Lint y build | Sin errores |
| Regresiones | Ninguna: las 41 pruebas previas del frontend y las 15 del backend pasaron sin modificarse |

### Qué cubren las pruebas nuevas

| Aspecto | Backend | Frontend |
|---------|---------|----------|
| Solo la celda vacía es faltante; `NA`, `N/A`, `null`, `-` quedan como sospechosos | ✅ | ✅ (vista previa local) |
| `NA` se conserva como valor válido y distinto; el dato no se modifica | ✅ | ✅ |
| Completitud sobre el archivo completo (150 vacías de 400 → 62,5 %) | ✅ | ✅ (usa el valor del backend) |
| Nunca se muestra "100 %" si falta alguna celda | — | ✅ |
| Misma lista de marcadores en Python y TypeScript | — | ✅ (lee `column_semantics.py`) |
| Año y mes por nombre + rango; código de longitud fija; cuantitativa con decimales; categórica | ✅ (CSV tipo comercio exterior) | ✅ (adaptador) |
| Ceros a la izquierda → código con confianza alta | ✅ | — |
| Fechas en dos formatos → temporal | ✅ | — |
| Posible año sin nombre, pocos enteros, mezcla número/texto → confianza baja + advertencia | ✅ | — |
| Columna constante → confianza baja + advertencia | ✅ | — |
| Reglas independientes del dataset ("Fiscal Year", "Año") | ✅ | — |
| XLSX con fechas, códigos `00001`, importes, vacíos y `NA` | ✅ | — |
| Respuesta anterior del backend sin campos nuevos | — | ✅ |
| El asistente DEMO no suma ni promedia códigos o años | — | ✅ |
| La pantalla muestra interpretación con "?" y confianza, y posibles NA | — | ✅ |

### Verificación manual en el navegador

Frontend con perfilado real contra el backend local (puerto alternativo, sin modificar la configuración del autor), con un CSV sintético de 500 filas y columnas `ANYO`, `MES`, `PPRO`, `CIF`, `PAIS`, `OBS`:

- Completitud 98,1 % (56 celdas vacías de 3.000), 169 posibles marcadores de ausencia informados aparte.
- `ANYO` y `MES`: temporal, confianza alta. `PPRO` (8 dígitos fijos): "Código o ID?", confianza media, con advertencia. `CIF`: cuantitativa, alta. `PAIS` (con `NA`): categórica, media, y 125 posibles `NA`.
- Una columna constante se mostró con confianza baja y advertencia.

### Rendimiento

CSV sintético de 102.254 filas × 8 columnas (4,4 MB), medido en el equipo de desarrollo: **0,69 s antes → 2,04 s después**. Aceptable para el MVP; el costo se concentra en columnas numéricas con valores casi todos distintos.

### Limitaciones que permanecen

- **Interpretación estimada:** las reglas pueden equivocarse. Un código corto de longitud variable sin nombre indicativo (por ejemplo, 1 a 40) se clasifica como cuantitativo con confianza media.
- **Nombres de columna:** solo se reconocen palabras en español e inglés.
- **Marcadores sospechosos sin resolver:** se informan, pero la decisión por columna queda pendiente.
- **Formato numérico ambiguo:** `1.200` puede ser mil doscientos o uno coma dos; no se convierten valores.
- **Clasificación ambigua observada en SIACAM (`PPRO`):** ver la subsección siguiente.

### Validación con el dataset real SIACAM (🗣️ comunicada)

**Evidencia aportada por el autor** mediante capturas de la aplicación local con `impominerales-siacam.csv` y la versión de la Fase 2. No fue reproducida por el asistente: el archivo no está en el repositorio.

| Aspecto | Resultado observado |
|---------|---------------------|
| Carga y vista previa | Archivo cargado correctamente; vista previa visible |
| Filas / columnas | 102.254 / 8 |
| Duplicados exactos | 0 |
| Completitud (celdas no vacías ÷ total) | 100 % |
| Posibles marcadores de ausencia | 12: cuatro `NA` en `ORIGEN`, cuatro en `PPRO` y cuatro en `PROCEDENC` |
| `ANYO`, `MES` | Temporal, confianza alta |
| `CIF` | Cuantitativa, confianza alta |
| `PPRO` | **Cuantitativa, confianza media**, sin confirmación semántica |

**Lectura de los resultados.**

- La completitud de 100 % y los 12 marcadores son **compatibles**: con el criterio explícito, los `NA` no son celdas vacías, por lo que se informan aparte en lugar de descontarse. Antes de la Fase 2, esos 12 valores no se veían.
- `ANYO`, `MES` y `CIF` se clasificaron como se esperaba.
- **Limitación real observada — `PPRO`:** fue clasificada como **cuantitativa con confianza media**. Ninguna regla general encontró evidencia de que sea un código (no tiene ceros a la izquierda, su nombre no contiene palabras de código y, previsiblemente, sus valores no tienen longitud fija; esto último no fue verificado). **No puede afirmarse que la plataforma haya reconocido su significado.** Por eso no conviene sumarla ni promediarla sin confirmación del usuario.
- Los `NA` de `ORIGEN` y `PROCEDENC` (columnas que, por su nombre, podrían contener países) pueden ser datos faltantes o un código válido; la plataforma no lo decide.

**Decisión de arquitectura para las próximas fases (planificada, no implementada).**

- DataDecision AI debe funcionar con **cualquier dataset tabular CSV/XLSX**. SIACAM es solo un caso de prueba real: **no se incorporan reglas específicas para sus columnas**, aunque eso implique que `PPRO` no se clasifique como código.
- El perfilador **propone** interpretaciones y advertencias; no decide. La próxima fase incorporará un asistente que **consultará al usuario** cuando sean ambiguos el significado de una variable, los marcadores de ausencia o las necesidades del análisis (por ejemplo: "¿`PPRO` es un código o una cantidad?", "¿los `NA` de `ORIGEN` son datos faltantes o un código de país?").
- **Tratamiento no destructivo:** las decisiones confirmadas se aplicarán después, al ejecutar el análisis con Pandas, sobre una copia en memoria. **Nunca se eliminan ni modifican automáticamente datos originales sin autorización.** Hoy no se aplica ningún tratamiento: los `NA` se informan y se conservan.


## 10. Fase 3A — Varias fuentes por análisis (✅ verificada)

Cerrada en el commit de la Fase 3A. Datos **sintéticos** en las pruebas automáticas; la validación con datos reales del autor está en la sección 13.

### Resultados

| Verificación | Resultado |
|--------------|-----------|
| Backend (`python -m pytest`) | **29 de 29** (26 anteriores + 3 en `test_multiple_sources.py`), 1 advertencia de librería |
| Frontend (`npm test`) | **63 de 63** en 9 archivos (51 anteriores + 12 en `test/multiSource.test.tsx`) |
| Lint y build | Sin errores |
| Regresiones | Ninguna: las 51 pruebas previas del frontend (incluidas las del flujo de un solo archivo) pasaron **sin modificarse** |

### Qué cubren las pruebas nuevas

| Caso | Dónde |
|------|-------|
| Tres archivos CSV/XLSX de estructuras distintas perfilados por separado con el mismo endpoint, sin datos cruzados | Backend |
| Un archivo con error no afecta al siguiente; el mismo archivo da el mismo perfil | Backend |
| Catálogo de 3 fuentes: alias, conteos, columna compartida (`region` = `Región`), estructura igual entre A y C, **sin valores reales** | Frontend |
| Proyecto con 3 fuentes: referencias en orden, aviso del asistente, limitación en la propuesta y **perfiles originales sin cambios** | Frontend |
| Compatibilidad: proyecto de una sola fuente igual que antes | Frontend |
| Rechazo de más de 3 fuentes y de fuentes inexistentes | Frontend |
| Carga simultánea de 2 archivos distintos, detalle de cada uno y envío de ambas fuentes al crear el proyecto | Frontend (pantalla) |
| Quitar una fuente sin afectar a las demás; la zona de carga reaparece al bajar de 3 | Frontend (pantalla) |
| 4 archivos (uno PDF): se toman 3, se informa el ignorado y el error del PDF queda en su fuente | Frontend (pantalla) |
| Mismo archivo dos veces: rechazado | Frontend (pantalla) |
| Reemplazo fallido con backend: se conserva la fuente anterior; perfilado **de a un archivo** (concurrencia máxima 1) | Frontend (pantalla) |
| Reemplazo exitoso en la misma posición | Frontend (pantalla) |
| Workspace: perfil de cada fuente por separado | Frontend (pantalla) |

### Verificación manual en el navegador

Frontend con perfilado real contra el backend local (puertos alternativos, sin tocar la configuración del autor). Se cargaron a la vez tres CSV sintéticos de estructuras distintas: `importaciones.csv` (400 filas, 4 columnas), `paises.csv` (3 filas; `NA` = Namibia) y `notas.csv` (30 filas).

- Cada fuente mostró filas, columnas, completitud, posibles `NA` e interpretaciones; el detalle cambió al seleccionar cada una.
- El catálogo señaló «PAIS» en las fuentes A y B como **posible relación no confirmada**; no se combinó nada.
- Al continuar, el asistente DEMO avisó que recibió 2 fuentes más y que la propuesta usa solo la principal.
- Diseño revisado a 1280 px y en un panel de 384 px.

### Limitaciones y pendientes

- La compatibilidad con un backend de proyectos real (`POST /api/projects` con `datasetIds`) no se pudo probar porque ese endpoint no existe todavía.
- No se probó la carga simultánea de tres archivos cercanos a 25 MB.
- No se repitió la prueba con SIACAM en modo multiarchivo.


## 11. Auditoría de privacidad y flujo de datos (✅ verificada, 24/10/2026)

Comprobaciones ejecutadas sobre la Fase 3A antes de su cierre, con **datos sintéticos**. No se modificó código funcional. Hallazgos y clasificación en [SEGURIDAD.md](SEGURIDAD.md), sección 6.

| Comprobación | Método | Resultado |
|--------------|--------|-----------|
| Red y almacenamiento en la **demo pública** | Build con `VITE_DEMO_MODE=true` y `VITE_BACKEND_PROFILING=false`, servida localmente; se instrumentaron `fetch`, XHR, `sendBeacon` y `WebSocket`; se cargaron 3 archivos (uno llamado `clientes_confidencial.csv` con CUIT inventados), se quitó uno, se reemplazó otro y se continuó al asistente | **0 solicitudes**; registro de red del navegador: solo `index.html`, JS, CSS y fuente propios; `localStorage`, `sessionStorage`, cookies, IndexedDB, Cache Storage y service workers vacíos |
| Recarga | Recargar en `/analisis/asistente` | Estado perdido ("Primero cargá un dataset"); ningún nombre ni valor del archivo en la página ni en la URL |
| Red en **perfilado local** | Servidor de desarrollo con `VITE_BACKEND_PROFILING=true` contra un backend de prueba; 2 archivos | 2 POST a `/api/datasets/profile` del backend configurado, de a una, cada una con solo el campo `file`; almacenamiento vacío |
| Registro del servidor | Salida de uvicorn durante la prueba | Solo IP, método, ruta y estado; sin nombres de archivo ni contenido |
| URLs en la build | Análisis de `dist/` | Solo textos de librerías (documentación de React/Redux, espacios de nombres XML) y `localhost`; sin servicios de analítica |
| Demo publicada | Lectura del HTML y cabeceras de https://datadecisionai.pages.dev | Un único script propio; sin `cloudflareinsights`, Zaraz ni GTM; sin `Content-Security-Policy`; con `nosniff` y `Referrer-Policy` |
| Archivos temporales | Observación de `SpooledTemporaryFile` de Starlette en pruebas | 8 KB: en memoria. 3,2 MB y 40 MB: volcados a disco; en todos los casos cerrados (eliminados) al terminar |
| Tamaño antes de recibir | Archivo de 40 MB | Recibido y volcado completo; luego HTTP 413 |
| Memoria con CSV adversario | 24,8 MB, 62.000 filas × 200 columnas de un carácter; `tracemalloc` | Aceptado; pico ≈ 409 MB de memoria Python trazada; 37,8 s |
| CORS | POST desde un origen externo | HTTP 200 procesado, sin `Access-Control-Allow-Origin` (la respuesta no es legible, pero el trabajo se hizo) |
| Errores de codificación | CSV en UTF-16 | HTTP 422 con mensaje controlado |

**Pendiente de verificación manual:** configuración del panel de Cloudflare (analítica u otras inyecciones que se activen después); comportamiento en navegadores distintos de Chromium; consumo real de memoria del proceso (RSS), que `tracemalloc` no mide por completo.


## 12. Endurecimiento de la carga: B4, B5, B6 y F7 (✅ verificada)

Cerrada en el commit de la Fase 3A. Datos **sintéticos**.

### Resultados

| Verificación | Resultado |
|--------------|-----------|
| Backend (`python -m pytest`) | **52 de 52** (29 anteriores + 23 en `test_hardening.py`), 1 advertencia de librería |
| Frontend (`npm test`) | **66 de 66** en 9 archivos (63 anteriores + 3 de liberación de fuentes) |
| Lint y build | Sin errores |
| Regresiones | Ninguna: las 29 pruebas previas del backend y las 63 del frontend pasaron sin modificarse |

### Pruebas nuevas

| Hallazgo | Casos |
|----------|-------|
| B6 Origen | Origen autorizado con encabezado CORS; sin `Origin` permitido; externo, `null` y puerto no autorizado → 403 sin ejecutar el perfilado; 403 sin leer ningún byte del cuerpo; puerto 5174 autorizado por defecto; `/api/health` no afectado |
| B4 Tamaño | `Content-Length` excesivo → 413 sin leer el cuerpo; `Content-Length` inválido → 400; 32 MB sin `Content-Length` y con `Content-Length` falso → 413 tras leer como máximo el límite + 1 fragmento, con el temporal cerrado; archivo válido de ≈ 24 MB → 200 |
| B5 Memoria | CSV adversario de 12,4 M celdas rechazado **sin llamar a `pd.read_csv`** y en menos de 10 s; límites de columnas y filas; saltos de línea entre comillas sin falsos rechazos; XLSX con exceso de celdas; bomba ZIP (5 MB reales, pocos KB comprimidos); XLSX con demasiados componentes; XLSX truncado y CSV binario → 422 sin traza; perfilado ejecutado fuera del bucle de eventos; 429 al superar la concurrencia y contador liberado tras éxito y error |
| F7 Liberación | El perfil quitado deja de existir y no puede usarse para un proyecto; otras fuentes intactas; dataset usado por un proyecto se conserva; en la pantalla: reemplazo fallido no libera, reemplazo exitoso libera solo el anterior, quitar libera esa fuente |

### Mediciones (antes → después)

| Caso | Antes | Después |
|------|-------|---------|
| CSV adversario 24,8 MB, 12,4 M celdas | Aceptado; ≈ 409 MB; 37,8 s con el servidor bloqueado | **Rechazado en 0,6 s**; ≈ 124 MB (decodificación del texto) |
| Dataset sintético tipo SIACAM (102.254 × 8) | 2,04 s | 2,13 s (sin cambios relevantes) |
| Peor caso aceptado (≈ 5 M celdas, 10 MB) | — | ≈ 7,9 s; ≈ 183 MB de memoria Python trazada |
| `/api/health` durante un perfilado de 8 s (uvicorn real) | Bloqueado | 8 respuestas, máximo 481 ms |
| 40 MB por fragmentos sin `Content-Length` (uvicorn real) | Recibido completo, luego 413 | **413 en 0,7 s** |
| `Origin: null` (uvicorn real) | Procesado (200) | **403** |

**Limitaciones de la verificación:** `tracemalloc` no mide toda la memoria del proceso (RSS); no se probó con varios procesos de uvicorn; el recorrido con el archivo real SIACAM después de estos cambios queda pendiente de verificación manual del autor.


## 13. Cierre de la Fase 3A: validación manual con dos datasets reales (🗣️ comunicada)

**Evidencia aportada por el autor** (aplicación local React + FastAPI + Pandas). No fue reproducida por el asistente: los archivos no están en el repositorio.

### Perfiles obtenidos

| Aspecto | Fuente 1: `impominerales-siacam.csv` | Fuente 2: `indicadores-provinciales.csv` |
|---------|--------------------------------------|------------------------------------------|
| Filas / columnas | 102.254 / 8 | 15.874 / 14 |
| Duplicados exactos | 0 | 0 |
| Completitud (celdas no vacías) | 100 % | 100 % |
| Posibles marcadores de ausencia | 12 | 45 |
| Codificación | — | Windows-1252, identificada por el backend |
| Procesamiento | Correcto | Correcto |

### Funcionamiento con varias fuentes

1. Ambos archivos se cargaron en un mismo análisis.
2. Cada fuente conservó su estructura, estadísticas y perfil de calidad.
3. Al seleccionar una fuente se mostraron sus propios datos, sin alterar la otra.
4. Se quitó una fuente sin afectar a la otra y se volvió a incorporar.
5. El catálogo informó que no hay columnas con nombres coincidentes entre ambos archivos.
6. Los datasets no se unieron, concatenaron ni transformaron.
7. El sistema permite hasta tres fuentes por análisis.

### Asistente DEMO con las dos fuentes

Mensaje del autor: *"Quiero analizar la evolución de las importaciones de minerales por año y, por separado, estudiar los indicadores provinciales. No quiero relacionar ambos datasets."*

Respuesta del asistente: *"Entiendo tu objetivo. Las columnas numéricas que encontré son «PPRO», «CIF». Puedo incluir la evolución en el tiempo según «ANYO» y comparaciones por «ORIGEN», «PROCEDENC», «GRUPO». ¿Te sirve ese enfoque?"*

| Correcto | Limitaciones observadas (defectos aceptados) |
|----------|----------------------------------------------|
| Propuso la evolución temporal con `ANYO` | No reconoció el objetivo independiente sobre los indicadores provinciales |
| Identificó `CIF` como numérica pertinente | No confirmó la instrucción de mantener separados los análisis |
| Propuso agrupaciones útiles sobre SIACAM | Incluyó `PPRO` entre las numéricas sin advertir que su significado es ambiguo |
| Al inicio avisó que había una segunda fuente y que solo usaba la principal | Funciona con reglas y palabras clave, no con comprensión del lenguaje |
| Se identificó como simulado y no afirmó haber unido archivos ni calculado nada conjunto | |

**Decisión:** no se amplía el asistente DEMO con reglas nuevas (es una simulación provisional). Los requisitos para la IA real quedan en [NEXT_STEPS.md](NEXT_STEPS.md) (Fase 3B).

### Incidencia observada

**Incidencia intermitente de CORS (🗣️ comunicada por el autor, causa no confirmada).** Durante las pruebas locales el navegador informó errores de CORS desde `http://localhost:5174` hacia `http://127.0.0.1:8000/api/datasets/profile`. Luego el autor verificó: `GET /api/health` → 200; `OPTIONS` con `Origin: http://localhost:5174` → 200 con `Access-Control-Allow-Origin` correcto; `POST` sin archivo → 422 con cabecera CORS; `POST` con SIACAM desde curl → 200 con cabecera CORS; y cargas posteriores desde React exitosas con ambos archivos.

La causa **no fue confirmada** y la incidencia **no se declara resuelta**. Hipótesis sin verificar, útiles para un próximo diagnóstico: (a) el backend no estaba en ejecución o se estaba reiniciando (`--reload`) en ese momento; (b) un error no controlado (500) se responde fuera de la capa CORS y el navegador lo muestra como error de CORS; (c) caché del navegador o un servidor anterior todavía en el puerto. Si se repite, conviene registrar en ese momento la consola de uvicorn y la pestaña Red del navegador (código de estado real). No se modificaron CORS ni los middlewares de forma especulativa.

### Verificación automática al cierre (✅ ejecutada por el asistente, 25/10/2026)

Ver la sección 14.

## 14. Verificación final de la Fase 3A (✅ ejecutada por el asistente, 25/10/2026)

| Verificación | Resultado |
|--------------|-----------|
| Backend (`python -m pytest`) | **52 de 52** (1 advertencia de deprecación de la librería de pruebas) |
| Frontend (`npm test`) | **66 de 66** en 9 archivos |
| Lint (`npm run lint`) | Sin errores |
| Typecheck (`tsc -b`) | Sin errores |
| Build de producción en modo público (`VITE_DEMO_MODE=true`, sin perfilado con backend) | Correcta |

**Prueba intermitente detectada y corregida (solo en la prueba).** En una de las ejecuciones completas falló `la pantalla libera al quitar y al reemplazar…`: la prueba esperaba ver el nombre del archivo nuevo y enseguida verificaba la liberación, pero la pantalla muestra ese nombre **mientras** el reemplazo se procesa. Bajo carga, la verificación llegaba antes de que terminara. No era un defecto de la aplicación. Se cambió la prueba para esperar a que termine el reemplazo; luego hubo **0 fallas en 8 ejecuciones** repetidas de las pruebas de pantalla y la suite completa pasó.

## 15. Fase 3B.1 — Frontera de privacidad para la IA (✅ verificada, 25/10/2026)

Cerrada en el commit de la Fase 3B.1. Datos **sintéticos** (incluido un archivo inventado `clientes_confidencial.csv` con CUIT falsos). **Ninguna llamada a OpenAI.**

### Resultados

| Verificación | Resultado |
|--------------|-----------|
| Backend (`python -m pytest`) | **79 de 79** (52 anteriores + 27 en `test_ai_gateway.py`) |
| Frontend (`npm test`) | **80 de 80** en 10 archivos (66 anteriores + 14 en `test/aiBoundary.test.tsx`) |
| Lint y typecheck | Sin errores |
| Build en modo público | Correcta; el paquete no contiene `api.openai.com` |
| Regresiones | Ninguna: las pruebas anteriores pasaron sin modificarse |

### Qué cubren las pruebas nuevas

| Requisito | Backend | Frontend |
|-----------|---------|----------|
| Archivos originales fuera del contexto | 422 si llegan `file`, `fileName`, `rows`, `previewRows`, `rowCount` | El contexto y su vista no contienen nombre de archivo ni valores |
| Filas, vistas previas y ejemplos no se transmiten | 422 para `sampleValues`, `examples`, `distinct` en columnas | Ni `ACME`, ni CUIT, ni saldos en el contenido ni en el cuerpo de la solicitud |
| Solicitud no autorizada rechazada | Sin preparar → 404; huella alterada → 409; sin `confirm` → 422; IA deshabilitada → 403 y se descarta; cancelada → 404; vencida → 410; uso único | "Autorizar" solo aparece después de validar; editar invalida y cancela lo preparado |
| Sin llamadas externas | Red bloqueada fuera del equipo en todas las pruebas (con una prueba que verifica el bloqueo); el proveedor por defecto responde 501 sin red | En la demo pública no existe el cliente; `fetch` no se llama; el cliente solo apunta a `/api/ai/*` del backend |
| Una, dos o tres fuentes independientes | 1, 2 y 3 aceptadas; 4, alias repetido o fuera de A-C → 422 | Alias A, B y C; una fuente sin columnas autorizadas no se menciona |
| Flujo DEMO | — | Cargar → asistente → respuesta → abrir la revisión, sin red |
| Clave y registros | `/api/ai/status` informa si hay clave, nunca su valor; `AI_ENABLED` falso por defecto; el objetivo y los nombres de columna no aparecen en los registros | — |
| Origen y tamaño | `Origin` externo o `null` → 403 en POST y DELETE; cuerpo > 64 KB → 413 | — |

### Verificación manual en el navegador (ejecutada por el asistente)

Con el backend local real (puerto alternativo) y perfilado activado: se cargaron `clientes_confidencial.csv` y `regiones.csv`, se continuó al asistente, se abrió la revisión, se ocultó la columna `cuit`, se editó el objetivo, se validó y se autorizó.

- Solicitudes realizadas: dos perfilados, `GET /api/ai/status`, `POST /api/ai/requests` y `POST …/authorize`; todas al backend local.
- El cuerpo enviado al backend contenía solo alias, columnas autorizadas (sin `cuit`), formatos, interpretaciones y el objetivo; ni nombres de archivo ni valores.
- Respuesta: "La IA externa está deshabilitada (AI_ENABLED=false). No se envió nada."
- El registro del servidor contenía solo rutas y códigos de estado.

**Pendiente:** no se probó con `AI_ENABLED=true` en el servidor real (se cubrió con pruebas automáticas y un proveedor falso); la conexión real con OpenAI corresponde a la Fase 3B.2.


### Validación manual del autor con datos reales (🗣️ comunicada)

Evidencia aportada por el autor en la aplicación local; no reproducida por el asistente (los archivos no están en el repositorio).

| Paso | Resultado observado |
|------|---------------------|
| Fuentes | A: `indicadores-provinciales.csv`; B: `impominerales-siacam.csv` (datos reales, en la aplicación local) |
| Objetivo | *"Quiero analizar por separado la evolución de las importaciones de minerales por año y la evolución de los indicadores provinciales. No quiero relacionar ni unir los datasets. Si encontrás columnas ambiguas o posibles valores faltantes, preguntame antes de proponer cálculos."* — se incorporó al contexto mostrado |
| Ocultar `PPRO` | Desapareció del JSON |
| Renombrar `CIF` | El nuevo nombre apareció de inmediato en el JSON |
| Validar contenido | El backend devolvió una huella SHA-256 generada correctamente, con vencimiento de 5 minutos y autorización de un solo uso |
| Autorizar este envío | "La IA externa está deshabilitada (`AI_ENABLED=false`)"; no se envió nada a OpenAI |

**Dónde llega el JSON en esta fase.** El contexto revisado **sí viaja al backend FastAPI local** (`POST /api/ai/requests`) para que lo valide la lista blanca; **no sale hacia ningún proveedor externo**: no hay SDK, URL ni llamada a OpenAI en el código, y el proveedor de esta fase no tiene red.

### Revisión final de privacidad al cierre (✅ ejecutada por el asistente)

| Comprobación | Evidencia |
|--------------|-----------|
| Lista blanca en el backend | `ConfigDict(extra="forbid")` en `app/schemas/ai_context.py`; pruebas con 8 tipos de campos rechazados |
| Sin archivos, filas, vistas previas, ejemplos ni nombres de archivo | Pruebas de backend (422) y de frontend (contenido y cuerpo de la solicitud) |
| Lo validado es lo revisado | El panel muestra el contenido **devuelto por el backend** y la autorización exige su huella exacta |
| Las ediciones invalidan autorizaciones | `invalidate()` cancela lo preparado en cada cambio; prueba automática |
| `AI_ENABLED=false` impide el envío | 403 antes de consumir la solicitud; prueba con proveedor falso que no recibe nada; validación manual del autor |
| Demo pública sin API de IA | `createDefaultAIGateway()` devuelve `null` sin backend; prueba automática; build pública sin `api.openai.com` |
| Sin llamadas reales a OpenAI | Búsqueda en `backend/app` y `frontend/src`: ningún SDK, importación ni URL de OpenAI; `requirements.txt` sin `openai` |
| Claves fuera del frontend y de Git | Ninguna variable `VITE_*` con claves; `.env` y `.env.local` excluidos; `/api/ai/status` no devuelve la clave |


## 16. Revisión obligatoria de datos y privacidad (✅ verificada, 25/10/2026)

Cambios incluidos en el commit de cierre del recorrido (validados además por el autor, sección 20). Datos **sintéticos**.

| Verificación | Resultado |
|--------------|-----------|
| Backend (`python -m pytest`) | **83 de 83** (79 anteriores + 4 sobre los campos de revisión) |
| Frontend (`npm test`) | **89 de 89** en 11 archivos (80 anteriores, 3 de ellas adaptadas al nuevo paso, + 9 en `test/reviewFlow.test.tsx`) |
| Lint, typecheck y build pública | Sin errores |

**Pruebas adaptadas (no debilitadas).** Tres pruebas del recorrido anterior (carga → asistente) ahora completan la revisión con un ayudante compartido (`test/reviewHelpers.ts`); una prueba de campos del contexto incluye `user_corrected` y `missing_markers`.

### Qué cubren las pruebas nuevas

| Requisito | Prueba |
|-----------|--------|
| No se llega a la conversación sin revisión | Sin fuentes: "Primero cargá tus datos"; con fuentes y sin confirmar: "Primero revisá tus datos" con enlace a la revisión |
| Revisión completa | Sin objetivo no se confirma ni se crea el proyecto |
| Las correcciones se conservan | Formato, significado y decisión sobre `NA` aparecen en el contexto (`user_corrected: true`) y siguen disponibles en el asistente; el objetivo llega precargado al editor |
| Elegir y renombrar actualiza el contexto | Columna oculta y renombrada en el JSON y en lo que se enviaría a validar; sin nombre de archivo ni valores |
| Editar después de confirmar | Vuelve a exigir la confirmación |
| Archivos originales intactos | El perfil es idéntico antes y después de corregir; los `001` y los `NA` siguen en las filas |
| Una, dos o tres fuentes | Una tabla por fuente (A, B, C), contexto con las tres y proyecto con todas |
| Demo pública sin OpenAI | Sin cliente de IA y sin ninguna solicitud de red en todo el recorrido |
| Backend | Acepta `integer`/`decimal`, `user_corrected` y `missing_markers`; rechaza valores de marcadores, decisiones inexistentes y formatos técnicos de Pandas |

**Incidencia de prueba resuelta.** Una prueba falló de forma consistente al ejecutarse junto con otras: las navegaciones de React Router se aplican como *transiciones* y, llamadas fuera de `act()`, la URL cambiaba antes de que se renderizara la pantalla. Se envolvieron en `act()`; luego 3 ejecuciones seguidas sin fallas. En la aplicación real la protección funcionaba (verificado con la prueba aislada).

**Verificación en el navegador (asistente).** Build pública: carga de dos CSV, paso a la revisión, corrección de una columna; el resumen y la tabla reflejaron el cambio y **no hubo solicitudes de red**.


## 17. Corrección de navegación del recorrido (✅ verificada, 25/10/2026)

Cambios incluidos en el commit de cierre del recorrido (validados además por el autor, sección 20). **Problema detectado por el autor** en la validación manual: desde el asistente no había forma clara de volver a la revisión y el encabezado no era navegable.

| Verificación | Resultado |
|--------------|-----------|
| Frontend (`npm test`) | **96 de 96** en 12 archivos (89 anteriores + 7 en `test/wizardNavigation.test.tsx`) |
| Backend (`python -m pytest`) | **83 de 83** (sin cambios en el backend) |
| Lint, typecheck y build pública | Sin errores |

| Requisito | Prueba |
|-----------|--------|
| Requisitos de cada paso | `stepAccess`: sin fuentes solo "Cargar"; con fuentes, "Revisar"; con revisión confirmada, todos |
| Estados visuales y accesibilidad | Paso activo con `aria-current="step"`; bloqueados sin enlace, con `aria-disabled` y motivo; un paso completado se abre con **Enter** desde el teclado |
| Navegación hacia atrás | Asistente → «Volver a revisar datos» → «Volver a cargar datos» |
| Preservación del estado | Se conservan la corrección de significado, la columna no compartida, el objetivo, las dos fuentes y el mensaje de la conversación; al continuar sin cambios no se crea otro proyecto |
| Invalidación | Una modificación quita el aviso de "ya confirmada", bloquea "Conversar" en el encabezado y exige confirmar (se crea un nuevo proyecto) |
| Bloqueo hacia adelante por URL | Sin datos: revisar, conversar y confirmar bloqueados; con revisión invalidada: conversar y confirmar muestran "Primero revisá tus datos" |
| Autorizaciones de IA | Salir de la revisión con una solicitud validada la cancela en el backend; al volver hay que validar de nuevo; nunca se llama a autorizar |


## 18. Una sola pantalla de configuración y autorización por mensaje (✅ verificada, 25/10/2026)

Cambios incluidos en el commit de cierre del recorrido (validados además por el autor, sección 20). **Mejora detectada por el autor** en las pruebas manuales: controles de privacidad duplicados entre el paso 2 y el asistente.

| Verificación | Resultado |
|--------------|-----------|
| Frontend (`npm test`) | **101 de 101** en 13 archivos (96 anteriores, 3 adaptadas, + 5 en `test/assistantCompact.test.tsx`) |
| Backend (`python -m pytest`) | **84 de 84** (83 anteriores, 1 adaptada, + 1 sobre autorización por mensaje) |
| Lint, typecheck y build pública | Sin errores |

| Requisito | Prueba |
|-----------|--------|
| El paso 2 conserva la configuración completa | Formato, significado, `NA`, columnas, nombres, objetivo y JSON siguen allí; al volver desde el asistente las decisiones están aplicadas |
| El paso 3 solo muestra un resumen | Tarjeta "Datos revisados" con fuentes y columnas autorizadas por fuente; **ningún** selector, casilla, campo de objetivo ni JSON de configuración; un único control para volver |
| Navegación sin pérdida | «Modificar configuración de datos» lleva al paso 2 con las decisiones y el objetivo |
| Invalidación | Modificar una variable exige confirmar de nuevo |
| Autorización individual | El contenido incluye el mensaje y solo las columnas autorizadas; cambiar el mensaje cancela lo validado; autorizar es de un solo uso; en el backend la huella de un mensaje no sirve para otro (409) |
| Asistente DEMO | «Enviar» sigue respondiendo y no valida ni autoriza nada |
| Demo pública | Sin sección de envío a la IA y sin solicitudes de red |

**Verificación en el navegador (asistente).** Build pública: el paso 3 muestra la tarjeta compacta con "2 de 3 columnas autorizadas" para la fuente con una columna excluida y el chat debajo, sin formularios duplicados.


## 19. Ajustes de experiencia en el paso 3 (✅ verificada, 25/10/2026)

Cambios incluidos en el commit de cierre del recorrido (validados además por el autor, sección 20). **Problemas detectados por el autor** en las pruebas manuales:
- los botones de validación solo eran visibles con el zoom de Chrome al 67 %;
- el rechazo con la IA deshabilitada era confuso;
- el objetivo aparecía precargado en el chat sin explicación.

| Verificación | Resultado |
|--------------|-----------|
| Frontend (`npm test`) | **108 de 108** en 13 archivos (101 anteriores, 2 adaptadas, + 7 nuevas en `test/assistantCompact.test.tsx`) |
| Backend (`python -m pytest`) | **84 de 84** (sin cambios en el backend) |
| Lint, typecheck y build pública | Sin errores |

| Requisito | Prueba |
|-----------|--------|
| Aviso de prueba con IA deshabilitada | Antes de validar se informa que no habrá respuesta de IA ni envío de datos |
| Estado final tras el rechazo 403 | «Prueba finalizada. La IA está deshabilitada y no se envió ningún dato.»; sin botones para repetir ese envío; `authorize` se llama una sola vez |
| Rechazo 501 | Estado final propio, sin envío |
| Se conserva todo | La conversación previa, el mensaje escrito, el objetivo y el resumen de la revisión siguen intactos |
| Otro mensaje, otro envío | Al cambiar el texto desaparece el resultado y vuelve «Validar este mensaje» |
| Panel compacto | Las acciones están antes del JSON; el JSON tiene altura máxima, scroll y foco de teclado; el panel está fuera de la tarjeta de altura fija |
| Objetivo inicial | Llega precargado con la indicación «Tu objetivo está preparado…», no se envía solo, se puede editar y la indicación desaparece al enviar o al borrar el texto |
| Lenguaje simple | La ayuda del objetivo aclara que no hace falta explicar cálculos, gráficos ni reportes |
| DEMO frente a OpenAI | Bajo el chat: «"Enviar" conversa con el asistente DEMO… No usa OpenAI.»; «Enviar» no valida ni autoriza nada |

**Verificación en el navegador.** Frontend con perfilado por backend y backend local propio, con la IA deshabilitada:

| Tamaño | Resultado |
|--------|-----------|
| 1366×768 (100 %) | El JSON queda limitado a 192 px y los botones se alcanzan con el scroll normal de la página |
| 1093×614 (equivale a 1366×768 al 125 %) | El panel completo (título, aviso, botón y JSON) entra en pantalla, sin scroll horizontal |
| 375×812 (móvil) | Botones antes del JSON, sin desbordes ni scroll horizontal |

El flujo real validar → autorizar contra el backend terminó en «Prueba finalizada…», con el mensaje del chat conservado. El zoom se simuló con el tamaño de ventana equivalente; no se probó con el zoom de Chrome.


## 20. Validación manual del autor: recorrido de revisión y conversación (25/10/2026)

**Evidencia aportada por el autor**, en su navegador local y con capturas. No la ejecutaron las herramientas de desarrollo; se registra tal como la informó.

| Comprobación del autor | Resultado informado |
|------------------------|---------------------|
| Revisión de datos de dos fuentes | Correcta |
| Corrección del significado estadístico de una variable | Correcta |
| Selección de columnas autorizadas para la IA | Correcta |
| Objetivo del análisis escrito en el paso 2 | Correcto |
| Objetivo precargado en el chat del paso 3, sin enviarse | Correcto |
| Resumen compacto de las dos fuentes revisadas | Correcto |
| Sin formulario duplicado dentro del asistente | Correcto |
| Diferenciación entre el asistente DEMO y la autorización para OpenAI | Correcta |
| Estado final de una prueba con `AI_ENABLED=false`, informando que no se transmitieron datos | Correcto |
| Navegación y presentación general | Correctas según las capturas aportadas |

**Cómo se distingue de las otras verificaciones:**

| Tipo | Quién | Dónde |
|------|-------|-------|
| Evidencia visual manual | Autor | Esta sección |
| Pruebas automatizadas (Vitest, pytest), lint, typecheck y build | Herramientas de desarrollo | Secciones 16 a 19 y el cierre de abajo |
| Verificación en el navegador y de red (tamaños de pantalla, flujo validar → autorizar contra el backend local, demo pública sin solicitudes) | Herramientas de desarrollo | Secciones 18 y 19 |

La evidencia del autor no incluye inspección de red. Que no se transmitieron datos a OpenAI lo respaldan:
- el estado final que muestra la interfaz;
- el rechazo del backend (`AI_ENABLED=false` → 403);
- `NotImplementedProvider`, que no hace llamadas externas (sección 15).
