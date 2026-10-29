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
| Frontend inicial (commit `e943df3`) | 28 pruebas | 📄 28 casos `it(` en los archivos de prueba de ese commit |
| Preparación para Cloudflare (commit `492b9f9`) | 29 pruebas | 📄 29 casos en ese commit (se agregó la prueba de "sin envío por red") |
| Frontend al cierre de la integración React + Pandas (commit `ac5553e`) | 41 de 41 aprobadas, 7 archivos | ✅ ejecutada en esa etapa |
| Frontend al cierre de la Fase 2 (commit `7f2c481`) | 51 de 51 aprobadas, 8 archivos | ✅ ejecutada en esa etapa |
| Frontend con la Fase 3A, antes del endurecimiento | 63 de 63 aprobadas, 9 archivos | ✅ (sección 10) |
| **Frontend actual (Fase 3A + endurecimiento)** | **66 de 66 aprobadas**, 9 archivos | ✅ `npm test` (sección 12) |
| Lint del frontend | Sin errores | ✅ `npm run lint` |
| Build de producción del frontend | Correcta | ✅ `npm run build` |
| Backend al cierre de la integración (commit `ac5553e`) | 15 de 15 aprobadas | ✅ ejecutada en esa etapa |
| Backend al cierre de la Fase 2 (commit `7f2c481`) | 26 de 26 aprobadas | ✅ ejecutada en esa etapa |
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


## 21. Fase 3B.2 — Integración con OpenAI con proveedores falsos (✅ verificada, 25/10/2026)

Cambios sin confirmar. **Ninguna prueba consumió tokens.**
- El backend usa un proveedor falso o un cliente de OpenAI simulado, y la red externa queda bloqueada: cualquier conexión hace fallar la prueba.
- El frontend usa una frontera falsa.
- **No se realizó ninguna llamada real a OpenAI.**

| Verificación | Resultado |
|--------------|-----------|
| Backend (`python -m pytest`) | **121 de 121** (84 anteriores, 4 adaptadas, + 37 en `tests/test_ai_openai.py`) |
| Frontend (`npm test`) | **117 de 117** en 13 archivos (108 anteriores; los afectados por «Comenzar conversación» se adaptaron, + 9 nuevas) |
| Lint, typecheck y build pública | Sin errores; el paquete público no contiene la dirección de OpenAI, claves ni el nombre del modelo |

| Requisito | Prueba |
|-----------|--------|
| IA deshabilitada | 403 y nada enviado; en el frontend, prueba de autorización con estado final |
| Clave ausente | 503 «Falta configurar OPENAI_API_KEY…», antes de cualquier envío |
| Contexto inválido | Lista blanca (422); historial con más de 8 turnos, rol no permitido o campos extra (422); contexto demasiado grande (413) |
| Autorización faltante, vencida, consumida o con otra huella | 404, 410, 404 y 409; tras un tiempo agotado, la autorización ya está consumida |
| Cambios posteriores a la autorización | La huella cambia con el mensaje y el historial; el frontend cancela lo validado |
| Presupuesto insuficiente | 402 antes de enviar; el proveedor no recibe nada |
| Límite de solicitudes | 429 en la solicitud que supera el límite |
| Consumo real | 1.200 tokens de entrada y 400 de salida = USD 0,00032; el registro no contiene objetivo ni columnas; persiste entre reinicios; un registro dañado bloquea y no se sobrescribe |
| Tiempo agotado | 504, una sola llamada (sin reintentos) y registro del máximo estimado |
| Error de conexión | 502, sin costo registrado |
| Credenciales, cuota, límite temporal, modelo inexistente | Mensajes comprensibles, sin la clave |
| Respuestas incompletas, rechazadas o malformadas | 502 con el motivo; se registra el consumo y no se guarda ningún plan |
| Alias o columnas no autorizados, sin planes ni preguntas, bloques de código | 502; se descarta la respuesta |
| Operación fuera del catálogo | El esquema la rechaza |
| Caso obligatorio (A: indicadores, B: SIACAM, "sin unir") | Respuesta simulada: dos planes independientes (uno por fuente), preguntas sobre `NA` y `PPRO`. Lo enviado no contiene nombres de archivo ni valores. Los planes quedan "propuestos" |
| Una y tres fuentes | Un plan por fuente |
| Llamada al proveedor | `responses.parse` con `text_format`, `max_output_tokens`, razonamiento `low`, `store=False`; cliente con `max_retries=0` y tiempo máximo |
| Aprobación de plan | Queda registrada con `executed: false`; plan inexistente: 404; `Origin` no autorizado: 403 |
| Objetivo sin duplicar | `message` igual al objetivo se omite (backend y frontend) |
| «Comenzar conversación» | Resumen del objetivo confirmado. En modo DEMO lo envía una vez; en modo IA real pasa por la autorización y la respuesta aparece solo después de autorizar |
| Conversación | Los mensajes siguientes llevan el historial y su propia autorización; las respuestas anteriores se conservan; cancelar devuelve el texto al chat |
| Errores en la interfaz | 402, 429, 502 y 504 se muestran sin reintento automático y sin perder la conversación |
| Diferenciación | Insignia «IA real · gpt-6-luna» y aviso propio; el modo DEMO conserva su aviso; la revisión del paso 2 ya no autoriza envíos |
| Demo pública | Sin cliente de IA ni solicitudes |

**Verificación en el navegador.** Backend local con `AI_ENABLED=true` y una **clave falsa**; no se autorizó ningún envío:
- modo IA real visible, con la insignia «IA real · gpt-6-luna»;
- la revisión sin botones de envío;
- resumen del objetivo y «Comenzar conversación»;
- panel con el objetivo sin duplicar y costo máximo estimado de USD 0,0015;
- «Cancelar» canceló las solicitudes validadas, y el navegador no hizo solicitudes fuera del equipo.


## 22. Error 404 al cargar datasets con `VITE_DEMO_MODE=false` (✅ corregido, 25/10/2026)

Cambios sin confirmar. **Error detectado por el autor** (evidencia del autor: DevTools/Network mostró `POST /api/datasets` → 404; curl a `POST /api/datasets/profile` con `Origin: http://localhost:5174` → 200, con el CSV sintético de 6 filas `fecha`, `sector`, `ventas`).

**Causa:** con `VITE_DEMO_MODE=false` se usaba el proveedor de la API completa, todavía no implementada en el backend. Detalle en la bitácora, sección 6o.

| Verificación | Resultado |
|--------------|-----------|
| Frontend (`npm test`) | **120 de 120** en 14 archivos, tres ejecuciones seguidas sin fallos (117 anteriores, + 2 en `test/localBackendMode.test.tsx`, + 1 de aislamiento en `lib/config.test.ts`) |
| Backend (`python -m pytest`) | **121 de 121** (sin cambios en el backend) |
| Lint, typecheck y build pública | Sin errores |

| Requisito | Prueba |
|-----------|--------|
| La carga devuelve un perfil real y no un 404 | `createService(false, false)` perfila con `POST /api/datasets/profile` y **nunca** llama a `POST /api/datasets` ni a `/api/projects`. `fetch` se simula con la respuesta **real** del backend para el CSV sintético, generada con el perfilador de Python (`test/fixtures/ventasSinteticasProfile.json`) |
| Se reconocen `fecha`, `sector` y `ventas` | Interpretados como temporal, categórica y cuantitativa en el perfil y en la revisión |
| Recorrido Cargar → Revisar → Conversar | Completo, con la IA real habilitada (frontera falsa) |
| Preparación y validación sin llamadas externas | «Comenzar conversación» valida el contexto: las tres columnas con su interpretación, sin valores ni nombre de archivo. Muestra el costo estimado y **no** se autoriza nada; la única solicitud de red de la app es el perfilado |
| Pruebas aisladas del entorno local | Con el `.env.local` del autor (`VITE_DEMO_MODE=false`), las pruebas corren como la demo pública y `fetch` sin simular se rechaza |

**Verificación en el navegador.** Con la configuración del autor (`VITE_DEMO_MODE=false`, `VITE_BACKEND_PROFILING=true`) contra un backend local propio en otro puerto, `AI_ENABLED=true` y una **clave falsa**; no se autorizó ningún envío:
- el CSV se cargó con `POST /api/datasets/profile` (200), sin 404;
- la revisión mostró las tres columnas con su interpretación;
- el asistente en modo IA real validó el contexto y mostró el costo máximo estimado (USD 0,0014);
- «Cancelar» canceló lo validado;
- el registro del backend no muestra `POST /api/datasets` ni autorizaciones.

**Demo pública (build de producción).** Recorrido hasta la respuesta del asistente DEMO, sin cliente de IA y sin solicitudes fuera del sitio.


## 23. Plan aprobado en «Confirmar» y autorización por conversación (✅ verificada, 25/10/2026)

Cambios sin confirmar.

### Evidencia aportada por el autor (llamadas reales, no ejecutadas por las herramientas)

| Consulta real | Resultado | Tokens | Costo informado |
|---------------|-----------|--------|-----------------|
| 1. Objetivo sobre el CSV sintético (`fecha`, `sector`, `ventas`, 6 filas) | Interpretó el objetivo y formuló preguntas aclaratorias | 1.265 de entrada y 493 de salida | USD 0,0004 |
| 2. Aclaraciones: `ventas` en ARS, una fila por sector y mes, sin faltantes | Incorporó las aclaraciones; propuso sumas, comparaciones entre sectores y series temporales | 1.517 de entrada y 723 de salida | USD 0,0005 |

- **Aprobación:** el autor aprobó un plan; la aplicación mostró "Plan aprobado y guardado…" y "2 planes propuestos · 1 aprobado".
- **Defecto detectado por el autor:** el paso «Confirmar» decía "Todavía no hay una propuesta".
- **Problema de uso detectado por el autor:** autorizar cada mensaje resultaba lento.

### Verificaciones de las herramientas de desarrollo (sin llamadas reales ni consumo)

| Verificación | Resultado |
|--------------|-----------|
| Backend (`python -m pytest`) | **140 de 140** (121 anteriores, + 19 en `tests/test_ai_conversation.py`) |
| Frontend (`npm test`) | **132 de 132** en 15 archivos, dos ejecuciones seguidas (120 anteriores, 2 adaptadas, + 12 en `test/aiPlanAndConversation.test.tsx`) |
| Lint, typecheck y build pública | Sin errores; el paquete público no contiene la dirección de OpenAI ni claves |

| Requisito | Prueba |
|-----------|--------|
| Propuesta estructurada en la sesión; la segunda no borra la primera | Dos respuestas con dos planes cada una: las dos quedan visibles; "4 planes propuestos · 0 aprobados" |
| Aprobar exactamente el plan elegido | Aprobar un plan de la segunda propuesta marca solo ese (`plan-2a`); la tarjeta indica "4 planes propuestos · 1 aprobado" |
| «Continuar a Confirmar» y el paso del encabezado | Ambos llevan al paso 4 con el plan aprobado |
| Plan completo en «Confirmar» | Título, fuente y archivo, motivo, columnas, operación, gráfico, limitaciones, objetivo, aclaraciones y advertencias. Solo el aprobado: el de la primera propuesta no aparece |
| Volver al asistente | Conserva planes y aprobación; ir y venir no llama a `prepare`, `authorize` ni a la conversación; no se ejecutan cálculos (`runAnalysis` sin llamadas) |
| Sin planes aprobados | Estado vacío "Todavía no aprobaste ningún plan" y sin botón de confirmación |
| Confirmación final | Requiere marcar la revisión; muestra "Propuesta confirmada" sin calcular |
| Consentimiento explícito | El primer envío muestra el panel con las dos opciones y su alcance; el JSON queda plegado |
| Autorización por mensaje | Sigue funcionando: el mensaje siguiente vuelve a mostrar el panel |
| Conversación autorizada | Los siguientes mensajes van directo (sin nueva validación), con historial y consumo visible |
| El backend exige un permiso vigente | Sin permiso 404, vencido 410, tope de mensajes 429, IA deshabilitada 403 |
| Cambio de la frontera de privacidad | Objetivo, interpretación, fuentes o columnas distintas: 409 y permiso eliminado. En la interfaz, cambiar la revisión revoca el permiso en el backend y reinicia la conversación |
| Mensajes normales | No invalidan el permiso |
| Revocación | «Desactivar autorización de conversación» llama a `DELETE`; el siguiente envío vuelve a pedir autorización |
| Límites con permiso | Solicitudes por sesión (429), presupuesto (402), tamaño del contexto (413) y validación de la respuesta (502). En la interfaz, un 402 se informa, el texto vuelve al chat y no se reintenta |
| Concurrencia | Dos envíos simultáneos en la misma conversación: 409. Seis envíos simultáneos con presupuesto para cuatro: exactamente cuatro llegan al proveedor y el gasto no supera el presupuesto |
| Origen no autorizado | `POST` y `DELETE` de conversaciones: 403 |
| Demo pública | Sin cliente de IA (pruebas anteriores y build pública) |

**Verificación en el navegador.** Backend local propio con un **proveedor falso**, sin red ni OpenAI; frontend con `VITE_DEMO_MODE=false`:
- el primer envío mostró las dos opciones; con «Autorizar esta conversación», el segundo mensaje se envió directo (2 respuestas, sin panel);
- aprobar el plan de la segunda propuesta mostró el aviso, y «Continuar a Confirmar» llevó al paso 4 con el plan completo, la aclaración y la advertencia;
- volver por el encabezado conservó el plan aprobado;
- «Desactivar autorización de conversación» hizo `DELETE` en el backend, y el siguiente mensaje volvió a pedir autorización;
- el navegador no hizo solicitudes fuera del equipo.

El registro de consumo de esa verificación (solo con datos simulados) se guardó en una carpeta temporal y se eliminó.


## 24. Fase 4A — Motor de análisis con Pandas (✅ verificada, 25/10/2026)

Cambios sin confirmar. **Sin llamadas reales a OpenAI ni consumo.** El motor se prueba con archivos reales y Pandas real; la IA está deshabilitada o simulada.

| Verificación | Resultado |
|--------------|-----------|
| Backend (`python -m pytest`) | **169 de 169** (140 anteriores, + 29 en `tests/test_analysis_engine.py`) |
| Frontend (`npm test`) | **139 de 139** en 16 archivos, tres ejecuciones seguidas (132 anteriores, + 7 en `test/analysisExecution.test.tsx`; a una prueba larga se le amplió el tiempo límite) |
| Lint, typecheck y build pública | Sin errores |

**Caso obligatorio** (CSV sintético `fecha,sector,ventas`, 6 filas, ARS):

| Valor esperado | Resultado de Pandas |
|----------------|---------------------|
| Enero: 23.000 ARS | ✅ 23000.0 (`time_series`, período `2026-01`) |
| Febrero: 27.500 ARS | ✅ 27500.0 |
| Marzo: 32.000 ARS | ✅ 32000.0 |
| Tecnología: 54.000 ARS | ✅ 54000.0 (`group_by` por `sector`) |
| Indumentaria: 28.500 ARS | ✅ 28500.0 |
| Total general: 82.500 ARS | ✅ 82500.0 (`sum`), 6 filas usadas |

| Requisito | Prueba |
|-----------|--------|
| Promedio, mínimo, máximo, mediana, conteo, comparación, frecuencias y distintos | Promedio por sector: 9.500 y 18.000; mínimo 8.000; máximo 21.000; mediana 13.000; 3 registros por sector; participación de Tecnología: 65,45 %; frecuencias 3 y 3; distintos: 2 sectores y 3 fechas |
| Plan sin aprobación o inexistente | 409 «no está aprobado» y 404 «Pedí la propuesta de nuevo» |
| Archivo faltante u otro archivo | 422 «Falta el archivo de la fuente A» y 422 «¿se cargó otro archivo?» |
| Columnas no autorizadas | El plan queda en error, con el motivo |
| Tipos incompatibles | Sumar una categórica, promediar una temporal, serie temporal sin columna temporal, sumar un identificador: error comprensible en esa operación, el resto sigue y el plan queda "parcial" |
| Operaciones no disponibles | `std` y `correlation`: «todavía no está disponible», sin reemplazo |
| Fechas inválidas | Quedan en el grupo «(sin dato)», con advertencia |
| Faltantes | La celda vacía nunca suma. `NA` sin decidir: se excluye y se avisa. `NA` «tratar como faltante»: se excluye sin aviso. Los registros se cuentan todos |
| Columnas renombradas | El nombre que vio la IA se traduce a la columna real |
| Dos fuentes independientes | Resultados separados para A y B (B con años), sin unir |
| Originales y almacenamiento | El contenido no cambia y no se crea ningún archivo |
| Seguridad del endpoint | `Origin` externo: 403; archivo de más de 25 MB: 413; pedido inválido: 422 |
| Límite de resultados | 600 grupos se recortan a 500, con advertencia |
| Conversión de números y fechas | `15.000`, `1.234,56`, `1,234.56`, `3,5`; formato `dd/mm/aaaa` |
| Interfaz | «Ejecutar análisis» solo después de la confirmación final. Envía el `File` original y la correspondencia de columnas, con la unidad ARS. Muestra 23.000/27.500/32.000, 54.000/28.500 y 82.500 ARS. Informa la operación no disponible y el estado "Parcial". No consulta a la IA. Los resultados se conservan al navegar. Muestra los errores del backend. Sin backend no hay motor |

**Verificación en el navegador.** Backend local con el **motor real** y un **proveedor de IA falso** (sin red ni OpenAI); frontend con `VITE_DEMO_MODE=false`:
- se cargó el CSV obligatorio, se aprobó el plan, se confirmó y se pulsó «Ejecutar análisis» con la unidad ARS;
- la aplicación mostró 2026-01: 23.000 ARS, 2026-02: 27.500 ARS y 2026-03: 32.000 ARS; Indumentaria: 28.500 ARS y Tecnologia: 54.000 ARS; total: 82.500 ARS, con 6 filas usadas;
- el registro del backend muestra un solo `POST /api/analysis/execute`, y el navegador no hizo solicitudes fuera del equipo.


## 25. Fase 4B — Dashboard con resultados reales (✅ verificada, 25/10/2026)

Cambios sin confirmar. **Sin llamadas reales a OpenAI ni consumo.** Las pruebas usan la respuesta **real** del motor Pandas (`test/fixtures/dashboardResponse.json`, generada con `analysis_engine.py` para el CSV obligatorio y una fuente B independiente).

| Verificación | Resultado |
|--------------|-----------|
| Frontend (`npm test`) | **151 de 151** en 17 archivos, dos ejecuciones seguidas (139 anteriores, + 12 en `test/dashboard.test.tsx`; 4 selectores adaptados en `analysisExecution.test.tsx`) |
| Backend (`python -m pytest`) | **169 de 169** (sin cambios en el backend) |
| Lint, typecheck y build pública | Sin errores |

| Requisito | Prueba |
|-----------|--------|
| Los gráficos usan resultados reales del motor | Datos del gráfico idénticos a las filas del motor |
| Evolución mensual por sector | Líneas (tipo pedido por el plan) con una serie por sector: enero 8.000 y 15.000, febrero 9.500 y 18.000, marzo 11.000 y 21.000, en ARS |
| Sin duplicar al combinar agrupaciones | La suma de las series de cada mes da 23.000, 27.500 y 32.000 (el total mensual del motor). Cada serie suma su total: 54.000 y 28.500 |
| Total mensual, comparación e indicador | Líneas con 23.000, 27.500 y 32.000. Torta pedida por el plan con 28.500 y 54.000. Indicador "Suma de ventas" de 82.500 ARS |
| Selección según el plan | Se muestran solo los gráficos que corresponden (dos de líneas y una torta). La dispersión pedida no se fabrica: se explica |
| Torta solo con proporciones válidas | Con promedios o valores negativos no se construye, y se explica por qué |
| Líneas pedidas sobre categorías | No se construyen; se explica y la operación conserva sus barras estándar |
| Unidades | ARS y kg en gráficos separados; unidad en el eje, los tooltips y las tablas |
| Demasiadas categorías | Con 40 grupos, solo la tabla y una explicación |
| Fuentes independientes | Secciones "Fuente A · ventas.csv · 6 filas" y "Fuente B · siacam.csv · 3 filas". B muestra solo sus valores (150 y 70 USD, en barras como pidió el plan) y A no contiene cifras de B |
| Errores parciales | La operación inválida se muestra con su motivo y el plan queda "Parcial" |
| Sin resultados | Avisos "Sin resultados para mostrar" y "Este plan no produjo resultados para mostrar", sin gráficos |
| Sin solicitudes inesperadas | Mostrar el dashboard no llama a `fetch` (ni a OpenAI); ejecutar no llama a la IA |
| Demo pública | Pruebas anteriores de la demo sin cambios y build pública sin motor |

**Verificación en el navegador.** Motor Pandas **real** y proveedor de IA **falso** (sin red ni OpenAI); frontend con `VITE_DEMO_MODE=false`; CSV obligatorio con la unidad ARS:
- **Escritorio (1.366 px):**
  - indicador de 82.500 ARS;
  - tres gráficos: la evolución mensual por sector, en líneas, con leyenda (Indumentaria y Tecnologia) y ejes «fecha (mes)» y «ARS»; la torta de participación; y el total mensual;
  - tablas detalladas;
  - sin desplazamiento horizontal.
- **Móvil (375 px), carga nueva:** los gráficos ocupan el ancho del contenedor, sin desplazamiento horizontal.
- **Tras ejecutar:** el dashboard queda a la vista.
- **Problemas detectados y corregidos:** las líneas quedaban sin dibujar por la animación; el desplazamiento suave no se producía; y la barra fija tapaba el dashboard en móvil (bitácora, sección 6r).


## 26. Modo real sin respuestas simuladas y catálogo único (✅ verificada, 26/10/2026)

Cambios sin confirmar. **Sin llamadas reales a OpenAI ni consumo.** El proveedor simulado se usa solo en las pruebas.

| Verificación | Resultado |
|--------------|-----------|
| Backend (`python -m pytest`) | **189 de 189** (169 anteriores, 2 adaptadas, + 20 nuevas) |
| Frontend (`npm test`) | **167 de 167** en 18 archivos, dos ejecuciones seguidas (151 anteriores; 5 pruebas de la "prueba de autorización" se reemplazaron por 5 de "IA no disponible"; + 16 en `test/realMode.test.tsx`) |
| Lint, typecheck y build pública | Sin errores |

| Requisito | Prueba |
|-----------|--------|
| Sin caída al DEMO | Con `AI_ENABLED=false`, sin clave o sin proveedor: alerta con el motivo exacto y «No se muestran respuestas simuladas»; insignia «IA no disponible»; «Comenzar conversación» y el chat deshabilitados. No se llama a `getConversation` ni a `sendMessage` del servicio DEMO, ni a `prepare` |
| Backend inaccesible | «No se pudo consultar al backend…». Con «Reintentar» y el backend disponible, se habilita la IA real |
| Mientras se comprueba | «Comprobando la conexión con la IA…», con el chat deshabilitado y sin saludo DEMO |
| Sin datos ficticios en modo real | No se ofrece el dataset de ejemplo. «Confirmar» no consulta ni muestra la propuesta DEMO. La franja dice "Ejecución con backend… sin respuestas ni resultados simulados" |
| Demo pública | Conserva su dataset de ejemplo y su franja identificada |
| Catálogo único | Operaciones del motor igual a las de la IA. `std`, `percentage`, `top_n`, `correlation`, `missing_summary` y `exec_python` rechazadas por el esquema. Gráficos `scatter`, `histogram`, `box` y `roc` rechazados hasta que existan. El motor sigue informando una operación desconocida |
| Instrucciones | Listan exactamente el catálogo y piden partir de la pregunta, no repetir planes y explicar lo imposible ("modelo entrenado") en lugar de aproximarlo |
| Historial | El turno anterior incluye las operaciones del plan (`sum(monto por pais)`) |
| Metadato aproximado | `distinct_values` acepta solo rangos y rechaza cantidades exactas (422). En el frontend, 2 valores dan "2", 102.254 dan ">500" y sin perfil no se envía |

**Verificación en el navegador.** Backend real (sin proveedor simulado) con `AI_ENABLED=false` y sin clave; frontend con `VITE_DEMO_MODE=false`. Imposible llamar a OpenAI.
- «Cargar» no ofreció el dataset de ejemplo.
- La revisión mostró `distinct_values` ("2" y "3-10").
- El asistente mostró «La IA no está disponible» con el motivo `AI_ENABLED=false`, el chat y «Comenzar conversación» deshabilitados, y ningún texto del asistente DEMO.
- Con el backend detenido, «Reintentar» mostró «Comprobando…» y luego «No se pudo consultar al backend».


## 27. Histograma, dispersión y curva ROC (✅ verificada, 26/10/2026)

Cambios sin confirmar. **Sin llamadas reales a OpenAI ni consumo.** La IA y el motor se simulan solo en las pruebas que lo indican. El fixture `visualResponse.json` es la salida real del motor.

| Verificación | Resultado |
|--------------|-----------|
| Backend (`python -m pytest`) | **209 de 209** (189 anteriores, 4 adaptadas, + 20 en `tests/test_visual_analyses.py`) |
| Frontend (`npm test`) | **173 de 173** en 19 archivos, dos ejecuciones seguidas (167 anteriores, 3 adaptadas, + 6 en `test/visualAnalyses.test.tsx`) |
| Lint, typecheck y build pública | Sin errores |
| Estabilidad | Con `testTimeout: 15_000` en Vitest, 4 de 4 ejecuciones con la suite del backend en paralelo: 173 de 173. Antes, un recorrido largo superaba los 5 s por defecto bajo carga |
| Dependencias | `scikit-learn==1.9.1` y `numpy>=2.0,<3` declaradas; `pip check`: sin dependencias rotas |

| Requisito | Prueba |
|-----------|--------|
| Histograma con frecuencias conocidas | 0 a 7: 4 intervalos de 1,75 con 2, 2, 2 y 2. Valores sesgados: 6, 0, 0, 1. Celda vacía excluida. Columna constante: un intervalo y aviso |
| Histograma con tipos incompatibles | Categórica o código: error comprensible |
| Dispersión | Puntos exactos. Pearson 0,7745967 y Spearman 0,7378648 (valores de referencia). Unidades en las medidas. Aviso de causalidad |
| Límite de puntos | 2.500 pares dan 2.000 puntos, con la misma muestra en dos ejecuciones (semilla fija). Correlaciones con los 2.500. Aviso |
| Pares incompletos | Se excluyen y se avisa |
| ROC perfecta | AUC = 1; la curva pasa por (0, 1) y va de (0, 0) a (1, 1) |
| ROC conocida | AUC = 0,75 (calculado a mano) y los puntos exactos de la curva |
| Clase positiva | Elegir la otra clase da AUC 0,25, con aviso de inversión. Sin elegir: error. Valor inexistente: error |
| Clases y puntuaciones | Tres clases: error. Puntuación categórica: error. Una sola clase tras excluir faltantes: error |
| Validación del plan de la IA | ROC sobre una etiqueta no binaria, puntuación no numérica, histograma de una categórica, dispersión con una sola columna o con agrupación: el backend la descarta. Recorrido completo con el proveedor simulado: 502 y ningún plan guardado |
| Independencia y operaciones anteriores | A (suma e histograma) y B (ROC) por separado, con resultados correctos para cada una |
| Dashboard | Histograma con las frecuencias del motor. Dispersión con 8 puntos, títulos con unidad e indicadores r 0,947 y ρ 0,952. ROC con los puntos de scikit-learn, AUC 0,75 y la clase positiva. Un pedido de líneas sobre el histograma se explica y no se fabrica. B no muestra cifras de A. Sin solicitudes de red |
| Clase positiva en la interfaz | Selector con las clases `no` y `si` del perfil local. «Ejecutar análisis» bloqueado hasta elegir. `positive_label: "si"` solo en la columna de etiquetas. No llega a la IA. Ejecutar no vuelve a consultar a la IA |

**Verificación en el navegador.** Motor real (Pandas, NumPy y scikit-learn) y proveedor de IA **simulado** (lanzador fuera del repositorio, sin red ni OpenAI); CSV sintético de 12 filas (`publicidad`, `ventas`, `real` binaria y `score`):
- **Revisión:** `real` como categórica con `distinct_values` "2".
- **Plan:** el simulado (histograma, dispersión y ROC) pasó la validación.
- **Clase positiva:** «Ejecutar análisis» bloqueado hasta elegir «si».
- **Dashboard:**
  - indicadores r = 0,96, ρ = 0,96, 12 pares, AUC = 0,94, 6 positivos y 6 negativos;
  - dispersión con 12 puntos, ROC con su diagonal e histograma de Sturges (5 intervalos: 3, 1, 3, 1, 4);
  - sin desplazamiento horizontal en móvil (375 px).
- **Verificación manual del AUC:** 34 de 36 pares positivo-negativo bien ordenados da 0,944.

## 28. Correcciones de seguridad para la beta pública (✅ verificada, 26/10/2026)

Cambios sin confirmar. **Sin llamadas reales a OpenAI ni a Cloudflare, sin consumo y sin despliegue.** Las pruebas no leen `backend/.env` (`tests/conftest.py`) y bloquean toda conexión externa.

| Verificación | Resultado |
|--------------|-----------|
| Backend (`python -m pytest`) | **260 de 260**: 209 anteriores (2 reemplazadas por pruebas sobre SQLite y 3 nuevas de presupuesto) y 50 en `tests/test_security.py` |
| Frontend (`npm test`) | **187 de 187** en 21 archivos (173 anteriores + 10 en `src/test/access.test.tsx` + 4 en `src/lib/buildChecks.test.ts`) |
| Lint, typecheck y build | Sin errores; la build genera `dist/_headers` |
| Dependencias | `npm audit --omit=dev`: 0. Sin dependencias Python nuevas (`sqlite3` es de la biblioteca estándar; `httpx` ya estaba) |

| Requisito | Prueba |
|-----------|--------|
| Sin sesión, rechazado | 9 rutas de IA y sesión: 401 con `WWW-Authenticate: Bearer`. Perfilado y ejecución: 401 **sin leer el cuerpo** (llamada ASGI directa: 0 bytes consumidos) |
| Token inválido o vencido | Token inventado, esquema `Basic`, `Bearer` vacío o de 300 caracteres: 401. Sesión de 12 h vencida: 401. Invitación revocada o vencida: sus sesiones dejan de valer. Cerrar sesión revoca el token |
| Canje | Código inexistente: 401 con mensaje genérico. Cuerpo inválido o con campos extra: 422. Un código abre como máximo 3 sesiones (se cierra la más antigua). La base no contiene el código ni el token en claro |
| Turnstile | Sin token o con uno falso: 403. El verificador rechaza otro nombre de host, otra acción, `success: false`, un token demasiado largo y un error de red |
| Acceso cruzado | B, con el identificador y la huella de la solicitud de A: 404 y nada enviado; B no puede cancelarla. La conversación autorizada por A: 404 para B, que tampoco puede revocarla. El plan de A: B no puede aprobarlo ni ejecutarlo (404); A sí |
| Cuotas | 2 consultas diarias por visitante: la tercera de A da 429 y B sigue pudiendo. Cuota en USD: 402 «tu cuota». Presupuesto global: 402 «global» para un tercer visitante. Tope diario del servicio: 429. 5 solicitudes pendientes por visitante |
| Concurrencia | Dos envíos simultáneos del mismo visitante: 200 y 409. Seis visitantes en paralelo con presupuesto para cuatro: 4 × 200 y 2 × 402, sin superar el presupuesto. Perfilado: 1 por visitante |
| Persistencia | Tras «reiniciar» (otra aplicación sobre el mismo archivo): la sesión sigue valiendo, el gasto y las consultas del día se conservan y el código se puede volver a canjear. Una reserva abandonada se cobra por su máximo. El JSON anterior se importa una sola vez; uno dañado impide arrancar |
| Base no disponible | Reservar: 503, nada enviado; el estado informa 0 disponible |
| Archivos | Con `MAX_UPLOAD_MB=1`: 1,2 MB da 413. Con `MAX_DATASET_CELLS=1000`: 1.200 celdas dan 422 |
| Límite por IP | 10 pedidos por minuto: los dos siguientes dan 429. Canje: 3 intentos y después 429 |
| Producción | No arranca sin Turnstile (clave o dominio), con un origen `http://`, sin `FORWARDED_IP_HOPS`, sin disco persistente confirmado, con una ruta relativa o con la carpeta de la base inexistente (y no la crea); en Render, sin `ENVIRONMENT=production`. Pedidos sin HTTPS: 403 (salvo `/api/health`). `/docs`, `/redoc` y `/openapi.json`: 404. HSTS presente. Un origen ajeno no recibe permiso CORS |
| Proxy de confianza | Un visitante que cambia la primera IP de `X-Forwarded-For` en cada pedido igual recibe 429 a partir del pedido 11 (cuenta la IP que agregó el proxy); otra IP real no queda bloqueada. Turnstile sin acción: rechazado |
| DEMO accidental | `publicBuildProblems`: en Cloudflare Pages, `VITE_DEMO_MODE` ausente, `true` o inválido, backend `http://`, localhost o URL inválida y falta de clave de Turnstile cortan la compilación. Compilación real simulada (`CF_PAGES=1 VITE_DEMO_MODE=true`): falla con el mensaje; con la configuración real: compila y `_headers` apunta al backend |
| Encabezados y registros | CSP, nosniff, DENY, no-referrer y `no-store` en toda respuesta (incluido un 404). Identificadores y consultas ocultos en los registros de acceso |
| Frontend | Authorization solo con sesión; nada en `localStorage`; un 401 borra la sesión; una sesión vencida no se usa; si el almacenamiento falla, sigue en memoria. Pantalla de ingreso: aviso de privacidad, código inválido con error, Turnstile exigido sin clave del sitio bloquea el ingreso; la demo pública no tiene puerta; cerrar sesión descarta la aplicación. CSP: `connect-src` solo hacia el backend, sin `unsafe-eval` |

**Verificación en el navegador.** Backend lanzado sin `.env` (IA deshabilitada, sin clave) con una base temporal fuera del repositorio; frontend con perfilado por backend:
- sin sesión, la aplicación muestra solo la pantalla de acceso con el aviso de privacidad, y `/api/ai/status` responde 401;
- un código inventado muestra «El código de invitación no es válido, venció o fue revocado.»;
- con un código de prueba creado por `python -m app.cli invite`, se ingresa y la franja muestra la etiqueta y «Cerrar sesión»;
- un CSV sintético se perfila con sesión (`POST /api/datasets/profile` → 200); en el navegador solo queda `datadecision.access` en `sessionStorage` y nada en `localStorage`;
- «Cerrar sesión» vuelve a la pantalla de acceso y borra el token;
- la API devuelve los encabezados de seguridad (`curl -i /api/health`).

**Recorrido con uvicorn real (revisión final).** Backend en `localhost` con la IA deshabilitada, la clave vacía y una base temporal; dos invitaciones creadas con `python -m app.cli invite` (el listado no muestra códigos):
- sin sesión, `/api/ai/status` y el perfilado responden 401; un código inventado, 401;
- el visitante A canjea su código, consulta su cuota y perfila un CSV (200);
- B no puede autorizar la solicitud de A; con la IA deshabilitada, A recibe «No se envió nada»;
- tras **reiniciar el servidor**, la sesión de A sigue vigente; al cerrar sesión, 401;
- los registros del servidor no contienen ni el token ni los códigos.

## 29. Motor analítico generalista (✅ verificada, 26/10/2026)

Cambios sin confirmar. **Sin llamadas reales a OpenAI ni consumo.** La IA se simula solo en las pruebas y en el servidor de prueba local.

| Verificación | Resultado |
|--------------|-----------|
| Backend (`python -m pytest`) | **272 de 272**: 260 anteriores (6 adaptadas) y 12 en `tests/test_general_engine.py` |
| Frontend (`npm test`) | **197 de 197** en 22 archivos: 187 anteriores (4 adaptadas) y 10 en `src/test/generalEngine.test.tsx` |
| Lint, typecheck y build | Sin errores |

**Seis datasets sintéticos** (`tests/test_general_engine.py`). Cada uno recorre perfilado real, revisión que acepta las sugerencias y motor Pandas, y se compara con valores calculados a mano:

| Dataset | Qué se verifica |
|---------|-----------------|
| 1. Ventas: fechas diarias, rubros y montos `$ 1.200,50` | Monto cuantitativo con unidad `$`. Total 7.352,25; 2.450,75 por mes (los días se resumen por mes); 6.001,5 y 1.350,75 por rubro |
| 2. Indicadores económicos en formato largo, con unidades distintas | Se sugiere que `dato` depende de `serie` y `unidad`. Ningún total mezcla magnitudes. Serie **anual** (no «2022-01»). Las ventas externas se suman por año (300 y 320) y el porcentaje se promedia (7,5, no 15), con aviso. No hay unidad global |
| 2b. Tasa en % | Sugerida como no aditiva. `sum`: error comprensible; promedio 46,75; la evolución promedia regiones (46,5 y 47,0) |
| 3. Educación: matrícula por nivel y trimestre `2023-Q1` | Período trimestral («2023-T1»). Un dato por nivel y trimestre: valor tal cual. La tasa de promoción (0 a 1) es no aditiva y se promedia |
| 4. Faltantes y tipos ambiguos | Legajo con ceros = código. `-99` sugerido como marcador. Sin decidir, el promedio lo incluye; declarado, se excluye (promedio exacto). `NA` sin decidir, con aviso; tratado como faltante, sin aviso. Columna mixta = texto con confianza baja |
| 5. Clasificación | Probabilidad no aditiva. ROC con AUC = 8/9 (calculado a mano) |
| 6. Fechas con nombre de mes y tres dimensiones | `ene-2024` es temporal. Cubo mes × región × canal con 18 filas y valores exactos; serie por canal; frecuencias por región y canal |

| Pedidos incompatibles | Resultado |
|-----------------------|-----------|
| Histograma de una medida que depende de un indicador | Error: «mezclaría magnitudes incompatibles» |
| Serie temporal sin columna temporal | Error: «requiere una columna temporal validada» |
| Agrupar por una cantidad continua | Error que sugiere un histograma |
| Plan de la IA con una serie válida, un histograma de una medida dependiente y una suma de una tasa | Quedan solo las operaciones válidas. Los dos descartes, con su motivo, en las limitaciones del plan |
| `split_by` hacia una columna no compartida | Rechazado por el esquema |

**Frontend** (`src/test/generalEngine.test.tsx`):
- **Vista por defecto de un cubo de 3 dimensiones:** eje temporal, la dimensión con menos categorías como series y el resto filtrado, con los valores exactos del motor.
- **Cambios de vista:** cambiar el eje o el filtro da vistas válidas.
- **Dimensión temporal en otra posición:** se reconoce aunque no sea la primera.
- **Formato largo:**
  - el indicador y la unidad se filtran y nunca van a las series;
  - un total por indicador se muestra como indicadores separados;
  - al cambiar de indicador, la unidad se ajusta sola (filtros encadenados).
- **Muchas categorías:** se muestran las 6 de mayor valor, con aviso.
- **Estado global:** completo, parcial o vacío.
- **Revisión de las medidas:**
  - sugerencias aceptadas por defecto, con corrección de la dependencia;
  - `-99` solo se aplica si la persona lo elige;
  - la IA recibe unidad, aditividad y dependencia, sin ningún valor.
- **Datos sintéticos:** CSV determinísticos e identificados como datos de prueba.

**Pruebas adaptadas:**
- **Catálogo y validación:** la verificación exacta de la lista blanca suma los tres metadatos. Los planes visuales imposibles ahora se descartan (no rechazan la respuesta).
- **Caso obligatorio:** la respuesta simulada incluye la columna temporal que le faltaba.
- **Presupuesto y truncado:** los montos se calculan a partir de la estimación, y el truncado usa 600 combinaciones de dos columnas.
- **Unidad y resultados:** la unidad se indica en «Revisar» y los resultados están en el paso 5.

**Verificación en el navegador.** Backend real con IA **simulada** (`scripts/simulated_ai_server.py`), frontend con backend, dataset sintético de indicadores (54 filas):
- **Revisión:** sugiere que `valor` depende de `indicador` y `unidad`, con su motivo.
- **IA simulada:** propone una serie por región, un total y un histograma. El histograma se descarta antes de la aprobación, con el motivo visible en el plan.
- **Resultados (paso 5):**
  - «Análisis completo», 2 de 2 operaciones;
  - indicadores por magnitud: desempleo 7,4 % (promedio), exportaciones 5.940 millones USD y población 14.557.500, que coinciden con el cálculo manual;
  - líneas por región con el filtro indicador/unidad: al elegir «exportaciones», la unidad pasa sola a «millones USD».
- **Móvil:** sin desplazamiento horizontal a 375 px.


## 30. Informe interpretativo y exportación PDF (✅ verificada, 27/10/2026)

Cambios sin confirmar. **Sin llamadas reales a OpenAI ni consumo.** La IA se simula con `FakeProvider.interpret` en las pruebas y con `scripts/simulated_ai_server.py` en el navegador.

| Verificación | Resultado |
|--------------|-----------|
| Backend (`python -m pytest`) | **285 de 285**: 273 anteriores y 12 en `tests/test_report.py` |
| Frontend (`npm test`) | **204 de 204** en 23 archivos: 197 anteriores y 7 en `src/test/report.test.tsx` |
| Lint, typecheck y build | Sin errores. jsPDF queda en un fragmento aparte (`jspdf.es.min`, 126 KB gzip) que solo se descarga al generar el PDF |

**Backend** (`tests/test_report.py`), con el dataset sintético de ventas de 72 filas (el mismo que genera el frontend):

| Prueba | Qué se verifica |
|--------|-----------------|
| Exactitud del resumen | Total **69.060 ARS**. Alimentos pasó de 5.080 a 5.580 ARS (+500, +9,8 %). Comparación por canal con participación. Histograma de 72 valores. Todo con la IA deshabilitada |
| Formato largo (indicadores económicos) | Tres hechos separados (7,5 %, 3.000.000 personas y 620 millones USD), nunca un total mezclado. Serie de ventas externas 300 → 320 |
| Resultados parciales | La operación fallida no produce hechos y conserva su motivo. Estado `partial` y nota «1 de 3 operaciones no se pudieron calcular» |
| Autorización y verificación | Preparar no envía nada y muestra objetivo, refs y costo. La IA recibe exactamente lo mostrado. Se descartan una cifra inventada (45.000), una frase causal («provoca») y un hallazgo que cita una operación inexistente. Consumo registrado. La autorización no se puede reutilizar |
| Dispersión y ROC | El contexto no lleva puntos (solo estadísticos) ni la clase positiva. AUC 0,889 en el resumen. Aviso de causalidad en la correlación |
| Operación fallida citada por la IA | El hallazgo se descarta y la nota identifica `P1.O2` como «no se interpreta» |
| IA deshabilitada | El resumen existe, autorizar da 403 y el proveedor no recibe nada |
| Contenido alterado y respuesta sin respaldo | Otra huella: 409, sin envío. Una respuesta sin cifras verificables: 502 |
| Aislamiento | Otro visitante no puede preparar con un `execution_id` ajeno ni autorizar una solicitud ajena (404). Una solicitud de interpretación no sirve en el endpoint de planes. Sin sesión: 401 |
| Lectura de cifras | Aceptadas: 69.060, 69060, 9,8 y 10 (redondeo), 0,89 y 72. Rechazadas: 45.000, 9,7, 0,5, 70.000 y 13,4. «0,5» no se lee como «5» |
| Aclaraciones | «La correlación no implica causalidad» se conserva y «se debe a la inflación» se descarta |

**Frontend** (`src/test/report.test.tsx`), con la respuesta del motor **real** para ese dataset (`fixtures/salesReportResponse.json`, con una operación fallida):
- **Modelo del informe:** fuentes (72 registros), metodología `P1.O1` a `P1.O5` con la fallida, indicador 69.060 ARS, gráficos sin animación y tablas sin la operación fallida.
- **Resumen en pantalla:** identificado como «Calculado con Pandas · sin IA», con el motivo de la operación fallida.
- **Autorización explícita:** el panel muestra el JSON exacto, el costo (USD 0.0021) y qué nunca se envía. Nada se envía hasta pulsar «Autorizar y enviar». La interpretación se marca «Generada por IA · verificada», con sus refs en la vista previa.
- **Cancelar:** cancela la solicitud en el backend y no envía nada.
- **Sin IA:** no aparece el botón. La vista previa y el PDF dicen «No se incluyó una interpretación con IA» y usan solo el resumen.
- **PDF:** se genera con y sin interpretación (encabezado `%PDF-`, 2 o más páginas). Los caracteres fuera de Latin-1 se reemplazan.

**Verificación en el navegador.** Backend real con IA **simulada**, frontend con backend y dataset sintético de ventas:
- **Resumen:** coincide con los valores verificados (69.060 ARS; 5.080 → 5.580 ARS en Alimentos).
- **Panel de autorización:** el contenido tiene solo agregados (18 filas de la serie, 1 total, 8 intervalos), sin nombre de archivo, y un costo máximo de USD 0.0015 (~2.523 tokens).
- **Verificación de la respuesta:** la IA simulada incluye a propósito una cifra inventada («37 %») y una frase causal. Ambas se descartaron y se informó.
- **PDF (interceptado en la página, sin guardarlo en el equipo):** 4 páginas, 43 KB, con los **2 gráficos reales** como imágenes. El texto extraído tiene, en orden: título y fechas, objetivo, fuentes (72 registros), metodología, indicador, tablas, resumen «sin IA» e interpretación «Redactada por la IA… verificada». Sin errores en la consola.

### 30b. Revisión final: verificación por claims (✅ 27/10/2026)

La verificación anterior solo exigía que cada cifra existiera en los resultados. Ahora cada cifra se declara como claim y se **recalcula**.

| Verificación | Resultado |
|--------------|-----------|
| Backend | **292 de 292**: 273 anteriores y 19 en `tests/test_report.py` |
| Frontend | **205 de 205** en 23 archivos: 197 anteriores y 8 en `src/test/report.test.tsx` |
| Lint, typecheck y build | Sin errores |

**Pruebas de exactitud** (`tests/test_report.py`, dataset de ventas de 72 filas, total 69.060, e indicadores en formato largo):

| Caso | Ejemplo | Resultado |
|------|---------|-----------|
| Claims correctos | Total 69.060 ARS; Alimentos +500 ARS y +9,8 % (2025-01 → 2025-06); Local 79 % y 54.840 ARS | Verificados. El valor guardado es el recalculado (9,84…) |
| Atribución equivocada | «Bebidas vendió 5.580 ARS en 2025-06» (la cifra es de Alimentos) | Descartada: no nombra «Alimentos» |
| | Claim de Bebidas con 5.580 | Descartada: el resultado es 4.060 ARS |
| | «Alimentos… más que Bebidas» | Descartada: nombra otra categoría |
| | Cifra sin rubro | Descartada: no identifica todas sus categorías |
| Período incorrecto | 5.580 en 2025-05; texto «entre 2025-01 y 2025-05» con claim hasta 2025-06; período 2025-07 | Descartadas: el resultado es 5.480, no nombra «2025-06», período inexistente |
| Unidades incompatibles | 69.060 USD; «69.060 %»; sin unidad; desocupación «7,5 personas» | Descartadas. «7,5 %» con indicador y unidad completos: verificada |
| Porcentajes erróneos | +12 % (real 9,84 %); 80 % (real 79,41 %) | Descartados con el valor real |
| Dirección y signo | «cayó 9,8 %» con variación positiva; claim −9,8 | Descartados |
| Causalidad | «… debido a la inflación»; «La publicidad provoca…» | Descartadas. «No implica causalidad» se conserva como no verificada |
| Cifras sin declarar | «Alimentos creció 500 ARS» sin claim; «Bebidas 700 ARS» de más | Descartadas. Una frase sin cifras queda como no verificada |
| Operaciones fallidas | Claim o evidencia en una operación con error | Descartados |
| Agrupación a nivel de registro | 3 clientes, 3 filas | Las filas no viajan a la IA (`rows_withheld`) y la cifra no se puede verificar |
| Aislamiento | Ejecución o solicitud de otra sesión | 404, sin cifras de la otra sesión en la respuesta |

**Frontend:** la vista previa separa «Hallazgos principales» (solo verificados) de «No verificadas automáticamente». El PDF, generado **sin comprimir** en la prueba para leer su texto, incluye: objetivo con tildes, resumen ejecutivo descriptivo, hallazgos calculados, «69.060 ARS», «Se listan 25 de 30 filas», «Vista predeterminada», el aviso de gráfico no convertido, «Hallazgos respaldados por los cálculos» con sus refs, el bloque de no verificadas, advertencias y numeración de páginas.

**Flujo completo en el navegador** (backend real, IA simulada, dataset de ventas). La IA simulada incluye a propósito una atribución a otro rubro, un porcentaje del 37 % y una frase causal. Las tres se descartaron con su motivo, y se conservó la afirmación verificada sobre Alimentos.

**Revisión visual del PDF:** se guardó en una carpeta temporal y se revisó página por página. Tildes, separadores de miles, unidades, tablas, gráficos, leyendas y pie se ven bien. La revisión encontró dos defectos, ya corregidos:
- el título de un gráfico quedaba solo al pie de la página 1;
- las notas de verificación aparecían dentro de «Limitaciones señaladas por la IA».

## 31. Auditoría defensiva (✅ verificada, 28/10/2026)

Cambios sin confirmar. **Sin pruebas contra producción, sin créditos y sin invitaciones reales.** Solo archivos sintéticos y proveedores falsos.

| Verificación | Resultado |
|--------------|-----------|
| Backend | **308 de 308**: 292 anteriores y 16 en `tests/test_resilience.py` |
| Frontend | **205 de 205** (2 textos y 4 fixtures actualizados) |
| Lint, typecheck y build | Sin errores |

| Prueba (`tests/test_resilience.py`) | Qué demuestra |
|------|---------------|
| Cupo compartido de tareas pesadas | Con 2 tareas de otros visitantes en curso, perfilar y ejecutar dan 429; al liberarse, 200. El cupo vuelve a 0 |
| Un visitante no perfila mientras ejecuta | 429 con su propia tarea en curso |
| Límites por invitación | 3.er perfilado y 2.ª ejecución: 429 con `Retry-After`. Otra invitación sigue en 200 |
| Tope de tiempo (cooperativo) | Con un reloj simulado, la 1.ª operación se calcula (69.060) y las siguientes se informan «no calculadas»: plan parcial. No interrumpe una operación ya iniciada |
| Producción: una tarea pesada | Cupo de 1 en producción, configurable a 2 y de 2 en desarrollo. Con el cupo ocupado: 429 en menos de 2 s con `Retry-After: 30`. Sin sesión: 401, la autenticación no cambia |
| Tope de celdas combinadas | Error comprensible antes de calcular |
| Memoria del informe | 3 ejecuciones con 2.000 puntos de dispersión: se guardan 2, sin el resultado completo (contexto < 5 KB); la más antigua da 404 |
| Persistencia | Invitación, sesión y consumo sobreviven a 2 reinicios con la misma base; la revocación persiste |
| Reserva interrumpida | Después del reinicio se cobra por su máximo |
| Presupuesto en paralelo | 8 hilos con reservas de 0,3 USD sobre 1 USD: entran 3 y 5 reciben 402. El mismo visitante en paralelo: como máximo 1 |
| Uso único atómico | 6 hilos con la misma autorización: 1 éxito y 5 respuestas 404 (antes, `KeyError`, es decir, error 500) |
| Interpretaciones en paralelo | 3 autorizaciones simultáneas con cuota diaria de 1: un solo envío al proveedor y la cuota registrada |
| Errores sin datos | Un `ValueError` con un valor: 500 genérico. El registro tiene el tipo de error y no el valor |
| Etiquetas hacia la IA | Una categoría con salto de línea e instrucción inyectada llega sin control y con 80 caracteres como máximo. Las instrucciones aclaran que son datos |
| XLSX con entidades anidadas | Rechazado en menos de 5 s, con defusedxml activo |
| Temporales de carga | Un archivo de 1,6 MB pasa por un temporal de Starlette, que queda cerrado al terminar |

**Memoria combinada** (sección 7.3b de AUDITORIA_SEGURIDAD.md): perfilado +60 MB, ejecución de 2 fuentes +60 MB y las dos a la vez +120 MB (pico de 309 MB). Margen insuficiente sobre 512 MB: una tarea pesada a la vez en producción.

**Mediciones** (sección 7.1 de AUDITORIA_SEGURIDAD.md): memoria base de 164 MB y +70–90 MB por perfilado de 1 M de celdas. El perfilado bajó de 23,4 s a 5,2 s. Los resultados guardados pasaron de ~15 MB a menos de 5 KB por ejecución.

## 32. Experiencia para personas sin conocimientos técnicos (✅ verificada, 29/10/2026)

Cambios sin confirmar. **Sin llamadas a OpenAI.** Todo se calcula en el navegador.

| Verificación | Resultado |
|--------------|-----------|
| Frontend | **216 de 216**: 205 anteriores y 11 en `src/test/planCoverage.test.tsx` |
| Backend | 308 de 308 (sin cambios) |
| Lint, typecheck y build | Sin errores |

| Prueba | Qué demuestra |
|--------|---------------|
| Cobertura: faltantes | Un pedido con evolución, distribución, relación y una columna no usada: se detectan los 4 faltantes |
| Cobertura: cubierto y general | Sin advertencias cuando el plan cubre el pedido o el pedido es general |
| Tildes y plurales | «Evolución mensual de los rubros»: se reconoce «rubro». La agrupación por fecha cuenta como evolución |
| Lo que no se puede concluir | Causas, pronósticos y cruces de archivos |
| Mensaje sugerido | Texto simple, sin JSON |
| Resumen del envío | Las 15 categorías que viajan aparecen todas. Dispersión: «solo estadísticos». Agrupación retenida y operación fallida explicadas |
| Pantalla de autorización | Resumen primero (qué se calculó, cifras, objetivo, valores enviados, aviso de no anonimización y costo). El JSON exacto, idéntico al preparado, queda plegado en «Ver detalles técnicos». No se envía nada sin autorizar |
| Estado en Resultados | Calculados, pendientes (la operación fallida) y lo que no se puede concluir |
| Flujo hasta «Confirmar» | Con un plan que no cubre evolución ni distribución: aviso, confirmación todavía posible y regreso al asistente con el mensaje precargado, sin envío |
| Flujo cubierto y con causas | Sin aviso cuando el plan responde. Una pregunta de causas muestra «Lo que estos cálculos no pueden responder» |

**Navegador** (backend real con IA simulada, dataset sintético de ventas, objetivo «… comparar el promedio por canal»):
- **Confirmar:** advirtió sobre la columna «canal» y los promedios. El regreso al asistente precargó «Quisiera ajustar el plan: también necesito la columna «canal», promedios.» sin enviarlo.
- **Resultados:** los mismos pendientes aparecen una sola vez. La primera versión los repetía y se corrigió.
- **Autorización:** lista los 6 períodos, los 3 rubros y los 8 intervalos que viajan, con el JSON plegado. Se canceló sin enviar nada. Sin errores en la consola.

## 33. Escenario: movimientos financieros (✅ verificada, 29/10/2026)

Dataset **sintético** con fecha, categoría, modalidad de pago, contraparte con nombres ficticios e importes positivos y negativos.

Objetivo: «Quiero saber cuántas transacciones hice, cuánto gasté, en qué categorías gasté y cuánto corresponde a una persona específica por separado».

| Verificación | Resultado |
|--------------|-----------|
| Backend | **310 de 310** (2 nuevas en `tests/test_report.py`) |
| Frontend | **226 de 226** (10 nuevas en `src/test/planCoverage.test.tsx`, incluidas la del filtrado por persona y la de que ninguna pantalla envía datos a la IA por sí sola) |
| Lint, typecheck y build | Sin errores |

| Caso | ¿Se detecta? | Cómo |
|------|--------------|------|
| 1. Solo una suma neta | ✅ | La suma se presenta como «Suma neta de importe», con aviso: no es el saldo de una cuenta ni un gasto total, y sin conocer el significado del signo no se distinguen ingresos de egresos. «Confirmar» y «Resultados» informan que no se pueden separar gastos de ingresos. Una afirmación de la IA que la llama «gasto» o «saldo» se descarta |
| 2. Modalidad de pago usada como categorías | ✅ con una columna de categorías existente | Aviso «Separar por categoría» o de la columna «categoria» sin usar, indicando que el plan agrupa por «modalidad». Sin columna de categorías: «Falta información». 🟡 El texto de la IA que llama «categoría» a la modalidad no se detecta (ver limitaciones) |
| 3. Una persona sin separar | ✅ | «Separar por persona o entidad: hay columnas que podrían servir («contraparte»), pero ningún plan las usa» |
| 4. Sin columnas adecuadas | ✅ | «Falta información: separar por persona o entidad / por categoría / fecha o período», sin inventar columnas |
| 5. Corregir sin JSON | ✅ | El mensaje sugerido para el asistente se puede editar y no se envía solo |
| 6. Nombres de personas en el envío | ✅ | Recuadro «Posibles nombres de personas o entidades» con todos los valores que viajarían, con la recomendación de no autorizar sin consentimiento |
| Conteo de transacciones | ✅ | «Cantidad de registros» si ningún plan cuenta |
| Medida solo positiva | ✅ sin falsa alarma | No se rotula «suma neta» |
| Una persona en particular | ✅ sin prometer de más | «Filtrar una persona o entidad en particular»: el motor no filtra por un valor; se sugiere agrupar por la columna y buscar a la persona en el resultado |

**Navegador** (backend real con IA simulada, CSV sintético generado en la página):
- **Confirmar:** el plan simulado (serie por categoría, total e histograma) recibió los avisos de cantidad de registros, persona (con «contraparte» y «el plan agrupa por «categoria»») y suma neta.
- **Resultados:** indicador «Saldo neto de importe» y resumen descriptivo con «Saldo neto de importe…» (desde la revisión final se llaman «Suma neta de importe»). Pendientes y «no se puede concluir» separados.

## 34. Personalización y calidad del PDF (✅ verificada, 29/10/2026)

Datos: la respuesta real del backend para el dataset **sintético** de ventas (`fixtures/salesReportResponse.json`). La frontera de IA es falsa y `fetch` está espiado: no hubo red ni consumo de OpenAI.

| Verificación | Resultado |
|--------------|-----------|
| Frontend | **247 de 247** (21 nuevas en `src/test/pdfCustomization.test.tsx`; 2 actualizadas en `report.test.tsx` por los nuevos títulos de sección) |
| Backend | **310 de 310** (sin cambios) |
| Lint, typecheck y build | Sin errores |

| # | Caso | Resultado |
|---|------|-----------|
| 1 | PDF sin personalizar | ✅ Título predeterminado, marca y fecha visibles; nombre `informe-ventas-AAAA-MM-DD.pdf` |
| 2 | Título personalizado | ✅ En la portada, el pie y los metadatos; el objetivo original no cambia |
| 3 | Autor e institución | ✅ Aparecen solo si se completan |
| 4 | Logo PNG | ✅ Aceptado por su firma; incrustado con su tamaño real (40 × 20) y proporción 2:1 |
| 5 | Logo JPG | ✅ Aceptado; incrustado como JPEG (`/DCTDecode`), proporción vertical 1:2 |
| 6 | Archivo inválido | ✅ Rechazados: SVG, SVG renombrado a `.png`, texto renombrado a `.jpg`, GIF, vacío y más de 1 MB. Ninguno llega a decodificarse |
| 7 | Imagen dañada | ✅ «La imagen está dañada o no se puede abrir»; también medidas fuera de rango |
| 8 | Quitar y reemplazar | ✅ La vista previa cambia de PNG a JPG y luego sin logo; un archivo inválido muestra el error y conserva el logo anterior |
| 9 | Fecha | ✅ Oculta: sin fechas de elaboración ni cálculo; los períodos 2025-01 a 2025-06 siguen en tablas y resumen |
| 10 | Marca | ✅ Oculta: sin franja ni «Elaborado con DataDecision AI»; se conserva «Origen de los cálculos: DataDecision AI». La portada ocupa una página con y sin marca |
| 11 | Objetivo con Markdown | ✅ Encabezados, párrafos, listas de dos niveles, «¿», «¡», ñ y tildes; sin `**` ni `##`; `<script>` se muestra como texto; `monto_ars` intacto |
| 12 | Análisis parcialmente cubierto | ✅ «Se completaron las 4 operaciones del plan aprobado. Sin embargo, quedaron pendientes otras partes del objetivo original, como cantidad de registros, relación entre dos variables y promedios.» Nunca «Análisis completo» |
| 13 | Sin pendientes detectados | ✅ «La revisión automática no detectó otras partes del objetivo sin calcular», con la aclaración de que no es una garantía. Sin objetivo: no se afirma cobertura |
| 14 | Variación como indicador derivado | ✅ La advertencia «no está disponible» se conserva con una aclaración que remite a P1.O2 («+500 ARS (+9,8 %)»). «No se pueden pronosticar variaciones futuras» y «La correlación no implica causalidad» quedan sin aclaración. Cada variación figura una sola vez: los hallazgos de P1.O2 remiten a «Indicadores derivados» |
| 15 | Con y sin IA | ✅ «8. Interpretación con IA» solo con una interpretación autorizada; sin ella, la metodología dice que no se incluyó |
| 16 | Tablas extensas y gráficos | ✅ 200 filas y todos los gráficos con imagen: varias páginas, «Se listan 25 de 200 filas», numeración «Página n de n» |
| 17 | Valores exactos | ✅ Cada indicador y cada celda de las tablas (hasta 25 filas) aparece en el PDF con el mismo formato que el dashboard |
| 18 | Dashboard y resultados intactos | ✅ Los resultados no cambian (`toEqual` con una copia previa), el informe no contiene la personalización y el estado del análisis y el resumen descriptivo se ven igual |
| 19 | Nada sale del navegador | ✅ `fetch` no se llamó al personalizar ni al descargar |
| 20 | Sin llamadas automáticas a la IA | ✅ Ni `prepareInterpretation` ni `authorizeInterpretation` (ni la conversación) se llamaron |

También se comprobaron: limpieza de campos (caracteres de control, marcas de dirección, espacios y longitud máxima), título vacío → predeterminado, y que el HTML en el título o el autor se muestra como texto.

**Revisión visual** (PDF generados en el navegador con la vista previa real, sus gráficos de Recharts y un logo PNG sintético decodificado por el navegador; páginas rasterizadas con el lector de PDF integrado de Windows):
- **Personalizado** (título, autor, institución ficticios, logo, sin fecha ni marca), 7 páginas: logo sin deformar, portada sin marca, objetivo con formato, alcance parcial en naranja, aclaración de la variación, gráficos con título, ejes y leyenda, tablas sin encabezados aislados.
- **Sin personalizar**, 7 páginas: franja y marca DataDecision AI, título predeterminado, fechas visibles.
- Errores encontrados y corregidos en esta revisión: hoja en blanco tras la portada, mensajes de error cortados en la metodología, gráficos demasiado grandes y puntuación doble en los pendientes.
