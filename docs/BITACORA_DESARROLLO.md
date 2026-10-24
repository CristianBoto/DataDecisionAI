# Bitácora de desarrollo — DataDecision AI

Proyecto final de **Prácticas Profesionalizantes — Tecnicatura en Ciencia de Datos**.
Autor: Damián Boto. Documento de base para la exposición final.

> **Criterio de este documento:** se registra solo lo que consta en el repositorio (código, commits, archivos sin confirmar) o lo que el autor informó explícitamente, y se indica cuál es cuál. Las pruebas y sus resultados están en [PRUEBAS_Y_VALIDACIONES.md](PRUEBAS_Y_VALIDACIONES.md); la seguridad, en [SEGURIDAD.md](SEGURIDAD.md).

## Línea de tiempo

| Etapa | Evidencia en el repositorio |
|-------|-----------------------------|
| 1. MVP inicial: frontend completo en modo DEMO y esqueleto FastAPI | Commit `797fdd7` (24/10/2026, 14:09) |
| 2. Preparación de la demo pública y documentación de instalación privada | Commit `1fe248a` (24/10/2026, 15:35) |
| 3. Perfilado de datasets con FastAPI + Pandas | Commit `7971702`: `backend/app/services/dataset_profiler.py`, `backend/app/api/routes/datasets.py`, `backend/tests/test_dataset_profiler.py` (incorporados por el autor) |
| 4. Integración de la pantalla de carga con el perfilado real | Commit `7971702`: `frontend/src/services/backendProfile.ts` y cambios en la capa de servicios |
| 5. Documentación académica (este documento) | Commit `7971702`, actualizada en cada fase |
| 6. Publicación de la demo en https://datadecisionai.pages.dev | Captura de Cloudflare provista por el autor (comunicada); respuesta HTTP 200 comprobada el 24/10/2026 |
| 6b. Prueba local con el dataset real `impominerales-siacam.csv` (102.254 registros) | Capturas del autor (comunicada); ver [PRUEBAS_Y_VALIDACIONES.md](PRUEBAS_Y_VALIDACIONES.md), sección 7 |
| 6c. Fase 2: calidad y confiabilidad del dataset (faltantes, tipos semánticos) | Commit de cierre de la Fase 2; validación con SIACAM aportada por el autor (sección 6c) |
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

## 4. Frontend con React, TypeScript y Tailwind (commit `797fdd7`)

- **Pantallas** en español: inicio, carga, asistente, confirmación y workspace (resumen con indicadores y gráficos, dataset y exportación del análisis).
- **Capa de servicios con una interfaz única** (`DataDecisionService`) y dos implementaciones: un proveedor **DEMO** en memoria y un cliente **HTTP** para FastAPI. Las pantallas nunca hacen `fetch` ni conocen los datos simulados; cambiar de modo es cambiar una variable de entorno (`VITE_DEMO_MODE`).
- **Vista previa real de CSV en el navegador**: detección de separador, tipos inferidos, vacíos y primeras filas, marcada como preliminar.
- **Honestidad de datos**: todo lo simulado lleva la marca DEMO; un archivo propio nunca recibe resultados inventados (queda "pendiente de backend").
- **Asistente DEMO**: guion determinista por palabras clave, que usa solo columnas existentes del perfil. No es IA.
- **Exportación**: interfaz y contrato listos; los botones indican que la generación todavía no está disponible.

## 5. Backend con FastAPI y Pandas

- **Esqueleto inicial** (`797fdd7`): fábrica `create_app()`, configuración con `pydantic-settings` leída de `.env`, CORS limitado a los orígenes de desarrollo y endpoint `GET /api/health`.
- **Perfilado de datasets** (incorporado por el autor, commit `7971702`): `POST /api/datasets/profile` recibe el archivo por `multipart/form-data`, lo lee con Pandas **como texto** (para no transformar identificadores como `00123`) y devuelve filas, columnas, vacíos, valores distintos, ejemplos, duplicados, primeras filas y advertencias. **No modifica ni guarda el archivo.** Incluye límites de tamaño, filas y columnas, y controles para Excel comprimido.

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

## 7. Demo pública en Cloudflare Pages (commit `1fe248a`)

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
| Integrar todo el backend de una vez era difícil de verificar. | Opción independiente `VITE_BACKEND_PROFILING`. | Integrar de a una pieza permite probar cada cambio. |

## 11. Funcionalidades implementadas y pendientes

**Implementado**

- Interfaz completa en modo DEMO, responsive y en español.
- Validación de archivos (rechaza PDF, vacíos y archivos demasiado grandes).
- Vista previa local de CSV sin enviar el archivo por la red.
- Perfilado real de CSV y XLSX con FastAPI + Pandas (`POST /api/datasets/profile`), sin guardar el archivo.
- Política explícita de faltantes y marcadores sospechosos, coherente entre backend y navegador.
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
- Controles de seguridad empresarial (ver [SEGURIDAD.md](SEGURIDAD.md)).

La hoja de ruta completa está en [NEXT_STEPS.md](NEXT_STEPS.md).
