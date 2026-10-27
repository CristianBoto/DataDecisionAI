# Auditoría de ciberseguridad preproducción — DataDecision AI

**Fecha:** 26/10/2026 · **Versión auditada:** `main` en `47f4bc2` (backend FastAPI + Pandas + OpenAI, frontend React).
**Objetivo:** decidir si la aplicación que funciona en `localhost` puede publicarse en Internet con IA real, Pandas y dashboards, y qué hace falta para hacerlo de forma segura.

**Método.** Cada conclusión se basa en el código, en una prueba automatizada o en una verificación ejecutada para esta auditoría. Un control no se da por implementado solo porque exista una variable de configuración o un comentario.
- **Pruebas existentes:** backend 209, frontend 173.
- **Script de auditoría propio:** dos "visitantes" distintos contra la misma API, con un proveedor de IA simulado, la red externa bloqueada y sin consumo de OpenAI.
- **Auditoría de dependencias:** `pip-audit` y `npm audit`.
- **Medición de memoria y tiempo** con un archivo en el límite.
- **Búsqueda de secretos** en el historial de Git.

**Conclusión general (versión auditada `47f4bc2`):**
- **Como herramienta local para una sola persona:** es segura.
- **Publicada en Internet tal como está: NO.** Le faltan autenticación, aislamiento entre visitantes, cuotas por visitante y protección contra abuso. Cualquiera podría usar la API, gastar los créditos de OpenAI o bloquear el servicio a los demás.

> **Actualización (26/10/2026, cambios sin confirmar):** las siete correcciones imprescindibles de la sección 3 se implementaron y se probaron. Las secciones 1 a 5 se conservan como registro de la auditoría original; el estado actual, control por control, está en la [sección 6](#6-correcciones-aplicadas-para-la-beta-pública).

---

## 1. Matriz de controles

Estados: ✅ implementado y verificado · 🟡 implementado parcialmente · ❌ no implementado · ➖ no aplicable.

### Controles generales

| # | Control | Estado | Evidencia (archivo · función · prueba) |
|---|---------|--------|----------------------------------------|
| 1 | Protección de API keys | ✅ (local) | La clave solo existe en `backend/.env` (`Settings.openai_api_key`, `app/core/config.py`) y nunca en variables `VITE_*`. Solo la usa `OpenAIProvider` (`app/services/openai_provider.py`). `/api/ai/status` informa un booleano: prueba `test_status_reports_configuration_without_revealing_the_key`. Los errores no incluyen la clave: `test_openai_errors_are_translated_without_secrets`. El paquete público no contiene claves ni la URL de OpenAI (búsqueda en `dist/`). En producción debe ir en el gestor de secretos de la plataforma, no en un archivo |
| 2 | Secretos en Git y su historial | ✅ | En todo el historial solo se versionaron `backend/.env.example` y `frontend/.env.example`, con la clave vacía. No hay ningún patrón de clave (`sk-…`) en ningún commit. `.env`, `*.local` y `backend/data/` están en `.gitignore` (`git check-ignore`) |
| 3 | Credenciales y permisos de base de datos | ➖ | No hay base de datos. El consumo se guarda en un JSON local (`AIBudget`, `app/services/ai_budget.py`) |
| 4 | Row-Level Security | ➖ | Sin base de datos. Será aplicable si se agrega una base compartida entre visitantes |
| 5 | Cifrado de información sensible | 🟡 | **En tránsito:** sin HTTPS en local (ver 19). **En reposo:** no se guardan datasets; el registro de consumo no tiene contenido (`test_real_usage_is_recorded_without_content`); la clave está en texto plano en `.env` (aceptable en local, no en producción) |
| 6 | Autenticación de usuarios | ❌ | No existe. Ningún endpoint identifica al visitante |
| 7 | Autorización y aislamiento de datos | ❌ | Las autorizaciones, conversaciones y planes funcionan como **tokens al portador**: quien tiene el identificador lo puede usar. El script de auditoría lo demostró: el visitante B usó la autorización, la conversación y el plan del visitante A (HTTP 200). Los identificadores no se pueden adivinar (`secrets.token_urlsafe`: 128 y 96 bits), pero no tienen dueño |
| 8 | Protección contra manipulación de campos y planes | ✅ | Ver detalle debajo de la tabla |
| 9 | Sesiones y cookies | ➖ | No hay sesiones ni cookies. Serán necesarias con la autenticación |
| 10 | Almacenamiento de contraseñas | ➖ | No hay contraseñas. Si se usan códigos de invitación, guardar solo su hash |
| 11 | Rate limiting | 🟡 | Solo hay contadores **globales** del proceso: 20 solicitudes pendientes, 25 solicitudes de IA por sesión del servidor, 2 perfilados y 1 ejecución simultáneos. No hay límite por cliente ni por IP. Script de auditoría: un cliente llenó el cupo de pendientes y el otro recibió 429 |
| 12 | Protección contra bots y abuso | ❌ | No hay captcha ni desafíos, y los clientes automáticos pasan el control de origen (ver 22) |
| 13 | Consultas parametrizadas | ➖ | No hay SQL. La búsqueda de `execute(`, `.query(`, `text(` no encontró consultas |
| 14 | Validación de entradas | ✅ | Ver detalle debajo de la tabla |
| 15 | Protección frente a XSS e inyección de contenido | 🟡 | React escapa todo el texto, incluidas las respuestas de la IA (`AIReplyCard`), y no hay `dangerouslySetInnerHTML`, `innerHTML`, `eval` ni `new Function` (búsqueda en `frontend/src`). **Falta** una Content-Security-Policy como segunda barrera (ver 18) |
| 16 | Restricciones de archivos | ✅ | Ver detalle debajo de la tabla |
| 17 | Minimización de lo enviado y devuelto | 🟡 | A la IA llegan solo metadatos revisados por el usuario, por lista blanca: `test_context_rejects_files_rows_previews_and_unrequested_fields`, `test_columns_cannot_carry_values_or_statistics`. Los resultados vuelven solo a quien los pidió. Los identificadores de planes y conversaciones viajan en la ruta de la URL, así que quedan en los registros de acceso |
| 18 | Encabezados de seguridad HTTP | ❌ | Script de auditoría: la API no envía `Strict-Transport-Security`, `X-Content-Type-Options`, `Content-Security-Policy`, `X-Frame-Options` ni `Referrer-Policy`. El frontend tampoco tiene `public/_headers` para Cloudflare Pages |
| 19 | HTTPS | 🟡 | Cloudflare Pages ya sirve el frontend con HTTPS. El backend corre en `http://127.0.0.1` (`docs/DEPLOYMENT.md`); falta HTTPS para publicarlo |
| 20 | Auditoría de dependencias | 🟡 | `pip-audit` sobre las 50 dependencias Python: sin vulnerabilidades conocidas. `npm audit --omit=dev` (producción): 0. `npm audit` completo: 3 en herramientas de prueba (`vitest`, `tinypool`), que no llegan a la aplicación publicada |

**Detalle del control 8 (manipulación de campos y planes):**
- Lista blanca Pydantic (`extra="forbid"`) en `app/schemas/ai_context.py` y `app/schemas/analysis.py`.
- Huella SHA-256, autorización de uso único y vencimiento (`AIRequestStore.consume`): `test_unprepared_or_altered_requests_are_rejected`, `test_authorization_is_single_use_and_sends_only_the_approved_content`.
- Respuesta de la IA validada contra el contexto (`validate_reply`).
- El motor toma los planes del registro del backend, no del navegador (`approved_plans`, `app/api/routes/analysis.py`). Script de auditoría: un plan fabricado da 404 y una operación inyectada en el pedido da 422.

**Detalle del control 14 (validación de entradas):**
- Esquemas estrictos con longitudes y valores cerrados: `test_review_fields_only_accept_closed_values`, `test_exact_counts_are_not_accepted_as_distinct_values`.
- Cuerpo máximo de 64 KB en `/api/ai/*`: `test_oversized_ai_requests_are_rejected`.
- Errores 422 sin trazas internas.

**Detalle del control 16 (restricciones de archivos):**
- Solo CSV y XLSX; 25 MB por archivo y 60 MB por pedido.
- Límites de filas, columnas y celdas antes de Pandas.
- Descompresión real de XLSX limitada y cantidad de entradas limitada (contra "bombas zip").
- Todo se lee como texto y no se guarda (`read_dataset`, `app/services/dataset_profiler.py`; `UploadGuardMiddleware`).
- 19 pruebas en `tests/test_hardening.py`.

### Controles específicos de DataDecision AI

| Control | Estado | Evidencia |
|---------|--------|-----------|
| 21. Prompt injection y límites de confianza en OpenAI | 🟡 | Ver detalle debajo de la tabla |
| 22. Autorización efectiva de los endpoints | ❌ | El control de `Origin` (`UploadGuardMiddleware`, `app/core/upload_guard.py`) **no es autenticación**: deja pasar los pedidos sin `Origin` (decisión deliberada para herramientas locales: `test_local_tools_without_origin_still_work`) y no puede impedir un `Origin` falsificado. Script de auditoría: sin `Origin` y con `Origin` falso, la API aceptó preparar envíos a la IA (201) |
| 23. Protección de créditos y presupuesto global persistente | 🟡 | Ver detalle debajo de la tabla |
| 24. Aislamiento de conversaciones y planes entre visitantes | ❌ | Ver control 7. No existe el concepto de visitante: `AIRequestStore`, `AIConversationStore` y `AIPlanStore` son globales del proceso |
| 25. Protección contra ejecución de código arbitrario | ✅ | No hay `eval`, `exec`, `subprocess` ni `pickle` en `backend/app` (búsqueda). Catálogo cerrado (`OPERATIONS` = `SUPPORTED_OPERATIONS`): `test_ai_catalog_matches_the_engine`. Operaciones fuera del catálogo rechazadas por el esquema: `test_operations_the_engine_cannot_run_cannot_reach_a_plan` |
| 26. Agotamiento de CPU y memoria (Pandas) | 🟡 | Hay límites de tamaño, celdas y concurrencia, y el cálculo corre fuera del bucle de eventos (`run_in_threadpool`). Medición: un CSV de 5 millones de celdas (14 MB) tardó 16,6 s y llegó a unos 165 MB de memoria medida por Python (el proceso usa más). No hay límites por cliente ni tiempo máximo por cálculo: un visitante puede ocupar el servidor y, con varias peticiones, una instancia chica (512 MB) puede quedarse sin memoria |
| 27. Riesgos de CSV/Excel y exportaciones | 🟡 | Ver detalle debajo de la tabla |
| 28. Privacidad y retención de datasets | 🟡 | Ver detalle debajo de la tabla |

**Detalle del control 21 (prompt injection):**
- **Lo que controla la persona:** el objetivo, los mensajes, los nombres de columna y el historial que envía la propia persona. Esa persona podría intentar manipular al modelo.
- **Mitigaciones:**
  - el modelo no tiene herramientas ni puede ejecutar nada;
  - la salida es estructurada (`AIAssistantReply`) y se valida (`validate_reply`: alias y columnas autorizados, operaciones del catálogo, columnas adecuadas, sin bloques de código);
  - el texto se muestra escapado;
  - cada visitante solo afecta su propia sesión, porque no hay contenido compartido entre visitantes.
- **Riesgo residual:** que el modelo devuelva texto engañoso o se use como chat general. Lo limitan las cuotas y la aprobación humana.
- **Pruebas:** `test_invalid_replies_are_discarded_and_no_plan_is_saved`, `test_impossible_visual_plans_are_discarded`.

**Detalle del control 23 (créditos y presupuesto):**
- **Protegido:**
  - presupuesto persistente en un archivo;
  - reserva del costo máximo antes de enviar, con lock;
  - sin reintentos;
  - un registro dañado bloquea en lugar de asumir cero (`test_unreadable_ledger_blocks_spending`).
- **Nadie puede superar el presupuesto, ni en paralelo:** `test_concurrent_requests_cannot_overspend_the_budget`.
- **Pero el presupuesto y la cuota son globales.** Script de auditoría: B gastó el presupuesto y A recibió 402; B agotó la cuota y A recibió 429.
- **En una plataforma con disco efímero o varias instancias,** el presupuesto se reinicia o se multiplica.

**Detalle del control 27 (riesgos de CSV/Excel y exportaciones):**
- Bombas zip y archivos malformados controlados (`test_hardening.py`).
- Las celdas se leen como valores de texto: nunca se evalúan fórmulas.
- La exportación real (PDF o CSV) **todavía no existe**. Cuando exista, hay que neutralizar la "inyección de fórmulas" en CSV: un valor que empieza con `=`, `+`, `-` o `@` se ejecutaría al abrirlo en Excel.

**Detalle del control 28 (privacidad y retención):**
- **Protegido:**
  - los archivos se procesan en memoria y no se guardan;
  - se le pide a OpenAI no conservar las respuestas (`store=False`);
  - el registro de consumo no tiene contenido;
  - a la IA nunca llegan valores.
- **Pendiente:**
  - aviso de privacidad para usuarios;
  - Starlette escribe en un temporal del disco las cargas de más de 1 MB mientras dura el pedido;
  - los registros de acceso guardan las rutas con identificadores;
  - el objetivo y los mensajes que escribe la persona sí llegan a OpenAI, cuya política para la API puede conservar datos un tiempo para control de abuso (verificar la política vigente).

---

## 2. Vulnerabilidades encontradas (para publicar en Internet)

| ID | Criticidad | Vulnerabilidad | Impacto | Evidencia |
|----|-----------|----------------|---------|-----------|
| V1 | **Crítica** | Sin autenticación: la API de IA y de análisis queda abierta a cualquiera | Cualquier script puede consumir los créditos de OpenAI y el servidor | Script de auditoría: pedidos sin `Origin` o con `Origin` falso aceptados |
| V2 | **Crítica** | Presupuesto, cuotas y límites de concurrencia globales, sin límite por cliente | Un solo visitante agota el presupuesto o la cuota y bloquea a todos (denegación de servicio económica) | Script de auditoría: 402 y 429 para el otro visitante |
| V3 | **Crítica** | Sin aislamiento entre visitantes: autorizaciones, conversaciones y planes sin dueño | Un identificador filtrado (por registros, capturas o URLs compartidas) da acceso a la sesión de otra persona | Script de auditoría: B usó la autorización, la conversación y el plan de A |
| V4 | **Alta** | Estado en memoria y presupuesto en un archivo local | En una plataforma con disco efímero el presupuesto se reinicia en cada despliegue; con varias instancias, cada una tiene su propio presupuesto y sus planes | `AIBudget(usage_file)`, `AIRequestStore`, `AIConversationStore` y `AIPlanStore` en memoria |
| V5 | **Alta** | Agotamiento de CPU y memoria | Pocos archivos grandes saturan una instancia chica | 16,6 s y unos 165 MB por archivo de 5 millones de celdas; sin límites por cliente ni tiempo máximo |
| V6 | **Alta** | Backend sin HTTPS y sin encabezados de seguridad | Datos y tokens en claro; sin CSP, HSTS ni protección contra enmarcado | Script de auditoría: ningún encabezado; `uvicorn` en HTTP |
| V7 | Media | `/docs` y `/openapi.json` públicos | Exponen el mapa completo de la API a un atacante | Script de auditoría: HTTP 200 |
| V8 | Media | Identificadores en las rutas, que quedan en los registros de acceso | Un token puede filtrarse por los registros de la plataforma | `POST /api/ai/conversations/{id}/messages`, `/api/ai/plans/{id}/approve` |
| V9 | Media | Sin aviso de privacidad ni política de retención; temporales en disco durante la carga | Incumplimiento de expectativas o normativa (Ley 25.326 de Protección de Datos Personales en Argentina) si se suben datos personales | Revisión de código y documentación |
| V10 | Baja | Dependencias de prueba vulnerables (`vitest`, `tinypool`) | Solo afectan el entorno de desarrollo y las pruebas | `npm audit`: 3; en producción: 0 |
| V11 | Baja | Sin Content-Security-Policy en Cloudflare Pages | Segunda barrera ausente; React ya escapa el contenido | Sin `public/_headers` |

**Fortalezas verificadas:**
- la clave nunca llega al navegador ni a Git;
- validación estricta de entradas, planes y respuestas de la IA;
- sin ejecución de código;
- el presupuesto no se puede superar;
- límites de archivos y "bombas zip" controlados;
- minimización de datos hacia la IA;
- dependencias de producción sin vulnerabilidades conocidas.

---

## 3. Correcciones imprescindibles antes del despliegue

En orden. **Bloquean** la publicación:

1. **Acceso para la beta (V1):**
   - un código de invitación por persona; el backend guarda solo su hash;
   - el código se canjea por un **token de sesión** aleatorio con vencimiento;
   - todos los endpoints `/api/ai/*` y `/api/analysis/*`, y el perfilado, exigen ese token (encabezado `Authorization: Bearer …`).
2. **Aislamiento (V3):**
   - cada solicitud preparada, permiso de conversación y plan se guarda con el `session_id` de su dueño;
   - todo endpoint verifica que pertenezca a la sesión, y si no, responde 404 sin revelar que existe.
3. **Cuotas por sesión y límite por IP (V2, V5):**
   - presupuesto y cantidad de solicitudes de IA por sesión, además del presupuesto global;
   - límite de frecuencia por sesión y por IP;
   - concurrencia por sesión;
   - límites de archivo más bajos en producción, por ejemplo 10 MB y 1 millón de celdas.
4. **Persistencia mínima (V4):** sesiones, códigos, presupuesto y cuotas en **SQLite sobre un volumen persistente**, con una sola instancia, o en una base gestionada. Además, un **límite de gasto del proyecto en OpenAI Platform**, como última barrera.
5. **HTTPS y encabezados (V6):**
   - el backend detrás del HTTPS de la plataforma;
   - un middleware con `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer` y CSP;
   - `public/_headers` en Cloudflare Pages con CSP (`connect-src` solo hacia el backend).
6. **Cerrar la exposición (V7):**
   - en producción, sin `/docs` ni `/openapi.json`;
   - `CORS_ORIGINS` solo con `https://datadecisionai.pages.dev`.
7. **Protección contra bots (V1, V2):** Cloudflare Turnstile en el canje del código de invitación. Es gratuito y lo verifica el backend.

**Recomendadas, no bloquean:**
- **V8:** sacar los identificadores de los registros de acceso, o desactivar el registro de rutas.
- **V9:** aviso de privacidad y la recomendación de no subir datos personales durante la beta.
- **V10:** actualizar `vitest`.
- **CSV:** neutralizar la inyección de fórmulas cuando exista la exportación.
- **Cálculo:** tiempo máximo por cálculo.

---

## 4. Arquitectura recomendada (la misma aplicación que en localhost)

```
Visitante ── HTTPS ──► Cloudflare Pages (frontend React: VITE_DEMO_MODE=false, VITE_API_BASE_URL=https://api…)
                          │  _headers: CSP, HSTS, nosniff, frame-ancestors 'none'
                          ▼
                 HTTPS (plataforma) ──► Backend FastAPI (1 contenedor, 1 instancia)
                                          ├─ Autenticación: código de invitación + Turnstile → token de sesión
                                          ├─ Middleware: sesión obligatoria, límites por IP y sesión, encabezados
                                          ├─ Stores con dueño (session_id): solicitudes, conversaciones, planes
                                          ├─ SQLite en volumen persistente: códigos (hash), sesiones,
                                          │   presupuesto global y por sesión, cuotas
                                          ├─ Pandas / NumPy / scikit-learn (archivos en memoria, límites menores)
                                          └─ OpenAI (clave en el gestor de secretos; límite de gasto del proyecto)
```

- **Frontend:** el mismo build, compilado con `VITE_DEMO_MODE=false` y la URL HTTPS del backend. La demo pública ficticia se reemplaza por la aplicación real con acceso por invitación.
- **Backend:** un contenedor con un volumen persistente en un servicio con HTTPS incluido. Una sola instancia hace que los almacenes en memoria de corta vida (autorizaciones de 5 minutos) sigan siendo válidos, y lo persistente va a SQLite. La clave de OpenAI se carga como **secreto de la plataforma**.
- **Sesión:** un token aleatorio de 256 bits, con vencimiento (por ejemplo, 8 horas), enviado en el encabezado `Authorization`.
  - **Por qué no una cookie:** `pages.dev` y el dominio del backend son sitios distintos, y los navegadores restringen cada vez más las cookies entre sitios.
  - **Dónde se guarda:** en la memoria de la pestaña o en `sessionStorage`. La CSP reduce el riesgo de que un script lo robe.
- **Cuotas de ejemplo para la beta:**
  - USD 0,05 y 20 consultas de IA por sesión y por día;
  - presupuesto global de USD 1–5;
  - 30 pedidos por minuto por IP;
  - 1 análisis simultáneo por sesión.
- **Datos personales:**
  - aviso de privacidad (qué se procesa, que no se guarda, que a OpenAI solo van metadatos y textos escritos por la persona);
  - recomendación de no subir datos personales en la beta;
  - registros sin contenido ni identificadores.
- **Evitar en esta etapa:** registro abierto de usuarios, pagos, roles, varias instancias y bases de datos empresariales.

---

## 5. Guía de estudio para defender la ciberseguridad

### Conceptos clave y cómo aparecen en el proyecto

- **Confidencialidad, integridad y disponibilidad (CIA):**
  - **Confidencialidad:** la clave solo en el backend; la minimización de datos hacia la IA.
  - **Integridad:** la huella SHA-256 del contenido aprobado; los planes tomados del servidor, no del navegador.
  - **Disponibilidad:** límites de archivos y concurrencia (y lo que falta: cuotas por visitante, V2).
- **Autenticación frente a autorización:**
  - la autenticación responde *quién sos* (hoy no existe: V1);
  - la autorización responde *qué podés hacer con este recurso* (hoy, quien tiene el identificador puede usarlo: V3).
  - El control de `Origin` no es ninguna de las dos: un cliente que no es un navegador puede omitirlo o falsificarlo.
- **Tokens al portador ("capability tokens"):** un identificador aleatorio de 128 bits no se puede adivinar, pero si se filtra da acceso. Por eso se ata a una sesión (dueño).
- **Defensa en profundidad:**
  - validación en el frontend, en el backend, en el esquema de la IA y otra vez antes de ejecutar;
  - presupuesto interno más el límite del proyecto en OpenAI.
- **Mínimo privilegio y minimización:** la IA recibe solo metadatos autorizados, nunca filas; el motor ejecuta solo un catálogo cerrado.
- **Lista blanca frente a lista negra:** `extra="forbid"` rechaza todo lo no previsto, en lugar de intentar filtrar lo peligroso.

### Riesgos de aplicaciones con modelos de lenguaje (OWASP Top 10 for LLM Applications, 2025)

| Riesgo | Cómo lo trata el proyecto |
|--------|---------------------------|
| **LLM01 Prompt Injection** | Salida estructurada, validación, catálogo cerrado, sin herramientas |
| **LLM02 Sensitive Information Disclosure** | Lista blanca: sin valores ni archivos hacia la IA |
| **LLM05 Improper Output Handling** | La respuesta nunca se ejecuta; se valida y se muestra escapada |
| **LLM06 Excessive Agency** | El modelo no puede actuar: solo propone, y la persona aprueba |
| **LLM10 Unbounded Consumption** | Límites de tokens, presupuesto con reserva y sin reintentos; falta hacerlos por visitante (V2) |

### Cómo demostrarlo ante el profesor

1. **Pruebas automatizadas:** `python -m pytest` en `backend` (209) y `npm test` en `frontend` (173). Mostrar las que prueban seguridad:
   - `test_hardening.py`;
   - `test_ai_gateway.py` (lista blanca, uso único, vencimiento);
   - `test_ai_conversation.py` (permisos, concurrencia, presupuesto);
   - `test_visual_analyses.py` (validación de planes).
2. **Auditoría de dependencias:** `pip-audit` sin hallazgos y `npm audit --omit=dev` con 0.
3. **Historial de Git sin secretos:** `git log --all -p` no contiene claves; solo se versionaron los `.env.example`.
4. **Explicar con honestidad lo que falta** (V1–V3) y por qué se resuelve con sesión, dueño y cuotas por sesión antes de publicar. Una auditoría que reconoce sus límites es más creíble que una que afirma "es seguro".

---

## 6. Correcciones aplicadas para la beta pública

**Estado:** implementadas y verificadas localmente (cambios sin confirmar, **sin despliegue público**). Todas las pruebas usan proveedores falsos y la red externa bloqueada: ninguna llama a OpenAI ni a Cloudflare.
- **Pruebas:** backend **260 de 260** (210 anteriores, adaptadas, más 50 nuevas en `tests/test_security.py`) y frontend **187 de 187** (10 nuevas en `src/test/access.test.tsx` y 4 en `src/lib/buildChecks.test.ts`).
- **Calidad:** lint, typecheck y build sin errores; `npm audit --omit=dev` con 0 vulnerabilidades.
- **En el navegador:** ingreso con un código inválido y con uno válido, perfilado con sesión y cierre de sesión (ver [PRUEBAS_Y_VALIDACIONES.md](PRUEBAS_Y_VALIDACIONES.md), sección 28).

### Qué cambió en la arquitectura

```
Visitante ─ HTTPS ─► Cloudflare Pages (React)   _headers: CSP, HSTS, nosniff, DENY
   │  código de invitación + Turnstile
   ▼
Backend FastAPI (1 instancia). Middlewares, de afuera hacia adentro:
   CORS → encabezados de seguridad → límite por IP → Origin + SESIÓN + tamaño (antes de leer el cuerpo)
   ├─ /api/auth/redeem: intentos por IP → Turnstile (en el backend) → código (hash) → token de sesión
   ├─ require_user en /api/datasets, /api/ai y /api/analysis (sin ningún modo de omitirlo)
   ├─ En memoria, CON DUEÑO: solicitudes (5 min), conversaciones (30 min) y planes (6 h)
   ├─ SQLite (disco persistente): invitaciones y sesiones (solo hashes), consumo y reservas de la IA
   └─ OpenAI: reserva (global + cuota del visitante + 1 consulta en curso) → envío → liquidación
```

### Control por control

| Control | Amenaza | Archivo · función | Prueba | Limitación restante |
|---------|---------|-------------------|--------|---------------------|
| **Acceso por invitación** (V1) | Cualquiera usa la API y gasta los créditos | `app/services/auth.py` · `AuthService.create_invitation`, `redeem`, `authenticate`, `revoke_invitation`, `logout`; `app/cli.py` (crear, listar, revocar) | `test_redeem_flow_with_generic_errors_and_no_secrets_stored`, `test_cli_creates_lists_and_revokes_invitations` | Un código filtrado sirve hasta que se revoca: entregarlo por un canal privado. Sin registro público, pagos ni roles (fuera de alcance) |
| **Sesión obligatoria** en datos, IA y análisis (V1) | Endpoints abiertos; el control de `Origin` no autentica | `app/api/deps.py` · `require_user`; `app/core/upload_guard.py` · `authenticate` (rechaza **antes de leer** el archivo) | `test_unauthenticated_requests_are_rejected` (9 rutas), `test_uploads_and_executions_without_session_are_rejected_before_reading_the_body`, `test_invalid_tokens_are_rejected` | `/api/health` y `/api/auth/config` son públicos a propósito (sin datos) |
| **Vencimiento y revocación** | Un token robado sirve para siempre | `AuthService.authenticate` (sesión e invitación vigentes y no revocadas); `SESSION_TTL_HOURS` = 12; `MAX_SESSIONS_PER_INVITATION` = 3 | `test_expired_session_is_rejected`, `test_expired_or_revoked_invitation_closes_its_sessions`, `test_logout_revokes_the_token`, `test_a_code_cannot_open_unlimited_sessions` | El vencimiento usa el reloj del servidor |
| **Códigos y tokens guardados de forma segura** | Una copia de la base permitiría entrar | `hash_secret` (SHA-256): la base guarda solo huellas; códigos de 144 bits y tokens de 256 bits (`secrets`) | `test_redeem_flow_with_generic_errors_and_no_secrets_stored` (lee el archivo de la base) | SHA-256 sin sal alcanza porque los valores son aleatorios y largos (no son contraseñas elegidas por personas) |
| **Token en el navegador** | Robo del token | `frontend/src/services/accessSession.ts` (`sessionStorage`, nunca `localStorage` ni cookies; se borra al vencer, ante un 401 y al cerrar la pestaña); `httpClient.ts` agrega `Authorization` | `access.test.tsx`: «agrega Authorization solo con una sesión…», «un 401 del backend cierra la sesión local» | Un XSS podría leerlo; lo mitigan React (escapa todo) y la CSP |
| **Turnstile en el canje** (bots) | Fuerza bruta automatizada de códigos | `CloudflareTurnstile.verify` (valida en el backend que la acción sea exactamente `redeem` y el nombre de host esperado; ante cualquier error, rechaza); `frontend/src/components/auth/TurnstileWidget.tsx` | `test_turnstile_is_validated_in_the_backend`, `test_cloudflare_turnstile_verifier_fails_closed` | Sin clave, en desarrollo y pruebas se omite (`DevelopmentTurnstile`); en producción la app **no arranca** sin la clave secreta ni sin `TURNSTILE_EXPECTED_HOSTNAME` |
| **Límites por IP** | Fuerza bruta y saturación | `app/core/rate_limit.py` · `RateLimiter`, `RateLimitMiddleware` (120 pedidos por minuto por IP); 10 canjes cada 15 minutos por IP | `test_redeem_attempts_are_limited_per_ip`, `test_general_rate_limit_per_ip` | En memoria: vale para una instancia. Muchas IP reales distintas lo esquivan; de ahí Turnstile y las cuotas |
| **Proxies de confianza** | Falsificar `X-Forwarded-For` para cambiar de IP en cada pedido | `client_ip(scope, trusted_hops)`: toma la entrada que agregó el proxy propio (`FORWARDED_IP_HOPS`, n-ésima desde la derecha), nunca la primera; uvicorn con `--no-proxy-headers`; producción exige `FORWARDED_IP_HOPS ≥ 1` | `test_a_forged_forwarded_for_header_does_not_bypass_the_ip_limit` | Si se agrega otro proxy delante (por ejemplo, Cloudflare con proxy), hay que subir el valor; si es mayor que la cantidad real de proxies, el visitante vuelve a controlar la IP |
| **HTTPS obligatorio** | Tokens y datos en claro | `HTTPSOnlyMiddleware` (`app/core/security_headers.py`): en producción, 403 si `X-Forwarded-Proto` no es `https` (salvo `/api/health`); HSTS | `test_production_requires_https` | El cifrado lo hace el proxy de la plataforma; entre el proxy y el contenedor viaja por la red interna de la plataforma |
| **Aislamiento entre visitantes** (V3) | B usa la autorización, la conversación o el plan de A | `app/services/ai_gateway.py` · `AIRequestStore`, `AIConversationStore` y `AIPlanStore` con `owner` (`consume`, `use`, `get`, `approve`, `cancel`, `revoke`); `analysis.approved_plans(…, owner)`. Un recurso ajeno responde **404**, igual que uno inexistente | `test_visitors_cannot_use_each_others_authorizations_conversations_or_plans`, `test_pending_requests_are_limited_per_visitor` | El dueño es la invitación: dos personas con el mismo código comparten recursos y cuotas |
| **Cuotas por visitante y presupuesto global** (V2) | Un visitante agota el presupuesto de todos | `app/services/ai_budget.py` · `AIBudget.reserve` (por defecto, cuota del visitante de USD 0,10 y 15 consultas por día; global de USD 1 y 150 consultas por día) | `test_daily_quota_is_per_visitor`, `test_user_budget_and_global_budget_are_enforced`, `test_global_daily_request_limit` | El presupuesto global es compartido: muchos visitantes legítimos pueden agotarlo (es el tope de gasto buscado) |
| **Concurrencia** (V2, V5) | Envíos paralelos para gastar de más o saturar | Una consulta a la IA en curso por visitante (reserva abierta: 409); `ConcurrencyGate` (`app/api/deps.py`): perfilado 2 en total y 1 por visitante; ejecución 1 | `test_one_ai_request_in_flight_per_visitor`, `test_concurrent_requests_cannot_overspend_the_budget` (6 visitantes en paralelo), `test_profiling_concurrency_is_limited_per_visitor` | No hay tiempo máximo por cálculo de Pandas |
| **Registro de consumo persistente** (V4) | Un reinicio o redespliegue borra el gasto | Tablas `ai_usage` y `ai_reservations` (`app/services/database.py`) con transacciones `BEGIN IMMEDIATE`; una reserva abandonada se cobra por su máximo; `import_legacy_ledger` importa una sola vez el JSON anterior | `test_sessions_invitations_and_spending_survive_a_restart`, `test_budget_persists_across_restarts`, `test_abandoned_reservation_is_charged_at_its_maximum`, `test_previous_json_ledger_is_imported_once_and_an_unreadable_one_blocks_startup` | Solo es persistente si la base está en un **disco persistente** (ver la configuración) |
| **Denegar si no se puede verificar** | Gastar sin control si la base falla | `AIBudget.reserve` responde 503 ante un error de SQLite; `status` informa 0 disponible | `test_unverifiable_budget_denies_sending` | — |
| **Persistencia mínima, sin datasets** | Guardar datos de los visitantes | SQLite guarda invitaciones, sesiones y consumo, sin contenido. Solicitudes, conversaciones y planes quedan **en memoria**, con vencimiento; los archivos se procesan en memoria | `test_real_usage_is_recorded_without_content` (el archivo de la base no contiene el objetivo ni las columnas) | Un reinicio borra los planes y conversaciones en curso (el visitante vuelve a pedir la propuesta) |
| **Archivos, CPU y memoria** (V5) | Pocos archivos grandes saturan la instancia | `MAX_UPLOAD_MB` y `MAX_DATASET_CELLS` configurables (`read_dataset(max_bytes, max_cells)`), más bajos en la beta | `test_upload_limits_are_configurable` | Sin tiempo máximo por cálculo; la memoria total depende de la instancia |
| **HTTPS y encabezados** (V6, V11) | Robo de tokens en tránsito, enmarcado, scripts ajenos | `app/core/security_headers.py` · `SecurityHeadersMiddleware` (CSP `default-src 'none'`, nosniff, DENY, no-referrer, `no-store`; HSTS en producción); `frontend/src/lib/securityHeaders.ts` genera `dist/_headers` con CSP (`connect-src` solo hacia el backend) | `test_security_headers_in_every_response`, `test_production_hides_docs_and_sends_security_headers`; `access.test.tsx`: «solo permite conectarse al propio sitio y al backend configurado» | El HTTPS lo dan Cloudflare Pages y la plataforma del backend; `style-src` admite estilos en línea (Recharts) |
| **CORS restringido** (no es autenticación) | Que otro sitio lea las respuestas | `CORS_ORIGINS` solo `https://` en producción; encabezados permitidos: `Authorization` y `Content-Type` | `test_production_hides_docs_and_sends_security_headers` (un origen ajeno no recibe permiso), `test_insecure_production_configuration_does_not_start` | — |
| **`/docs` y `/openapi.json`** (V7) | Mapa de la API para un atacante | `create_app`: `docs_url`, `redoc_url` y `openapi_url` en `None` en producción | `test_production_hides_docs_and_sends_security_headers` | Siguen disponibles en desarrollo |
| **Registros sin secretos** (V8) | Tokens o identificadores en los registros | Uvicorn no registra encabezados (el token viaja en `Authorization`); `RedactIdentifiersFilter` oculta identificadores y consultas de las rutas; ningún `logger` recibe códigos ni tokens | `test_identifiers_and_queries_are_redacted_from_access_logs` | Los registros del proxy de la plataforma pueden guardar la ruta completa |
| **Producción a prueba de descuidos** | Publicar sin protecciones | `validate_for_startup` (`app/core/config.py`): sin `TURNSTILE_SECRET_KEY` o `TURNSTILE_EXPECTED_HOSTNAME`, con `CORS_ORIGINS` no https, sin `FORWARDED_IP_HOPS`, sin `PERSISTENT_STORAGE_CONFIRMED=true`, con una ruta relativa o con la carpeta de la base inexistente (disco no montado; en producción no se crea), **no arranca**. En Render (variable `RENDER`) exige `ENVIRONMENT=production`. Un entorno desconocido es un error | `test_insecure_production_configuration_does_not_start` (6 casos), `test_production_does_not_create_a_missing_database_folder`, `test_render_without_production_environment_does_not_start`, `test_unknown_environment_is_a_configuration_error` | No puede comprobar que el disco sea realmente persistente: lo confirma quien despliega |
| **Sin DEMO accidental en la versión pública** | Publicar resultados ficticios o una app sin protección real | `frontend/src/lib/buildChecks.ts` · `publicBuildProblems`, usado por `vite.config.ts`: en Cloudflare Pages la compilación falla si `VITE_DEMO_MODE` no es `false`, si el backend no es `https://` o es localhost, o si falta la clave de Turnstile; toda compilación exige definir `VITE_DEMO_MODE` | `buildChecks.test.ts`; compilación simulada con `CF_PAGES=1 VITE_DEMO_MODE=true`: falla | Fuera de Cloudflare Pages se puede compilar la demo de forma explícita |
| **Pruebas aisladas de la configuración real** | Que una prueba use la clave o la base reales | `tests/conftest.py`: no lee `backend/.env`; IA deshabilitada, clave vacía y base temporal; `no_network` bloquea toda conexión externa. En el frontend, `fetch` está bloqueado | Todas | — |
| **Aviso de privacidad** (V9) | Expectativas incorrectas sobre los datos | Pantalla de ingreso (`AccessGate.tsx`): no cargar datos personales; archivos en memoria; a OpenAI solo el objetivo y los metadatos autorizados | `access.test.tsx`: «sin sesión pide el código…» | Falta una política de privacidad formal (Ley 25.326) |
| **XSS** | Ejecutar scripts en el navegador del visitante | React escapa todo el texto (incluida la IA); sin `dangerouslySetInnerHTML`, `innerHTML` ni `eval`; CSP como segunda barrera | Búsqueda en `frontend/src` sin coincidencias | — |

### Vulnerabilidades: estado actual

| ID | Estado | Cómo se resolvió |
|----|--------|------------------|
| V1 Sin autenticación | ✅ Corregida | Invitación + Turnstile + token de sesión obligatorio |
| V2 Presupuesto y cuotas globales | ✅ Corregida | Cuotas por visitante, tope global, una consulta en curso por visitante y límite por IP |
| V3 Sin aislamiento | ✅ Corregida | Dueño en solicitudes, conversaciones y planes (404 para los demás) |
| V4 Estado y presupuesto efímeros | ✅ Corregida, **si** la base está en un disco persistente (la producción no arranca sin confirmarlo) | SQLite con transacciones; reservas abandonadas cobradas |
| V5 CPU y memoria | 🟡 Mitigada | Límites configurables y concurrencia por visitante; **falta** un tiempo máximo por cálculo |
| V6 HTTPS y encabezados | ✅ Corregida en el código | Encabezados y HSTS; el HTTPS depende de la plataforma |
| V7 `/docs` público | ✅ Corregida | Deshabilitado en producción |
| V8 Identificadores en registros | 🟡 Mitigada | Filtro en los registros de uvicorn; los del proxy de la plataforma no se controlan |
| V9 Privacidad | 🟡 Mitigada | Aviso en el ingreso; falta una política formal y la retención por escrito |
| V10 Dependencias de prueba | ⏳ Pendiente | `vitest` sin actualizar (no llega a producción) |
| V11 CSP en Pages | ✅ Corregida | `dist/_headers` generado al compilar |

### Pendiente (no bloquea una beta cerrada con pocos invitados)

- **Tiempo máximo por cálculo** de Pandas (hoy solo se limitan el tamaño y la concurrencia).
- **Varias instancias:** los límites por IP y los almacenes en memoria suponen **una sola instancia** del backend. Escalar exige Redis o una base compartida.
- **Política de privacidad formal** y procedimiento de borrado.
- Actualizar `vitest` (V10) y neutralizar la inyección de fórmulas cuando exista la exportación a CSV.
- Configurar el **límite de gasto del proyecto en OpenAI Platform**: es la última barrera y no se puede verificar desde el código.

### Configuración de despliegue

Paso a paso en [DEPLOYMENT.md](DEPLOYMENT.md), sección C.

**Backend (FastAPI, una instancia, disco persistente):**

| Variable | Valor en producción |
|----------|---------------------|
| `ENVIRONMENT` | `production` |
| `FORWARDED_IP_HOPS` | `1` (el proxy HTTPS de la plataforma) |
| `DATABASE_URL` | `sqlite:////var/data/datadecision.db` (ruta absoluta **en el disco persistente**) |
| `PERSISTENT_STORAGE_CONFIRMED` | `true`, solo si esa ruta sobrevive a reinicios y redespliegues |
| `CORS_ORIGINS` | `https://datadecisionai.pages.dev` |
| `TURNSTILE_SECRET_KEY` | clave secreta de Turnstile (gestor de secretos de la plataforma) |
| `TURNSTILE_EXPECTED_HOSTNAME` | `datadecisionai.pages.dev` |
| `OPENAI_API_KEY` | gestor de secretos de la plataforma; nunca en un archivo versionado |
| `AI_ENABLED` | `true` |
| `AI_BUDGET_USD`, `AI_USER_BUDGET_USD`, `AI_USER_DAILY_REQUESTS`, `AI_GLOBAL_DAILY_REQUESTS` | por ejemplo `2`, `0.10`, `15` y `150` |
| `MAX_UPLOAD_MB`, `MAX_DATASET_CELLS` | `10` y `1000000` |
| Comando de inicio | `uvicorn app.main:app --host 0.0.0.0 --port $PORT --workers 1 --no-proxy-headers` |
| Invitaciones | `python -m app.cli invite --label "…" --days 14`, desde la consola del servidor |

**Frontend (Cloudflare Pages):** `VITE_DEMO_MODE=false`, `VITE_API_BASE_URL=https://<backend>` y `VITE_TURNSTILE_SITE_KEY=<clave del sitio>` (es pública). La build genera `dist/_headers` con la CSP apuntando a ese backend y se corta si la configuración dejaría la versión pública en DEMO.
