# Bitácora de desarrollo — DataDecision AI

Proyecto final de **Prácticas Profesionalizantes — Tecnicatura en Ciencia de Datos**.
Autor: Damián Boto. Documento de base para la exposición final.

> **Criterio de este documento:** se registra solo lo que consta en el repositorio (código, commits, archivos sin confirmar) o lo que el autor informó explícitamente, y se indica cuál es cuál. Las pruebas y sus resultados están en [PRUEBAS_Y_VALIDACIONES.md](PRUEBAS_Y_VALIDACIONES.md); la seguridad, en [SEGURIDAD.md](SEGURIDAD.md).

## Línea de tiempo

| Etapa | Evidencia en el repositorio |
|-------|-----------------------------|
| 1. MVP inicial: frontend completo en modo DEMO y esqueleto FastAPI | Commit `e943df3` (24/10/2026, 14:09) |
| 2. Preparación de la demo pública y documentación de instalación privada | Commit `492b9f9` (24/10/2026, 15:35) |
| 3. Perfilado de datasets con FastAPI + Pandas | Commit `ac5553e`: `backend/app/services/dataset_profiler.py`, `backend/app/api/routes/datasets.py`, `backend/tests/test_dataset_profiler.py` (incorporados por el autor) |
| 4. Integración de la pantalla de carga con el perfilado real | Commit `ac5553e`: `frontend/src/services/backendProfile.ts` y cambios en la capa de servicios |
| 5. Documentación académica (este documento) | Commit `ac5553e`, actualizada en cada fase |
| 6. Publicación de la demo en https://datadecisionai.pages.dev | Captura de Cloudflare provista por el autor (comunicada); respuesta HTTP 200 comprobada el 24/10/2026 |
| 6b. Prueba local con el dataset real `impominerales-siacam.csv` (102.254 registros) | Capturas del autor (comunicada); ver [PRUEBAS_Y_VALIDACIONES.md](PRUEBAS_Y_VALIDACIONES.md), sección 7 |
| 6c. Fase 2: calidad y confiabilidad del dataset (faltantes, tipos semánticos) | Commit de cierre de la Fase 2; validación con SIACAM aportada por el autor (sección 6c) |
| 6d. Fase 3A: varias fuentes por análisis (hasta 3 archivos, sin uniones) | Commit de cierre de la Fase 3A; ver sección 6d |
| 6e. Auditoría de privacidad, seguridad y flujo de datos antes de OpenAI | Documentada en SEGURIDAD.md (sección 6); sin cambios de código |
| 6f. Endurecimiento mínimo de la carga (B4, B5, B6, F7) | Commit de cierre de la Fase 3A; ver sección 6f |
| 6g. Cierre de la Fase 3A con dos datasets reales | Validación manual del autor; ver sección 6g |
| 6h. Fase 3B.1: frontera de privacidad y autorización para la IA (sin llamadas externas) | Commit de cierre de la Fase 3B.1; validación manual del autor con dos datasets reales |
| 6i. Reorganización del recorrido: revisión obligatoria de datos y privacidad antes del asistente | Incluido en el commit de cierre del recorrido de revisión y conversación; ver sección 6i |
| 6j. Corrección de navegación del recorrido (volver atrás y bloqueo hacia adelante) | Incluido en el commit de cierre del recorrido de revisión y conversación; problema detectado en la validación manual del autor |
| 6k. Una sola pantalla de configuración de datos y autorización por mensaje | Incluido en el commit de cierre del recorrido de revisión y conversación; mejora detectada en las pruebas manuales del autor |
| 6l. Ajustes de experiencia en el paso 3: panel de autorización, IA deshabilitada y objetivo inicial | Incluido en el commit de cierre del recorrido de revisión y conversación; problemas detectados en las pruebas manuales del autor |
| 6m. Cierre del recorrido: validación manual del autor | Incluido en el commit de cierre del recorrido de revisión y conversación; evidencia aportada por el autor |
| 6n. Fase 3B.2 — Integración real con OpenAI (probada con proveedores falsos) | Cambios sin confirmar; la primera llamada real queda pendiente de autorización del autor |
| 6o. Error 404 al cargar datasets con `VITE_DEMO_MODE=false` | Cambios sin confirmar; error detectado por el autor en la primera prueba de integración de la Fase 3B.2 |
| 6p. Primeras llamadas reales, plan aprobado en «Confirmar» y autorización por conversación | Cambios sin confirmar; problemas detectados por el autor en las primeras pruebas reales |
| 6q. Fase 4A — Motor de análisis real con Python y Pandas | Cambios sin confirmar |
| 6r. Fase 4B — Dashboard interactivo con resultados reales | Cambios sin confirmar |
| 6s. Modo real sin respuestas simuladas, catálogo único e instrucciones de la IA | Cambios sin confirmar; problema señalado por el autor |
| 6t. Histograma, dispersión y curva ROC | Cambios sin confirmar |
| 7. Decisión de minimización de datos para la IA | Registrada en [SEGURIDAD.md](SEGURIDAD.md) y [ARCHITECTURE.md](ARCHITECTURE.md); implementación pendiente |

---

## 1. Idea original y problema

Muchas personas que toman decisiones en una organización (comercios, áreas administrativas, docentes, pymes) tienen datos en planillas, pero no saben qué preguntas hacerles ni cómo convertirlos en indicadores confiables. Las herramientas de BI exigen conocimientos técnicos, y los chats de IA genéricos pueden inventar números o columnas que no existen.

**DataDecision AI** propone un recorrido guiado: la persona carga un CSV o Excel, explica con sus palabras qué necesita decidir y recibe una **propuesta de análisis** que debe **aprobar** antes de que se calcule cualquier resultado. Los números siempre los calcula Pandas; la IA solo ayudaría a entender el pedido y a redactar.

## 2. Objetivos funcionales

1. Cargar datasets CSV y XLSX con validación de formato, tamaño y contenido.
2. Mostrar un diagnóstico de calidad: filas, columnas, vacíos, duplicados, advertencias.
3. Conversar con un asistente de requisitos (IA 1) que pregunte antes de suponer y nunca invente columnas.
4. Generar una propuesta versionada con evaluación de viabilidad (viable, parcial, insuficiente).
5. Exigir la aprobación explícita del plan antes de calcular resultados.
6. Presentar indicadores, gráficos y hallazgos con nivel de evidencia en un workspace (IA 2 + Pandas).
7. Exportar el análisis a PDF, Excel, Word y Canva.

En la versión actual se cumplen 1, 2 y la interfaz de 3 a 7; el detalle está en la sección 10.

## 3. Elección del stack tecnológico

| Capa | Tecnología | Fundamento |
|------|------------|------------|
| Interfaz | React 19 + TypeScript + Vite | Componentes reutilizables; TypeScript detecta errores de contrato en compilación; Vite compila rápido y genera archivos estáticos publicables gratis. |
| Estilos | Tailwind CSS 4 | Diseño consistente y responsive sin escribir CSS a mano para cada pantalla. |
| Navegación y gráficos | React Router 7, Recharts, Lucide | Rutas por pantalla; gráficos declarativos a partir de datos genéricos (`xKey`, `series`, `data`). |
| Backend | Python + FastAPI | Es el lenguaje de la carrera para ciencia de datos; FastAPI valida datos con Pydantic y genera documentación Swagger automática. |
| Datos | Pandas (+ openpyxl para Excel) | Herramienta estándar para leer, perfilar y calcular sobre datos tabulares. |
| Pruebas | Vitest + Testing Library; pytest | Pruebas automáticas en ambos lados, ejecutables con un comando. |

Se descartaron explícitamente microservicios, Kubernetes y Docker: para un MVP académico agregan complejidad sin aportar valor demostrable.

## 4. Frontend con React, TypeScript y Tailwind (commit `e943df3`)

- **Pantallas** en español: inicio, carga, asistente, confirmación y workspace (resumen con indicadores y gráficos, dataset y exportación del análisis).
- **Capa de servicios con una interfaz única** (`DataDecisionService`) y dos implementaciones: un proveedor **DEMO** en memoria y un cliente **HTTP** para FastAPI. Las pantallas nunca hacen `fetch` ni conocen los datos simulados; cambiar de modo es cambiar una variable de entorno (`VITE_DEMO_MODE`).
- **Vista previa real de CSV en el navegador**: detección de separador, tipos inferidos, vacíos y primeras filas, marcada como preliminar.
- **Honestidad de datos**: todo lo simulado lleva la marca DEMO; un archivo propio nunca recibe resultados inventados (queda "pendiente de backend").
- **Asistente DEMO**: guion determinista por palabras clave, que usa solo columnas existentes del perfil. No es IA.
- **Exportación**: interfaz y contrato listos; los botones indican que la generación todavía no está disponible.

## 5. Backend con FastAPI y Pandas

- **Esqueleto inicial** (`e943df3`): fábrica `create_app()`, configuración con `pydantic-settings` leída de `.env`, CORS limitado a los orígenes de desarrollo y endpoint `GET /api/health`.
- **Perfilado de datasets** (incorporado por el autor, commit `ac5553e`): `POST /api/datasets/profile` recibe el archivo por `multipart/form-data`, lo lee con Pandas **como texto** (para no transformar identificadores como `00123`) y devuelve filas, columnas, vacíos, valores distintos, ejemplos, duplicados, primeras filas y advertencias. **No modifica ni guarda el archivo.** Incluye límites de tamaño, filas y columnas, y controles para Excel comprimido.

## 6. Integración frontend–backend

- Se agregó la opción `VITE_BACKEND_PROFILING`, independiente de `VITE_DEMO_MODE`: el perfilado se hace con Pandas mientras el asistente y los resultados siguen en DEMO. Así se integra **una sola pieza real por vez**, de forma verificable.
- Un **adaptador** (`backendProfile.ts`) convierte la respuesta de Python (snake_case) al tipo `DatasetProfile` del frontend **sin cambiar ninguno de los dos contratos**.
- Si el backend falla, se muestra su mensaje de error; **no** se reemplaza en silencio por una vista previa local ni por datos ficticios.

### Cierre de la etapa: prueba con un dataset real

El autor probó la integración localmente con `impominerales-siacam.csv` (importaciones de minerales, 7,4 MB). Según sus capturas, la aplicación mostró 102.254 registros, 8 columnas, 0 duplicados exactos, 100 % de completitud, las primeras cinco filas y la etiqueta "Perfil del backend". Esto valida el recorrido navegador → FastAPI → Pandas → interfaz con un volumen real.

- **Incidencia:** el puerto 5173 estaba ocupado por Docker/WSL y Vite usó el 5174, que CORS no autorizaba.
- **Solución:** habilitar temporalmente `http://localhost:5174` con la variable `CORS_ORIGINS` en PowerShell, sin cambiar código.
- **Aprendizaje:** tener la configuración en variables de entorno permite adaptar la ejecución a cada equipo sin tocar el código ni relajar la seguridad por defecto (no se usó `*`).

**Limitaciones conocidas al cierre de esa etapa** (abordadas parcialmente en la Fase 2, sección 6c):

- **Tipos de columna estimados:** Pandas lee todo como texto y el frontend estima el tipo con los valores de ejemplo y las primeras filas. No es un tipado definitivo.
- **Códigos numéricos que pueden ser categorías:** columnas como años, meses o códigos de producto o de país se ven como números, pero pueden ser variables categóricas; sumarlas o promediarlas no tendría sentido.
- **`NA` y marcadores de vacío:** el backend cuenta como faltante solo la celda vacía (`keep_default_na=False`), por lo que `NA`, `N/A`, `null` o `-` se cuentan como valores presentes. La vista previa local del navegador, en cambio, los considera vacíos. Un 100 % de completitud informado por el backend **no descarta** la presencia de esos marcadores. Además, `NA` puede ser un valor legítimo (por ejemplo, el código ISO de Namibia), así que su tratamiento requiere una decisión explícita por columna.

## 6c. Fase 2 — Calidad y confiabilidad del dataset

**Problema.** El cierre de la etapa anterior dejó tres riesgos para la interpretación estadística: (1) el backend y el navegador contaban distinto los valores `NA`, `null` o `-`; (2) el tipo de columna se estimaba con unos pocos ejemplos; (3) una columna numérica podía ser un código o un año, y el asistente DEMO podía proponer sumarla o promediarla.

### Criterio de valores faltantes

| Caso | Tratamiento | Fundamento |
|------|-------------|------------|
| Celda vacía o solo con espacios | **Faltante** | No hay ningún dato registrado. |
| `NA`, `N/A`, `null`, `none`, `nan`, `-`, `?`, `s/d`, `sin dato`… | **Sospechoso**: se cuenta e informa aparte, **no** se descuenta ni se modifica | Puede ser un valor válido (`NA` = Namibia, `-` = "sin movimiento"). Convertirlo automáticamente borraría información. |
| Completitud | Celdas no vacías ÷ total de celdas del **archivo completo** | Criterio explícito, reproducible y visible en la interfaz. |

El navegador aplica **la misma lista de marcadores** que Python, y una prueba automática compara ambas listas para que no se desincronicen.

### Tipo técnico vs. tipo semántico

Se separan dos conceptos que antes se confundían:

- **Formato (tipo técnico):** cómo se ven los valores (número, fecha, texto, sí/no). Ahora lo calcula Pandas sobre **todos** los valores, no sobre ejemplos.
- **Interpretación (tipo semántico):** qué papel estadístico cumple la columna (cuantitativa, categórica, identificador o código, temporal, texto libre). Es una **inferencia** que siempre se muestra con **nivel de confianza** (alta, media, baja) y **motivo**.

Reglas generales (no específicas de ningún dataset), en orden de prioridad:

1. Valores con ceros a la izquierda (`001`) → código (confianza alta).
2. Enteros con un nombre de año (`año`, `anio`, `anyo`, `year`, `ejercicio`) y valores entre 1800 y 2100 → temporal (alta). Ídem mes (`mes`, `month`) con valores 1 a 12.
3. Nombre que sugiere código (`id`, `codigo`, `cod`, `clave`, `sku`…) → código (media).
4. Enteros todos distintos → identificador (media); enteros de longitud fija de 4 o más dígitos → código (media, con advertencia).
5. Enteros de 4 dígitos entre 1800 y 2100 sin nombre que lo confirme → posible año (baja, con advertencia).
6. Pocos enteros distintos (≤ 12) → cuantitativa con confianza **baja** y advertencia ("podría ser una categoría codificada").
7. Valores con decimales → cuantitativa (alta); demás enteros → cuantitativa (media).
8. Texto con pocos valores repetidos → categórica; texto con valores casi únicos → identificador o texto libre.
9. Mezcla de números y texto (50 a 98 %) → baja confianza y advertencia.
10. Columna constante → confianza baja y advertencia.

**Por qué reglas conservadoras y no machine learning:** cada clasificación se puede explicar en una oración y verificar con una prueba; para un MVP académico, la trazabilidad pesa más que la cobertura. Cuando la evidencia no alcanza, el sistema lo dice en lugar de decidir.

### Qué se corrigió

- El backend agrega por columna: marcadores sospechosos, formato, tipo semántico, confianza y motivo; y a nivel dataset: celdas totales, vacías, sospechosas y completitud.
- El frontend muestra la completitud informada por el backend, con el criterio escrito debajo, y nunca redondea a "100 %" si falta alguna celda.
- La vista previa local del navegador dejó de contar `NA` como vacío (coherencia con el backend).
- La interfaz muestra la interpretación estimada con "?" y nivel de confianza; las advertencias de ambigüedad aparecen en Observaciones.
- El asistente DEMO ya no propone sumar ni promediar columnas que el backend marcó como código, año o categoría.
- Los nuevos campos son opcionales en el adaptador: el frontend sigue funcionando con la respuesta anterior del backend.

### Cómo se validó

- 11 pruebas nuevas de backend con CSV y XLSX sintéticos (faltantes, `NA` como valor válido, completitud, códigos con ceros, columnas tipo comercio exterior, fechas, ambigüedades, columna constante).
- 10 pruebas nuevas de frontend (política local, sincronía de marcadores con Python, adaptador, formato de completitud, asistente y pantalla).
- Recorrido en el navegador contra el backend real con un CSV sintético de 500 filas (ver [PRUEBAS_Y_VALIDACIONES.md](PRUEBAS_Y_VALIDACIONES.md), sección 9).
- Rendimiento: un CSV sintético de 102.254 filas × 8 columnas pasó de 0,69 s a 2,04 s de perfilado. Para contenerlo, los patrones se evalúan sobre valores distintos ponderados por frecuencia.

### Limitaciones que permanecen

- La interpretación semántica es una **estimación**: un código de pocos dígitos y longitud variable (por ejemplo, un código de aduana de 1 a 40) sin nombre indicativo se clasifica como cuantitativo con confianza media.
- Las palabras clave de nombres de columna están en español e inglés; otros idiomas o abreviaturas no se reconocen.
- Los marcadores sospechosos no se resuelven: la decisión por columna (tratar `NA` como faltante o como valor) queda para una etapa con confirmación del usuario.
- El formato numérico no distingue `1.200` (mil doscientos) de `1.200` (uno coma dos); no se convierten valores.
- **`PPRO` en SIACAM** se clasificó como cuantitativa (confianza media) aunque podría ser un código: limitación real observada (ver abajo).

### Validación con el dataset real SIACAM (evidencia aportada por el autor)

El autor cargó `impominerales-siacam.csv` en la aplicación local con la versión de la Fase 2 y registró los resultados con capturas:

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

**Interpretación para la defensa.** El resultado muestra el valor del criterio explícito: la completitud sigue en 100 % porque no hay celdas vacías, pero ahora la plataforma **hace visibles** 12 `NA` que antes pasaban desapercibidos. También muestra su límite: sin evidencia general (ceros a la izquierda, nombre indicativo o longitud fija), `PPRO` queda como cuantitativa con confianza media. Agregar una regla para "PPRO" habría resuelto este caso a costa de que el sistema dejara de ser general; se prefirió dejar la duda visible y resolverla con el usuario.

**Decisión de arquitectura para las próximas fases (planificada, no implementada).**

- DataDecision AI debe funcionar con **cualquier dataset tabular CSV/XLSX**. SIACAM es solo un caso de prueba real: **no se incorporan reglas específicas para sus columnas**, aunque eso implique que `PPRO` no se clasifique como código.
- El perfilador **propone** interpretaciones y advertencias; no decide. La próxima fase incorporará un asistente que **consultará al usuario** cuando sean ambiguos el significado de una variable, los marcadores de ausencia o las necesidades del análisis (por ejemplo: "¿`PPRO` es un código o una cantidad?", "¿los `NA` de `ORIGEN` son datos faltantes o un código de país?").
- **Tratamiento no destructivo:** las decisiones confirmadas se aplicarán después, al ejecutar el análisis con Pandas, sobre una copia en memoria. **Nunca se eliminan ni modifican automáticamente datos originales sin autorización.** Hoy no se aplica ningún tratamiento: los `NA` se informan y se conservan.

## 6d. Fase 3A — Varias fuentes por análisis

**Decisión.** DataDecision AI debe admitir varios datasets tabulares en un mismo análisis, sin especializarse en ningún dominio. En el MVP se permiten **hasta tres archivos** CSV/XLSX, cargados juntos o de a uno.

**Qué se implementó.**

- La pantalla de carga acepta varios archivos (selección múltiple o arrastre). Cada archivo es una **fuente** independiente con su nombre, filas, columnas, completitud, posibles `NA` e interpretaciones, y puede **quitarse o reemplazarse** sin afectar a las demás. Si un reemplazo falla, se conserva el archivo anterior.
- **Sin lógica nueva en el backend:** cada archivo se perfila con el mismo `POST /api/datasets/profile` (o con la vista previa local en la demo pública).
- **Controles de memoria:** máximo 3 archivos, 25 MB por archivo, 60 MB entre todos, **perfilado secuencial** (un archivo por vez, en el navegador y en el backend), rechazo del mismo archivo repetido. Nada se persiste.
- **Catálogo estructurado** (`lib/datasetCatalog.ts`): resume el esquema de cada fuente (alias A/B/C, filas, columnas, formato, interpretación, faltantes, posibles `NA`) y agrega **pistas**: columnas con el mismo nombre normalizado y fuentes con la misma estructura. **No incluye valores reales** (ni ejemplos ni filas), en línea con la política de minimización de datos. Es la entrada prevista para la futura IA 1.
- **Proyecto con varias fuentes:** `CreateProjectInput.datasetIds` y `Project.datasets` son opcionales; con una sola fuente todo funciona como antes.
- **Asistente DEMO honesto:** avisa que recibió otras fuentes y que la propuesta usa solo la principal; la propuesta lo registra como limitación.
- **Workspace:** la sección de datos permite ver el perfil de cada fuente por separado.
- **No se une, concatena ni transforma ningún archivo.**

**Por qué así.** Separar *cargar y describir* de *combinar* evita el error más costoso al trabajar con varias tablas: unir por una clave que no es única y multiplicar registros sin advertirlo. Primero el sistema muestra qué hay; la combinación se propondrá después, con validaciones y aprobación.

### Preparación para la futura IA 1 (documentado, no implementado)

| Operación que podrá proponer IA 1 | Ejemplo | Validaciones previas obligatorias |
|-----------------------------------|---------|-----------------------------------|
| Analizar una fuente individualmente | Evolución mensual en `importaciones.csv` | Las de la Fase 2 (tipos, marcadores) confirmadas por el usuario |
| Comparar fuentes independientes | Indicadores de 2024 frente a 2025, cada uno calculado por separado | Que las métricas sean comparables (mismas unidades y definiciones) |
| Concatenar tablas compatibles | Apilar `ventas_2024.csv` y `ventas_2025.csv` | Mismas columnas y tipos; columna que identifique el origen; duplicados entre fuentes |
| Relacionar tablas mediante claves confirmadas | Unir importaciones con un maestro de países por `PAIS` | Clave confirmada por el usuario; unicidad de la clave en la tabla maestra; granularidad de cada tabla; cardinalidad (1:1, 1:N, N:M); conteo de filas antes y después para detectar multiplicación de registros; claves sin correspondencia |

Ninguna operación se ejecuta sin un **plan aprobado por el usuario**. Las validaciones las hace Pandas, no la IA, y el resultado se aplica sobre copias en memoria: los archivos originales no se modifican.

### Limitaciones de la Fase 3A

- El asistente DEMO y los resultados usan **solo la fuente principal**; las demás se describen pero no se analizan.
- Las columnas compartidas se detectan **por nombre**: columnas equivalentes con nombres distintos (`PAIS` y `COD_PAIS`) no se sugieren, y columnas con el mismo nombre pueden no ser relacionables.
- Al recargar la página se pierden las fuentes (estado en memoria, igual que antes).
- El endpoint HTTP `POST /api/projects` con `datasetIds` está documentado en el contrato, pero el backend de proyectos todavía no existe.
- La pantalla de carga es más compleja; se verificó en navegador a 1280 px y en un panel angosto de 384 px, no en dispositivos reales.

## 6e. Auditoría de privacidad y flujo de datos antes de OpenAI

**Por qué ahora.** Integrar un modelo de lenguaje externo cambia el riesgo: por primera vez, información derivada de los datos podría salir del equipo. Antes de hacerlo se auditó qué datos existen, dónde quedan y quién los recibe, sobre el código real y con comprobaciones ejecutadas (no solo lectura).

**Resultado principal.** El flujo actual cumple lo que promete en lo esencial: la demo pública no hace **ninguna** solicitud de red con los archivos ni guarda nada en el navegador, y el perfilado local envía exactamente un archivo por solicitud al backend propio, sin telemetría. Se encontraron, en cambio, debilidades del backend que conviene corregir antes de usar archivos reales grandes:

- El servidor recibe la solicitud completa (y la escribe en un archivo temporal) antes de aplicar el límite de 25 MB.
- Un CSV adversario de 25 MB puede consumir ≈ 400 MB y bloquear el servidor ≈ 38 s, porque los límites de filas y columnas se comprueban después de leerlo y Pandas corre en el bucle de eventos.
- CORS impide leer respuestas desde otros sitios, pero no impide que el backend procese sus solicitudes.

También se corrigieron dos afirmaciones imprecisas de [SEGURIDAD.md](SEGURIDAD.md) ("no se guarda" y el momento del corte de 25 MB).

**Aprendizaje.** "No encontré llamadas a OpenAI" no prueba que algo sea seguro: hay que observar el tráfico real, el almacenamiento y el comportamiento ante entradas adversarias. Y la confidencialidad no depende solo de las filas: nombres de archivo y de columnas, preguntas y estadísticas agregadas también revelan información. Por eso la integración con OpenAI se diseñó como **denegada por defecto**, con contenido armado por el backend desde una lista blanca y autorización explícita por cada envío.

Detalle de hallazgos, clasificación y correcciones propuestas: [SEGURIDAD.md](SEGURIDAD.md), sección 6.

## 6f. Endurecimiento mínimo de la carga

**Problema.** La auditoría (6e) mostró que el backend aceptaba solicitudes de cualquier tamaño antes de rechazarlas, que un CSV de 25 MB bien construido podía ocupar ≈ 400 MB y bloquear el servidor ≈ 38 s, que cualquier sitio abierto en el navegador podía hacer procesar archivos al backend local, y que las fuentes quitadas seguían en memoria.

**Solución y fundamento.**

- **Controlar antes de leer.** Un *middleware* ASGI valida el origen y el tamaño declarado sin tocar el cuerpo, y cuenta los bytes reales para no depender de un encabezado que puede faltar o mentir. Es la forma más barata de rechazar: no se gasta disco ni memoria en algo que se va a descartar.
- **Limitar por celdas, no solo por megabytes.** El costo en memoria de Pandas depende de la cantidad de celdas, no del peso del archivo: 25 MB pueden ser 0,8 M celdas (SIACAM) o 12 M. Por eso se cuentan filas y columnas antes de crear el DataFrame, de forma incremental.
- **No confiar en lo declarado por un ZIP.** Un XLSX es un ZIP; sus tamaños declarados pueden falsearse. Se descomprime contando bytes reales, con tope.
- **No bloquear el servidor.** Pandas es síncrono: se ejecuta en un hilo, y como máximo dos perfilados a la vez. No se agregaron colas ni infraestructura.
- **Liberar al quitar.** Lo que el usuario quita deja de existir también en la memoria del proveedor DEMO.

**Resultado.** El caso adversario pasa de 409 MB y 37,8 s a un rechazo en 0,6 s; un dataset tipo SIACAM sigue tardando ≈ 2,1 s; el servidor responde a otras solicitudes mientras perfila. **El riesgo de agotamiento de recursos queda mitigado, no eliminado**: dentro de los límites, un archivo puede tardar ≈ 8 s y usar ≈ 180 MB.

**Aprendizaje.** La seguridad proporcional consiste en elegir pocos controles baratos que cortan los peores casos medidos, y dejar escrito qué queda afuera y por qué.

## 6g. Cierre de la Fase 3A: dos datasets reales, decisiones de alcance y principio central

### Qué se validó y cómo

| Tipo de evidencia | Contenido |
|-------------------|-----------|
| **Implementado** | Hasta 3 fuentes por análisis; catálogo de esquemas sin valores; endurecimiento B4, B5, B6 y F7 |
| **Probado automáticamente** | 52 pruebas de backend y 66 de frontend, lint, typecheck y build (PRUEBAS, sección 14) |
| **Verificado manualmente por el autor** | `impominerales-siacam.csv` (102.254 × 8, 12 posibles `NA`) e `indicadores-provinciales.csv` (15.874 × 14, 45 posibles `NA`, Windows-1252) cargados juntos, cada uno con su propio perfil; quitar y volver a agregar; sin columnas coincidentes; sin uniones (PRUEBAS, sección 13) |
| **Defectos observados** | El asistente DEMO no reconoció el segundo objetivo ni la instrucción de mantener separados los análisis, y listó `PPRO` como numérica sin advertir su ambigüedad. Incidencia intermitente de CORS con causa no confirmada |
| **Limitaciones aceptadas** | Asistente simulado por reglas; sin autenticación; mitigación (no eliminación) del agotamiento de recursos; archivo temporal transitorio |
| **Funcionalidades futuras** | IA real (Fase 3B) con frontera de datos, análisis sobre varias fuentes con validación de claves, cálculos y gráficos reales |

### Decisión sobre el asistente DEMO

No se agregan reglas nuevas: el asistente es una **simulación provisional** y su limitación está identificada. Agregar reglas para este caso aumentaría la complejidad sin acercarse a la comprensión real que requiere el problema. Los requisitos para la IA real son:

- Reconocer **todos** los objetivos solicitados en un mismo mensaje.
- Comprender cuándo varias fuentes deben analizarse **de forma independiente**.
- Distinguir entre **comparar, concatenar, relacionar y analizar por separado**.
- **Preguntar** cuando falte información o haya ambigüedad.
- **No** tratar automáticamente todo campo numérico como variable cuantitativa (por ejemplo, `PPRO`).
- **No inventar** estadísticas ni conclusiones.
- Proponer **planes de análisis** que el usuario confirme antes de ejecutarlos.

### Decisión académica sobre escalabilidad

| Límite inicial | Valor |
|----------------|-------|
| Datasets por análisis | 3 |
| Tamaño por archivo | 25 MB |
| Tamaño combinado | 60 MB |
| Celdas por archivo para el perfilado | 5.000.000 (además de 250.000 filas y 250 columnas) |
| Motor de procesamiento | Python y Pandas, en el equipo o servidor propio |

**Justificación.** Estos límites permiten controlar recursos, realizar pruebas reproducibles, mantener una complejidad razonable y terminar el proyecto dentro del alcance académico. La arquitectura separa la carga y administración de fuentes, el perfilado, el procesamiento estadístico y la interfaz; esa separación **facilita** futuras ampliaciones, pero **no garantiza escalabilidad ilimitada**. Ampliar las capacidades requeriría nuevas pruebas de rendimiento, memoria y concurrencia y, según el volumen, otras estrategias de procesamiento. **El límite de tres fuentes es una decisión de alcance y de seguridad operativa del MVP, no una incapacidad conceptual** para trabajar con más datasets.

### Principio arquitectónico central

**DataDecision AI separa el procesamiento estadístico de la inteligencia artificial.**

- **Python y Pandas** realizan los cálculos y el procesamiento verificable.
- **La futura IA** interpreta objetivos, formula preguntas y propone planes de análisis.
- **El usuario** confirma las decisiones relevantes.
- Las operaciones se ejecutarán mediante **mecanismos estructurados y validados** (un catálogo cerrado de operaciones), no mediante la ejecución arbitraria de código generado por IA.
- Los **archivos originales no se modifican** automáticamente.
- La transmisión a servicios externos debe estar restringida por **minimización de datos y autorización explícita**.

> La política de transmisión hacia OpenAI es un **requisito de arquitectura pendiente de implementación y verificación**, no una capacidad terminada.

## 6h. Fase 3B.1 — Frontera de privacidad y autorización para la IA

**Decisión central: Python/Pandas calcula; OpenAI interpretará objetivos y propondrá planes; el usuario confirma.**

**Por qué antes de conectar OpenAI.** La auditoría (6e) mostró que no alcanza con "no enviar filas": nombres de archivo y de columnas, objetivos y estadísticas también pueden ser confidenciales. Antes de escribir una sola llamada a un servicio externo había que poder responder con precisión **qué** saldría del sistema y **quién** lo autoriza.

**Qué se construyó.**

- **Un contrato de lista blanca en el backend** (Pydantic con `extra="forbid"`): alias A/B/C, columnas revisadas con formato e interpretación, objetivo y, opcionalmente, un rango de tamaño. Todo lo demás se rechaza aunque lo envíe el navegador.
- **Un flujo preparar → revisar → autorizar**: el usuario ve el JSON exacto, puede ocultar o renombrar columnas y editar el objetivo; el backend devuelve una huella SHA-256 y la autorización vale una vez, por cinco minutos y para ese contenido exacto.
- **Denegación por defecto** con `AI_ENABLED=false` y un proveedor que en esta fase **no tiene red**: aunque se habilite y autorice, responde que no se envió nada.
- **Aislamiento de la demo pública**: allí no existe el cliente de la frontera; el panel solo muestra qué se enviaría.

**Fundamento técnico.** La lista blanca invierte la lógica: en lugar de intentar detectar y quitar lo sensible (siempre incompleto), solo se acepta lo explícitamente permitido. La huella une la autorización al contenido que la persona vio: si cambia un carácter, no vale. El uso único y el vencimiento evitan autorizaciones generales e indefinidas.

**Validación del autor con datos reales.** Con `indicadores-provinciales.csv` (A) e `impominerales-siacam.csv` (B), el autor escribió un objetivo que pide analizar las fuentes por separado y preguntar ante ambigüedades; ocultó `PPRO` (desapareció del JSON), renombró `CIF` (cambió al instante), validó (huella SHA-256, 5 minutos, uso único) y autorizó: el sistema informó `AI_ENABLED=false` y que no se envió nada.

**Dónde llega el JSON en esta fase.** El contexto revisado **sí viaja al backend FastAPI local** (`POST /api/ai/requests`) para que lo valide la lista blanca; **no sale hacia ningún proveedor externo**: no hay SDK, URL ni llamada a OpenAI en el código, y el proveedor de esta fase no tiene red.

**Por qué estas tres decisiones.**

- **Autorización individual** (una solicitud, 5 minutos, contenido exacto por huella SHA-256): una autorización general e indefinida dejaría de reflejar lo que la persona vio; si el contenido cambia, la decisión debe volver a tomarse.
- **Minimización de metadatos** (alias en lugar de archivos, columnas elegibles y renombrables, tamaño solo por rango): la IA necesita la *estructura* para proponer un plan, no los registros ni las cifras exactas; compartir menos reduce lo que podría filtrarse.
- **Validación en el backend** (lista blanca Pydantic): las comprobaciones de React se pueden saltear modificando el navegador; el backend es la última puerta antes de cualquier proveedor y no acepta nada fuera de lo permitido.

**Limitaciones.** El sistema valida estructura, no significado: si el usuario escribe un dato confidencial en el objetivo o deja una columna sensible, se compartiría al autorizarlo. La autorización no es autenticación. Faltan el registro de envíos y la validación del plan devuelto por la IA (Fase 3B.2).

## 6i. Revisión obligatoria antes de conversar

**Decisión.** Antes de conectar OpenAI se reorganizó el recorrido: **cargar → revisar datos y privacidad → conversar → confirmar el plan**. La revisión pasó de ser un panel opcional dentro del asistente a un paso obligatorio previo.

**Qué se hizo (reutilizando lo existente).**

- Pantalla `/analisis/revisar` con una tabla por fuente (perfilador y catálogo existentes): formato y significado detectados, con la opción de aceptarlos o corregirlos; decisión sobre marcadores como `NA` (decidir más adelante, tratar como faltante, valor válido), sin eliminarlos.
- El componente de privacidad de la Fase 3B.1 (`AIContextReview`) se integró en modo controlado: columnas a compartir, nombres solo para la IA, objetivo y JSON exacto.
- Las decisiones se guardan en el estado del análisis (`session.review`) para las fases siguientes; el contexto para la IA las incluye (`user_corrected`, `missing_markers`) y la lista blanca del backend se amplió solo con valores cerrados.
- El asistente exige la revisión confirmada y recibe el objetivo precargado, sin enviarlo solo.
- Cambiar las fuentes o editar la revisión después de confirmarla invalida la confirmación.

**Fundamento académico.**

- **Calidad de datos:** un análisis es tan bueno como la interpretación de sus variables. Confirmar que `codigo` es un identificador y no una cantidad, o que un `NA` es un valor válido, evita sumar códigos o perder registros antes de calcular.
- **Supervisión humana:** el perfilador propone y la persona decide. Las sugerencias se aceptan por defecto y solo se corrige lo necesario, para que la revisión no se convierta en un formulario interminable.
- **Minimización de información:** en el mismo paso se elige qué columnas conocerá la IA y con qué nombre, y se ve el JSON exacto. La revisión ocurre **antes** de cualquier conversación, no después.
- **Separación entre formato y significado:** el formato físico (entero, decimal, texto, fecha, sí/no) y el significado estadístico (cuantitativa, categórica, código, temporal, texto libre) se revisan por separado. Un código puede tener formato numérico y significado de identificador.

**Límites deliberados.** No es un editor de datasets: no hay conversiones, limpieza ni uniones; las decisiones se registran pero todavía no se aplican. El formato elegido no se verifica contra los valores (por ejemplo, marcar "entero" una columna con decimales) y en la demo pública, sin backend, no hay interpretación semántica automática para corregir.

## 6j. Corrección de navegación del recorrido

**Problema detectado (validación manual del autor).** Con la revisión obligatoria, al entrar al asistente no había una forma clara de volver a `/analisis/revisar`, y los pasos del encabezado no eran navegables. Para corregir una interpretación, un `NA` o una columna autorizada, el usuario quedaba atrapado.

**Corrección.**

- **Requisitos en un solo lugar** (`lib/wizardSteps.ts`): cargar siempre; revisar, con al menos una fuente; conversar y confirmar, con la revisión confirmada y el proyecto creado. Lo usan el encabezado y las pantallas.
- **Encabezado navegable:** los pasos alcanzados son enlaces (accesibles con teclado, con foco visible); el activo se marca con `aria-current="step"`; los bloqueados no son enlaces, muestran un candado y explican el motivo (también para lectores de pantalla).
- **Botones claros:** «Volver a revisar datos» en el asistente y «Volver a cargar datos» en la revisión, como enlaces con aspecto de botón (un único elemento enfocable).
- **Se conserva todo al retroceder:** fuentes, perfiles, decisiones, objetivo, columnas autorizadas y la conversación. Si la revisión no cambió, «Continuar con el asistente» vuelve a la **misma** conversación sin crear otro proyecto.
- **Invalidación:** modificar una revisión confirmada exige confirmarla de nuevo (se avisa que la conversación empezará otra vez con las decisiones actualizadas).
- **Bloqueo hacia adelante también por URL:** conversar y confirmar muestran "Primero revisá tus datos" si falta la confirmación.
- **Autorizaciones de IA:** salir de la revisión cancela en el backend cualquier solicitud preparada; volver atrás no crea ni reutiliza permisos.

**Aprendizaje.** Un paso obligatorio sin retorno claro convierte un control de calidad en un obstáculo. La supervisión humana necesita poder corregir en cualquier momento, sin perder trabajo y sin saltear los controles.

## 6k. Una sola pantalla de configuración y autorización por mensaje

**Problema (pruebas manuales del autor).** Había dos lugares para revisar la información: el paso 2 completo y, en el asistente, otro panel grande con las mismas columnas, campos editables y JSON. Era redundante y podía confundir sobre dónde modificar los datos.

**Decisión.** La configuración de datos se edita **solo en el paso 2**. El paso 3 se concentra en conversar y muestra una tarjeta compacta: "Datos revisados", cantidad de fuentes, columnas autorizadas por fuente, el aviso de que nada se envía automáticamente a OpenAI y un único botón **«Modificar configuración de datos»** (reemplaza a «Volver a revisar datos», para no duplicar controles).

**Dos acciones distintas:**

| Acción | Qué autoriza | Qué NO autoriza |
|--------|--------------|-----------------|
| **A. Confirmar la revisión** (paso 2) | Continuar al asistente con esa configuración de datos | Ninguna transmisión a OpenAI |
| **B. Autorizar un envío** (paso 3, por mensaje) | Enviar **ese** mensaje con **ese** contexto, una vez, durante 5 minutos | Mensajes siguientes, ni el mismo mensaje modificado |

Para la acción B se preparó una experiencia compacta bajo el chat (solo con backend): el contenido exacto (contexto revisado + texto del mensaje), «Validar este mensaje», «Autorizar este envío» y «Cancelar». El botón «Enviar» sigue respondiendo con el asistente DEMO local y no valida ni autoriza nada por su cuenta.

**Cómo se evitó duplicar lógica.** El flujo validar → autorizar → invalidar se extrajo a un único hook (`useAIAuthorization`), que usan la pantalla de revisión y la autorización por mensaje. El hook cancela lo validado cuando cambia el contenido (contexto o mensaje) y al salir de la pantalla. El backend agregó a la lista blanca un campo `message` opcional; cada mensaje tiene su propia huella.

**Garantías que se mantienen.** El asistente no tiene selectores: no puede cambiar en silencio formatos ni significados confirmados. Modificar la configuración invalida la confirmación. La demo pública no tiene cliente de IA.

## 6l. Ajustes de experiencia en el paso 3

Tres problemas detectados por el autor en las pruebas manuales del paso 3 «Conversar».

**1. Botones de validación fuera de la vista.** Al abrir «Enviar a la IA real (requiere autorización)», el JSON empujaba «Validar este mensaje» hacia abajo; hubo que bajar el zoom de Chrome al 67 % para encontrarlo.
- *Causa:* el panel estaba dentro de la tarjeta del chat, que tiene altura fija y recorta su contenido (`overflow-hidden`); al abrirse, achicaba los mensajes y los botones quedaban fuera de la tarjeta.
- *Corrección:* el panel pasó debajo de la tarjeta del chat. Dentro del panel, las acciones van antes del JSON, y el JSON tiene una altura máxima (`min(12rem, 30vh)`) con scroll propio y foco de teclado. En la pantalla de revisión, el JSON también se limitó a `min(24rem, 50vh)`.

**2. Autorización con la IA deshabilitada.** Validar → autorizar → rechazo del backend (`AI_ENABLED=false`) y el formulario volvía al inicio, como si hubiera que repetir el proceso.
- *Corrección:* con la IA deshabilitada, el panel avisa antes de empezar: *Prueba de autorización … no habrá respuesta de IA ni se enviará ningún dato.* Tras el rechazo, queda un estado final: **«Prueba finalizada. La IA está deshabilitada y no se envió ningún dato.»** Sin botones para repetir ese mismo envío, y aclarando que la conversación y las decisiones se conservan. El rechazo 501 (conexión no implementada) tiene su propio estado final.
- *Garantías que no cambiaron:* la autorización sigue siendo de un solo uso (se descarta antes de la llamada) y el backend sigue rechazando. El resultado queda asociado al contenido exacto: un mensaje distinto es otro envío y vuelve a pedir validación. No se borra la conversación, el objetivo, las fuentes ni las decisiones.

**3. Objetivo precargado sin explicación.** El objetivo escrito en «¿Qué necesitás analizar?» aparecía en el chat sin aviso.
- *Corrección:* se mantiene la precarga, sin envío automático, con la indicación **«Tu objetivo está preparado. Enviá para comenzar la conversación.»** También se aclara que se puede editar. La indicación desaparece al enviar el primer mensaje o si se borra el texto.
- En la revisión, la ayuda pide escribir el objetivo con palabras propias, sin explicar cálculos, gráficos ni reportes.
- Se diferencian los dos envíos: bajo el chat, *«Enviar» conversa con el asistente DEMO, en este equipo. No usa OpenAI*. La autorización para OpenAI tiene su propio panel, con otro color e ícono.

**Sin cambios:** no se implementó OpenAI ni se agregó infraestructura, y el backend no cambió.

## 6m. Cierre del recorrido: validación manual del autor

El autor probó en su navegador local el recorrido completo de las secciones 6i a 6l y aportó capturas. El detalle está en [PRUEBAS_Y_VALIDACIONES.md](PRUEBAS_Y_VALIDACIONES.md), sección 20.

Esa evidencia visual es **del autor** y se registra aparte de las pruebas automatizadas y de las verificaciones en el navegador hechas con las herramientas de desarrollo (secciones 16 a 19).

Con esto se cierra la etapa de experiencia de usuario previa a la IA real. La siguiente es la Fase 3B.2 (OpenAI con límites de consumo y respuestas estructuradas); después vienen el motor de cálculo con Pandas, los tableros y los reportes PDF.

## 6n. Fase 3B.2 — Integración real con OpenAI (sin confirmar)

**Objetivo.** Un asistente real que comprenda qué necesita analizar la persona, pregunte cuando falte información y proponga planes estructurados. La IA propone, el usuario confirma y Pandas calculará en una etapa posterior.

**Inspección inicial.**
- La frontera de 3B.1 se reutilizó tal cual: lista blanca, huella, vencimiento y uso único. Solo se reemplazó el proveedor sin red.
- El objetivo todavía aparecía precargado en el chat: se reemplazó por un resumen del objetivo confirmado con el botón **«Comenzar conversación»**.
- La pantalla de revisión todavía permitía autorizar un envío: se quitó, porque confirmar la revisión no autoriza transmisiones.

**Decisiones.**
- **Modelo `gpt-6-luna`** (el preferido por el autor), verificado en la documentación oficial: Responses API, Structured Outputs, USD 0,10 / 0,50 por millón de tokens. Razonamiento `low` para acotar los tokens de salida, que incluyen el razonamiento.
- **Salida estructurada con Pydantic** y **validación propia** contra el contexto autorizado. Structured Outputs garantiza la forma, no que las columnas existan; por eso el backend vuelve a comprobarlas.
- **Cada plan usa una sola fuente.** Así, pedir "sin unir los datasets" se respeta por diseño; unir fuentes queda fuera de esta etapa.
- **Controles de consumo en el backend:**
  - límites de salida, contexto, solicitudes y presupuesto local de USD 1 (persistente);
  - estimación y reserva antes de enviar;
  - registro del consumo real;
  - sin reintentos automáticos.
- **Historial** de la conversación dentro del contenido aprobado, como máximo 8 turnos.
- **Objetivo sin duplicar:** si el mensaje es el objetivo, solo se envía `objective`.
- **Planes aprobables y guardados en memoria, sin ejecución.**

**Problemas encontrados.**
- **Heredoc del shell:** al editar algunos archivos con heredoc, el shell falló por el contenido. Se resolvió escribiendo los archivos directamente.
- **Validación duplicada en desarrollo:** el modo estricto de React montaba dos veces el panel de envío, y una de las dos validaciones quedaba pendiente en el backend hasta vencer. Se agregó una numeración de validaciones: la superada se cancela. Se verificó en el navegador que ambas solicitudes se cancelan.

**Primera llamada real.** No se realizó. Queda pendiente de la autorización explícita del autor, con datos sintéticos y costo acotado.

## 6o. Error 404 al cargar datasets con `VITE_DEMO_MODE=false` (sin confirmar)

**Problema detectado por el autor** en la primera prueba de integración de la Fase 3B.2, con esta configuración local:
- `VITE_DEMO_MODE=false`, `VITE_BACKEND_PROFILING=true` y `VITE_API_BASE_URL=http://127.0.0.1:8000`;
- backend con `AI_ENABLED=true`.

Al cargar un CSV, el navegador hacía `POST /api/datasets` y el backend respondía **404** (verificado por el autor en DevTools). En cambio, `POST /api/datasets/profile` respondía 200 con curl, para un CSV sintético de 6 filas (`fecha`, `sector`, `ventas`).

**Causa exacta.**
- `createService` (`frontend/src/services/index.ts`) elegía, con `VITE_DEMO_MODE=false`, el proveedor HTTP (`httpProvider.ts`).
- Ese proveedor implementa la **API completa planificada** en `docs/API_CONTRACT.md`: `POST /api/datasets` para guardar el archivo, `/api/datasets/{id}/profile`, `/api/projects`, la conversación y los resultados.
- El backend actual solo implementa `/api/health`, `/api/datasets/profile` y `/api/ai/*`.
- Además, `VITE_BACKEND_PROFILING` solo se tenía en cuenta dentro de DEMO.
- Por eso, desactivar DEMO llevaba a una API inexistente: el 404 de la carga habría seguido en `/api/projects` y en la conversación.

**Por qué no se redirigió `/api/datasets` al perfilado.** Los contratos son distintos. `/api/datasets` es una API de almacenamiento: guarda el archivo y devuelve un dataset persistido con identificador. `/api/datasets/profile` lee el archivo, devuelve el perfil y no guarda nada. Hacer pasar una por la otra ocultaría que el almacenamiento no existe.

**Corrección mínima.**
- Fuera de la demo pública, `createService` usa la **sesión local en memoria del navegador** con el **perfilado real de Pandas** (`POST /api/datasets/profile`). Es la misma composición que `VITE_DEMO_MODE=true` + `VITE_BACKEND_PROFILING=true`, que el backend actual sí soporta.
- El proveedor HTTP completo se conserva, documentado como "todavía no se usa", para cuando exista esa API.
- La franja superior distingue la **ejecución local** de la **demo pública**.
- La demo pública no cambia.

**Problema relacionado encontrado al verificar.**
- **Síntoma:** una prueba de navegación fallaba de forma intermitente.
- **Causa:** las pruebas de Vitest leían el `.env.local` del autor, que apunta a su backend real. Con ese backend en marcha y `AI_ENABLED=true`, algunas pruebas consultaban `/api/ai/status` y validaban contenido (`/api/ai/requests`) contra él.
- **Impacto:** ninguna prueba autorizó envíos. El backend del autor informó `spent_usd: 0.0` y `requests_used: 0`: no se consumieron créditos.
- **Corrección:**
  - la configuración de Vitest fija las variables `VITE_*` de la demo pública;
  - `fetch` queda bloqueado por defecto en las pruebas, salvo que cada prueba lo simule;
  - una prueba comprueba ese aislamiento.

## 6p. Primeras llamadas reales, plan aprobado en «Confirmar» y autorización por conversación (sin confirmar)

**Evidencia aportada por el autor: primeras llamadas reales a OpenAI.** Con un CSV sintético de 6 filas (`fecha`, `sector`, `ventas`):

| Consulta | Resultado informado | Consumo | Costo informado |
|----------|---------------------|---------|-----------------|
| 1 | OpenAI interpretó el objetivo y formuló preguntas aclaratorias | 1.265 tokens de entrada y 493 de salida | USD 0,0004 |
| 2 | El autor aclaró que `ventas` son importes en ARS, que cada fila es el total de un sector en un mes y que no hay faltantes. OpenAI incorporó esas aclaraciones y propuso sumas, comparaciones entre sectores y series temporales | 1.517 tokens de entrada y 723 de salida | USD 0,0005 |

Después, el autor aprobó un plan. La aplicación mostró "Plan aprobado y guardado…" y la tarjeta lateral "2 planes propuestos · 1 aprobado". Estas llamadas las hizo el autor; las herramientas de desarrollo no hicieron ninguna llamada real.

**Problema 1 (detectado por el autor): el plan aprobado no llegaba a «Confirmar».** Al abrir el paso 4 aparecía "Todavía no hay una propuesta".
- *Causa exacta:* `ConfirmPage` solo leía la propuesta del servicio DEMO (`service.getCurrentProposal`, en memoria del proveedor DEMO). Los planes de la IA real y su aprobación viven en la sesión del análisis (`aiChat` y `approvedPlanIds`), así que el paso 4 nunca los consultaba.
- *Corrección:*
  - **Una única fuente de verdad:** la sesión. `lib/aiPlans.ts` deriva de ahí los planes propuestos, los aprobados (en orden de aprobación), las aclaraciones del usuario y las advertencias.
  - El asistente y «Confirmar» usan esas funciones y el mismo componente (`AIPlanDetails`). Se muestra **exactamente** el plan estructurado validado; nada se reconstruye desde texto libre.
  - Al aprobar aparece «Plan aprobado correctamente», con «Continuar a Confirmar» y «Seguir conversando».
  - Sin planes aprobados, el paso 4 muestra un estado vacío y no permite confirmar.
  - Navegar no consulta a OpenAI ni ejecuta cálculos.

**Problema 2 (detectado por el autor): autorizar cada mensaje era lento.** Cada mensaje exigía validar y autorizar.
- *Decisión:* además de la autorización por mensaje (la opción por defecto, la más restrictiva), se puede **autorizar la conversación**. El permiso lo crea y lo controla el **backend**; no es un booleano de React.
- *El permiso:*
  - queda atado a la huella de la frontera de privacidad (objetivo y metadatos autorizados, sin mensaje ni historial);
  - vence a los 30 minutos;
  - admite 20 mensajes;
  - se revoca desde el asistente;
  - se anula si cambia la configuración de datos (el backend responde 409 y lo elimina; el frontend también lo revoca).
- *Límites:* cada mensaje pasa por los mismos límites de tamaño, solicitudes y presupuesto. Dos envíos simultáneos en la misma conversación se rechazan, y la reserva de presupuesto impide gastar de más con solicitudes concurrentes.
- *Diferencias entre conceptos:*

| Concepto | Qué significa | Qué NO hace |
|----------|---------------|-------------|
| **Autorización de un mensaje** | Ese envío a OpenAI, con el contenido exacto revisado, una vez | No autoriza los mensajes siguientes |
| **Autorización de la conversación** | Los próximos mensajes que el usuario envíe voluntariamente en esta conversación van a OpenAI sin volver a mostrar el panel. Cada envío comparte el mensaje, un historial limitado (hasta 8 turnos), el objetivo y los metadatos ya autorizados | No es permanente: vence (30 min), tiene tope de mensajes (20), se anula si cambia la configuración de datos y se puede revocar. No saltea ningún límite de consumo ni hace llamadas automáticas |
| **Aprobación de un plan** (asistente) | El usuario elige un plan validado; el backend lo registra | No consulta a la IA ni calcula nada |
| **Confirmación de la propuesta** (paso 4) | El usuario confirma los planes aprobados para la etapa siguiente | No ejecuta cálculos |
| **Ejecución de cálculos** (próxima etapa) | Pandas calculará los planes confirmados | — Todavía no implementada |

**Problema relacionado en la verificación.** Los heredocs del shell volvieron a fallar con algunos contenidos. Se usaron scripts escritos como archivos.

## 6q. Fase 4A — Motor de análisis real con Python y Pandas (sin confirmar)

**Objetivo.** Que un plan aprobado produzca resultados numéricos verdaderos, calculados con Pandas desde el archivo cargado. La IA no participa del cálculo.

**Inspección inicial.**
- `/api/datasets/profile` lee el archivo, devuelve el perfil y lo descarta: no hay datos guardados para calcular.
- El navegador tampoco conservaba el archivo: solo guardaba el perfil.
- Los planes aprobados existen en el registro del backend (memoria) y en la sesión del navegador.

**Decisión sobre el acceso a los datos.**
- El navegador conserva el `File` original **solo en memoria**.
- Al pulsar «Ejecutar análisis», lo **vuelve a enviar** junto con los identificadores de los planes y la correspondencia de columnas.
- El backend calcula sobre una copia en memoria y la descarta.
- Se descartó guardar archivos en el servidor: agregaba almacenamiento, limpieza y riesgos de privacidad innecesarios para un MVP local.

**Implementación.**
- **Motor:** `analysis_engine.py`, con un catálogo cerrado de operaciones, cada una con su función. Se agregó la mediana, que usa el mismo camino que el promedio, y la frecuencia y los valores distintos, que son conteos.
- **Endpoint:** `POST /api/analysis/execute`. Toma los planes del registro del backend y exige que estén aprobados.
- **Lectura compartida:** se extrajo `read_dataset` del perfilador, para que el motor lea igual y con los mismos límites.
- **Interfaz:** en «Confirmar», después de la confirmación final, aparecen «Ejecutar análisis», la unidad opcional de cada cantidad y tablas con los resultados.
- Detalle de funciones, flujo de datos, validaciones y operaciones de Pandas en [ARCHITECTURE.md](ARCHITECTURE.md), sección "Motor de análisis con Pandas".

**Verificación del caso obligatorio (CSV sintético de ventas en ARS).** Pandas produjo:

| Agrupación | Resultado |
|------------|-----------|
| Enero | 23.000 |
| Febrero | 27.500 |
| Marzo | 32.000 |
| Tecnología | 54.000 |
| Indumentaria | 28.500 |
| Total general | 82.500 |

Se comprobó en pruebas automáticas y en la aplicación.

**Problemas encontrados.**
- **Heredocs del shell:** volvieron a fallar con algunos contenidos. Se usaron scripts escritos como archivos.
- **Tiempo de una prueba:** con la suite completa en paralelo, la prueba de punta a punta del plan aprobado superó el límite de 5 s de Vitest. Era un tiempo agotado, no un fallo de aserción. Se le dio un límite de 15 s.

## 6r. Fase 4B — Dashboard interactivo con resultados reales (sin confirmar)

**Objetivo.** Ver los resultados de Pandas como un dashboard (indicadores, gráficos, tablas, unidades y avisos), sin inventar números ni mostrar gráficos ficticios en el modo local.

**Inspección.**
- El proyecto ya usaba Recharts en `ChartCard`, con vista de gráfico o de tabla, tooltip, leyenda y una paleta validada.
- Se reutilizó con extensiones mínimas, sin agregar otra librería:
  - unidad en tooltips y tablas;
  - títulos de ejes;
  - gráfico de torta;
  - tres colores más para series adicionales (los tres primeros no cambian);
  - opción de dibujar sin animación.
- El motor (Fase 4A) no se modificó.

**Implementación.**
- `lib/dashboard.ts`: funciones puras que transforman la respuesta del motor y eligen las visualizaciones.
- `AnalysisResults.tsx`: ahora es el dashboard, con una sección por fuente.
- `AnalysisExecution.tsx`: estado de carga y llevar la vista al dashboard al terminar.
- Explicación técnica completa en [ARCHITECTURE.md](ARCHITECTURE.md), sección "Dashboard de resultados reales".

**Problemas encontrados en la verificación del navegador.**
- **Líneas sin dibujar:** las líneas quedaban detenidas al comienzo de la animación de Recharts (`stroke-dasharray` de 6 px). Los gráficos de resultados ahora se dibujan sin animación, así siempre se ven completos. Los de la demo no cambian.
- **Sin desplazamiento automático:** el desplazamiento suave hacia el dashboard no se producía en el navegador integrado. Se usa desplazamiento inmediato, que además respeta a quien reduce las animaciones.
- **Barra que tapaba el dashboard en móvil:** la barra "Propuesta confirmada" seguía fija abajo y tapaba parte del dashboard. Después de confirmar queda estática, y la ejecución y el dashboard aparecen debajo de ella.
- **Gráfico pedido imposible:** cuando el plan pide un gráfico que no se puede construir, la operación conserva su visualización estándar y el aviso lo dice explícitamente. Así no hay un reemplazo silencioso ni se pierde el gráfico de esa operación.

## 6s. Modo real sin respuestas simuladas, catálogo único e instrucciones de la IA (sin confirmar)

**Problema señalado por el autor.** El objetivo es una plataforma de análisis guiada por OpenAI real, no un chatbot DEMO. En las pruebas aparecían respuestas simuladas, y propuestas que se repetían en lugar de responder la pregunta.

**Diagnóstico.**
- **Caída silenciosa al DEMO:** `AssistantPage` usaba la IA real solo si el backend confirmaba que estaba disponible. En cualquier otro caso volvía, sin avisar, al asistente DEMO de guion fijo, que propone siempre los mismos indicadores. Eso pasaba mientras se consultaba el estado, con el backend inaccesible o con la IA deshabilitada.
- **Catálogo desalineado:** la IA podía proponer 16 operaciones, pero el motor ejecuta 11. También podía pedir gráficos que el dashboard no construye.
- **Instrucciones genéricas:** no pedían partir de la pregunta concreta, y el historial solo llevaba los títulos de los planes.

**Corrección.**
- En modo real se eliminó el asistente DEMO y se muestran el motivo y «Reintentar» cuando la IA no está disponible.
- Se quitaron también el dataset de ejemplo y la propuesta DEMO en «Confirmar».
- Hay un catálogo único de operaciones y gráficos, compartido por la IA y el motor, verificado por una prueba.
- Se reescribieron las instrucciones de la IA, y el historial ahora incluye las operaciones de cada plan.
- Se agregó el metadato aproximado `distinct_values`.
- Detalle en [ARCHITECTURE.md](ARCHITECTURE.md), sección "Modo real sin respuestas simuladas y catálogo único".

**El proveedor simulado** se usa **solo en las pruebas automáticas** y en verificaciones locales con un lanzador fuera del repositorio. **Nunca** como respaldo del modo real.

**Problemas encontrados al verificar.**
- **Motivo desactualizado al reintentar:** durante el reintento seguía visible el motivo anterior. Ahora se muestra «Comprobando la conexión con la IA…» mientras se consulta.
- **Indicador confuso:** con la IA no disponible se veía el indicador «Autorización por mensaje». Ahora solo aparece cuando la IA está disponible.

## 6t. Histograma, dispersión y curva ROC (sin confirmar)

**Objetivo.** Que el usuario pueda pedirle a la IA histogramas, gráficos de dispersión y curvas ROC, y que, si los datos lo permiten, Python calcule y Recharts dibuje, sin resultados ficticios ni código de la IA.

**Decisiones.**
- **scikit-learn 1.9.1** (aprobado por el autor) para `roc_curve` y `roc_auc_score`.
- **NumPy** para el histograma, con la **regla de Sturges**.
- **Pandas** para la correlación de Pearson y Spearman.
- **Muestreo reproducible** (semilla 42) para mostrar como máximo 2.000 puntos.
- **Clase positiva:** la elige el usuario al ejecutar. La IA no ve valores; el backend la valida.
- **Validación del plan:** se agregaron reglas de forma para que la IA no proponga estos análisis sobre columnas inadecuadas (por ejemplo, una ROC sin etiqueta binaria).
- **Instrucciones:** se actualizaron para elegir la visualización según la pregunta y explicar qué falta para una ROC.
- Detalle técnico en [ARCHITECTURE.md](ARCHITECTURE.md), sección "Histograma, dispersión y curva ROC".

**Verificación de los cálculos con valores conocidos:**
- **Histograma:** 0 a 7 da 4 intervalos de 1,75 con 2 valores cada uno.
- **Dispersión:** Pearson 0,7746 y Spearman 0,7379 en un caso de referencia.
- **ROC:** AUC 1 con separación perfecta, y AUC 0,75 calculado a mano (3 de 4 pares positivo-negativo bien ordenados).
- **En el navegador:** con 12 filas sintéticas, un AUC de 0,944 que coincide con el conteo manual (34 de 36 pares) y los 5 intervalos de Sturges con frecuencias 3, 1, 3, 1, 4.

**Problemas.**
- No hubo errores de cálculo. Las pruebas anteriores que verificaban que estos gráficos *no* existían se adaptaron, igual que la exigencia de las instrucciones ("entrenar un modelo").
- **Tiempo límite de las pruebas:** antes del commit, una ejecución con la máquina cargada (la suite del backend corriendo al mismo tiempo) hizo superar el límite de 5 s de Vitest a pruebas largas de punta a punta, como el recorrido local completo, de unos 4 s. Era un tiempo agotado, no un fallo de aserción. Se reprodujo con carga simultánea, y se fijó `testTimeout: 15_000` en la configuración de Vitest; después, 4 de 4 ejecuciones bajo carga pasaron.
- **Dependencias:** NumPy quedó declarada en `requirements.txt`, porque el motor la importa directamente. `pip check` no encontró dependencias rotas.

## 7. Demo pública en Cloudflare Pages (commit `492b9f9`)

- Configuración documentada en [DEPLOYMENT.md](DEPLOYMENT.md): carpeta `frontend`, `npm run build`, salida `dist`, `VITE_DEMO_MODE=true`.
- Las rutas de React Router funcionan al recargar porque Cloudflare trata el sitio como SPA cuando no existe `404.html`; por eso no fue necesario agregar `_redirects`.
- La demo muestra tres avisos: el ejemplo es ficticio, las funciones avanzadas requieren backend y no deben cargarse datos confidenciales.
- **Estado: publicada** en https://datadecisionai.pages.dev. La publicación exitosa la confirmó el autor con una captura del panel de Cloudflare (evidencia comunicada). Además, el 24/10/2026 se comprobó que la URL responde HTTP 200 y que una ruta interna (`/analisis/cargar`) también responde, lo que confirma el manejo de rutas SPA.
- **Fundamento:** publicar solo el frontend en modo DEMO permite mostrar el producto sin costo de servidor y sin recibir datos de terceros: el archivo de un visitante nunca sale de su navegador.

## 8. Instalaciones públicas y privadas

Se decidió que **el mismo código** sirva para dos modalidades, diferenciadas solo por configuración:

| Modalidad | Componentes | Propósito |
|-----------|-------------|-----------|
| Demo pública | Solo frontend, modo DEMO | Mostrar el flujo sin costo y sin recibir datos de terceros. |
| Instalación privada | Frontend + FastAPI + Pandas (+ SQLite a futuro) dentro de la organización | Analizar datos propios sin que salgan de la red de la organización. |

El motivo es de confianza: una organización no debería subir datos sensibles a un servidor público de un proyecto académico. La instalación privada todavía **no está lista para datos confidenciales** (ver [SEGURIDAD.md](SEGURIDAD.md)).

## 9. Arquitectura local-first y futura IA

- **Local-first**: los datos se procesan en el navegador (demo) o en el backend de la propia organización (instalación privada). Ningún servicio externo es necesario para cargar y perfilar datos.
- **OpenAI (planificado, no implementado)**: la clave existiría solo en `backend/.env`; nunca en el frontend. La IA recibiría el perfil y resúmenes agregados, no el archivo completo, y su salida se validaría contra los cálculos de Pandas.
- **Ollama (alternativa evaluada, no implementada)**: ejecutar un modelo de lenguaje en el propio equipo para que ni siquiera el perfil salga de la organización.
- **Regla de diseño**: la IA elige operaciones de un catálogo cerrado; **no se ejecuta código generado por la IA**.

### Decisión: minimización de datos (pendiente de implementación)

**Qué se decidió.** Python y Pandas procesan el dataset completo en el entorno correspondiente. OpenAI recibe solo la información **mínima, necesaria y autorizada** para comprender objetivos, planificar análisis o interpretar resultados. Por defecto **no** se envían el archivo completo, las filas originales, los valores de ejemplo ni las vistas previas. Si lo que se pretende enviar puede ser confidencial, se requiere autorización explícita. La IA propone planes de análisis estructurados y **no puede modificar libremente el código del backend**.

**Fundamentos técnicos.**

- **Para planificar no hacen falta los datos crudos:** con nombres y tipos de columna, cantidad de filas, vacíos y agregados, un modelo de lenguaje puede entender el objetivo y proponer qué calcular. Los cálculos exactos los hace Pandas.
- **Separar razonamiento y cálculo** reduce el riesgo de que la IA invente números: cada cifra sale de Pandas y se puede validar.
- **Planes estructurados en lugar de código:** un plan con operaciones de un catálogo cerrado se valida contra un esquema y contra las columnas reales; el código libre generado por una IA podría ejecutar acciones no previstas o exponer información.
- **El perfil actual incluye datos reales** (`examples` y `preview`), por lo que no puede enviarse tal cual: hace falta una capa de filtrado explícita.

**Relación con la privacidad empresarial.** Una organización puede aceptar que se comparta la *estructura* de sus datos, pero no sus registros (clientes, montos, proveedores). La minimización reduce lo expuesto a un tercero, limita el impacto de una filtración y deja la decisión en manos de la organización mediante la autorización explícita. Junto con la opción de IA local (Ollama) y la instalación privada, permite ofrecer niveles de privacidad según la sensibilidad de los datos.

**Estado.** Es una decisión de arquitectura documentada; **todavía no está implementada ni validada**, porque la integración con OpenAI tampoco existe aún.

## 10. Problemas encontrados, soluciones y aprendizajes

| Problema | Solución | Aprendizaje |
|----------|----------|-------------|
| El alias `@/` compilaba con TypeScript pero fallaba en la build de Vite. | Configurar el alias también en `vite.config.ts`. | Cada herramienta (tsc, Vite, Vitest) resuelve rutas por separado. |
| El entorno de pruebas (jsdom) no implementa `Blob.text()`. | Función `readBlobText` con alternativa `FileReader`. | Las pruebas corren en un navegador simulado con diferencias reales. |
| La tabla de vista previa desbordaba la pantalla horizontalmente. | Grillas con `minmax(0,1fr)` y `min-w-0`. | Los contenidos anchos rompen layouts flexibles si no se acotan. |
| `pydantic-settings` no leía `CORS_ORIGINS` separado por comas. | Anotación `NoDecode` y validador propio. | La configuración también necesita pruebas. |
| Al recargar una página del workspace en DEMO aparece "No se encontró el proyecto". | Se documentó como comportamiento esperado (estado solo en memoria). | Sin persistencia, el estado se pierde; requiere base de datos (tarea pendiente). |
| **Informado por el autor:** al cargar un dataset de importaciones de minerales, el asistente DEMO respondió en términos de ventas. | Mensajes neutrales para archivos propios, aviso de que el asistente no interpreta el rubro y propuesta sin vocabulario de ventas; pruebas automáticas que lo verifican. | Un guion por palabras clave no comprende el dominio; hay que acotar lo que afirma. |
| Puerto 5173 ocupado por Docker/WSL; Vite usó 5174 y CORS lo rechazaba. | Variable de entorno `CORS_ORIGINS` temporal, sin cambiar código. | La configuración externa al código permite adaptar cada entorno de forma segura. |
| Backend y navegador contaban distinto `NA`, `null` o `-`; un 100 % de completitud podía ocultarlos. | Política única: solo la celda vacía es faltante; los marcadores se informan como sospechosos; prueba que compara ambas listas. | Las métricas de calidad necesitan un criterio explícito y compartido. |
| Columnas numéricas como años o códigos podían sumarse como cantidades. | Tipo semántico con confianza y motivo, separado del formato. | El tipo técnico no dice qué significa un dato; inferirlo exige mostrar la duda. |
| Analizar varias tablas puede multiplicar registros si se unen por una clave no única. | Fase 3A: cargar y describir cada fuente por separado; ninguna unión sin validación de claves, granularidad y cardinalidad, y sin aprobación. | Con varias fuentes, el riesgo principal está en la combinación, no en la lectura. |
| La documentación afirmaba que los archivos "no se guardan" y que el corte de 25 MB era inmediato. | La auditoría mostró el archivo temporal de Starlette y el corte posterior; se corrigió la documentación y se propusieron controles. | Las afirmaciones de seguridad deben verificarse ejecutando, no solo leyendo el código propio. |
| El costo de memoria de Pandas no depende del peso del archivo sino de la cantidad de celdas. | Límite de celdas verificado antes de crear el DataFrame (CSV incremental, XLSX por flujo). | Medir el peor caso cambia qué conviene limitar. |
| Integrar todo el backend de una vez era difícil de verificar. | Opción independiente `VITE_BACKEND_PROFILING`. | Integrar de a una pieza permite probar cada cambio. |

## 11. Funcionalidades implementadas y pendientes

**Implementado**

- Interfaz completa en modo DEMO, responsive y en español.
- Validación de archivos (rechaza PDF, vacíos y archivos demasiado grandes).
- Vista previa local de CSV sin enviar el archivo por la red.
- Perfilado real de CSV y XLSX con FastAPI + Pandas (`POST /api/datasets/profile`), sin guardar el archivo.
- Política explícita de faltantes y marcadores sospechosos, coherente entre backend y navegador.
- Hasta tres fuentes por análisis, perfiladas por separado, con catálogo estructurado de esquemas (sin uniones), validado por el autor con dos datasets reales.
- Endurecimiento de la carga: tamaño, origen, límites de celdas, XLSX, perfilado en hilo y concurrencia limitada.
- Interpretación semántica estimada de columnas con confianza y motivo, validada por el autor con SIACAM (con la limitación observada en `PPRO`).
- Integración opcional de la pantalla de carga con ese perfilado.
- Asistente DEMO con propuesta versionada, viabilidad y aprobación obligatoria.
- Workspace con resultados **ficticios** del dataset de ejemplo, claramente marcados.
- Interfaz de exportación (sin generación de archivos).
- Demo pública publicada en Cloudflare Pages (https://datadecisionai.pages.dev) y guía de instalación privada.
- Pruebas automáticas en frontend y backend.

**Pendiente**

- Persistencia (SQLite) y carga de archivos con identificador (`POST /api/datasets`).
- IA 1 e IA 2 reales (OpenAI u Ollama).
- Cálculos, gráficos y hallazgos sobre datos reales.
- Generación de PDF, Excel, Word y archivos para Canva.
- Despliegue del backend (la demo pública del frontend ya está publicada).
- Implementación y pruebas de la política de minimización de datos y de la autorización explícita.
- Asistente que consulte al usuario ante variables, marcadores de ausencia o necesidades de análisis ambiguos, y aplicación no destructiva de sus decisiones en Pandas (próxima fase).
- Propuestas de IA 1 que usen varias fuentes (comparar, concatenar, relacionar) con validación de claves, granularidad y cardinalidad antes de ejecutarlas.
- Controles de seguridad empresarial (ver [SEGURIDAD.md](SEGURIDAD.md)).

La hoja de ruta completa está en [NEXT_STEPS.md](NEXT_STEPS.md).
