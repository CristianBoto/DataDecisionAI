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
- Lectura del archivo por fragmentos, con corte a los 25 MB (HTTP 413).
- Límites de 250.000 filas y 250 columnas; límite de 60 MB descomprimidos para XLSX (protección ante archivos comprimidos maliciosos).
- Rechazo de extensiones no admitidas, archivos vacíos, XLSX dañados y CSV con caracteres nulos (HTTP 422, mensajes sin rutas internas).
- Lectura de todas las celdas **como texto**: no se evalúan fórmulas ni se convierten tipos automáticamente.
- El archivo se procesa en memoria y **no se guarda**; no se eliminan duplicados ni se rellenan vacíos.

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
