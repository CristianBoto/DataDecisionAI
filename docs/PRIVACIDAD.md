# Privacidad y control de los envíos a la IA

DataDecision AI separa tres cosas que nunca se mezclan:

| Parte | Dónde corre | Qué ve |
|-------|-------------|--------|
| **Procesamiento** (Python y Pandas) | Backend de DataDecision AI | Los archivos completos, en memoria, solo durante el pedido |
| **IA externa** (OpenAI) | Servicio de OpenAI | Solo lo que la persona autoriza en cada envío: metadatos y resultados agregados, nunca archivos ni filas |
| **Almacenamiento y exportación** | SQLite (sesiones y consumo) y el navegador (PDF) | Sin datasets, objetivos ni resultados guardados |

## Versión pública y versión local

**Versión pública** (frontend en Cloudflare Pages, backend en Render):
- Los archivos **se envían al servidor** para procesarse. No quedan solo en la computadora de la persona.
- Se procesan en memoria y no se guardan. Los logs no registran contenido (solo archivo, línea y función de un error).
- Hay límites de tamaño, filas, celdas, tiempo y una tarea pesada por vez.
- La pantalla de carga muestra el aviso **«Versión pública: no cargues datos confidenciales»**. No es un entorno empresarial aislado.

**Instalación local** (React, FastAPI y Pandas en la infraestructura propia, ver la guía del [README](../README.md#instalación-local-windows-powershell)):
- La pantalla de carga lo indica: «Los archivos se procesan en el backend de esta instalación».
- La IA externa sigue siendo opcional y se usa solo con autorización.
- **Lo que todavía falta** para datos empresariales confidenciales: roles, auditoría por usuario, cifrado en reposo, políticas de retención y un proveedor de IA local. No se debe afirmar aislamiento completo.

## Autorización explícita antes de cada envío

No hay envíos silenciosos. Cada envío a la IA pasa por un panel que muestra:

| Pregunta | Conversación con el asistente | Interpretación de resultados |
|----------|-------------------------------|------------------------------|
| **Qué se envía** | El objetivo, el mensaje, los últimos turnos y los nombres de las columnas compartidas con su tipo, unidad y rango de valores distintos | El objetivo **interpretado y aprobado** (no todo el pedido original), y los resultados agregados de Pandas con sus unidades y advertencias |
| **Qué nunca se envía** | Archivos, filas, valores de celdas, nombres de archivo y ejemplos | Archivos, filas originales, nombres de archivo y puntos de dispersión o ROC |
| **Qué podría ser confidencial** | Los nombres de columnas (se listan, con cómo renombrarlas u ocultarlas) | Las categorías, períodos y cifras de los resultados, que no se anonimizan; los posibles nombres de personas se destacan |
| **Para qué** | Proponer un plan con operaciones del catálogo | Redactar una interpretación verificada orientada a decisiones |
| **Si no se autoriza** | No se envía nada; queda el «Análisis descriptivo sin IA» | No se envía nada; resultados, resumen descriptivo, gráficos y PDF siguen disponibles |
| **Costo** | Costo máximo estimado y presupuesto disponible | Costo máximo estimado y tokens |

El contenido exacto (JSON) está siempre disponible en «Ver detalles técnicos». La autorización es de uso único y está atada a la huella SHA-256 de ese contenido.

## Análisis sin IA

- **Exploración:** el diagnóstico de calidad y las estadísticas descriptivas se calculan con Pandas al cargar el archivo, sin IA.
- **«Análisis descriptivo sin IA»:** un plan armado con reglas en el backend (`app/services/descriptive_plan.py`) a partir de los metadatos revisados: registros, totales, promedios, medianas, desvíos, evolución, comparación y distribución. Pasa por la misma validación que los planes de la IA y se aprueba, confirma y ejecuta igual. No llama a ningún proveedor ni consume presupuesto.
- **Informe:** el resumen descriptivo y el PDF no necesitan la IA.

## Proveedor de IA

`AI_PROVIDER` en `backend/.env` elige el proveedor:

| Valor | Estado |
|-------|--------|
| `openai` (predeterminado) | Integrado: Responses API con salida estructurada, `store=False`, sin reintentos y con presupuesto |
| `ollama` | **Preparado, no integrado.** La IA queda sin envíos (el asistente lo informa) |

Para integrar un modelo local, implementar `send` e `interpret` en `LocalModelPlaceholder` (`app/services/ai_gateway.py`) con la **misma salida estructurada** (`AIAssistantReply`, `AIInterpretation`). La respuesta pasa por las mismas validaciones (`validate_reply`, `prune_reply`, `verify_interpretation`): un modelo local no se salta ningún control.
