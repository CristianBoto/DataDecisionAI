/**
 * ¿El plan cubre lo que la persona pidió? Comprobación LOCAL y conservadora (sin IA).
 *
 * Solo detecta pedidos explícitos y fáciles de reconocer:
 * - columnas que la persona nombró (con el nombre que comparte con la IA) y que ningún plan usa;
 * - tipos de análisis pedidos con palabras claras («evolución», «distribución», «relación entre»,
 *   «promedio», «comparar», «curva ROC») sin ninguna operación que los calcule;
 * - pedidos que el MVP no puede responder (causas, pronósticos, unir archivos).
 *
 * Es preferible no advertir a advertir de más: ante la duda, no se informa nada. No bloquea la
 * confirmación: muestra el aviso y ofrece volver al asistente.
 */

import { sharedName, type SourceReview } from '@/lib/aiContext'
import type { DatasetCatalog } from '@/lib/datasetCatalog'

export interface PlanOperationLike {
  operation: string
  columns: string[]
  group_by: string[]
}

export interface CoverageGap {
  /** Qué parte del pedido falta, en palabras de la persona («Evolución en el tiempo», «la columna canal»). */
  label: string
  /** Por qué se considera no cubierta. */
  detail: string
}

export interface PlanCoverage {
  /** Partes del pedido que ningún plan (u operación calculada) responde. */
  missing: CoverageGap[]
  /** Conclusiones que DataDecision AI no puede obtener con su catálogo actual. */
  notObtainable: CoverageGap[]
}

export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[_\-.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const stem = (word: string) => (word.length > 4 ? word.replace(/(es|s)$/, '') : word)

function words(text: string): string[] {
  return normalize(text).split(/[^a-z0-9ñ]+/).filter(Boolean).map(stem)
}

/** Palabras demasiado genéricas para indicar, por sí solas, una columna. */
const GENERIC = new Set(['dato', 'valor', 'total', 'tipo', 'numero', 'cantidad', 'nombre', 'codigo', 'general', 'otro'])

function mentions(request: string[], column: string): boolean {
  const name = words(column)
  if (name.length === 0) return false
  // Nombre completo («monto ars») o una palabra distintiva del nombre («monto»), como palabra entera.
  const joined = ` ${request.join(' ')} `
  if (joined.includes(` ${name.join(' ')} `)) return true
  return name.some((w) => w.length >= 5 && !GENERIC.has(w) && request.includes(w))
}

const TEMPORAL_NAME = /\b(fecha|ano|anio|mes|periodo|trimestre|semestre|dia|year|date|month)\b/

interface Intent {
  label: string
  pattern: RegExp
  covered: (ops: PlanOperationLike[]) => boolean
  detail: string
}

const has = (ops: PlanOperationLike[], ...names: string[]) => ops.some((o) => names.includes(o.operation))

const INTENTS: Intent[] = [
  {
    label: 'Evolución en el tiempo',
    pattern: /\b(evolucion|tendencia|a lo largo del tiempo|en el tiempo|mensual(es)?|anual(es)?|trimestral(es)?|por mes|por ano|por anio|por trimestre|mes a mes|ano a ano|historic[oa]s?|crecimiento|como (crecio|cayo|vario))\b/,
    covered: (ops) =>
      has(ops, 'time_series') || ops.some((o) => [...o.group_by, ...o.columns].some((c) => TEMPORAL_NAME.test(normalize(c)))),
    detail: 'Pediste ver cómo cambia en el tiempo, pero ningún plan agrupa por una fecha o período.',
  },
  {
    label: 'Distribución de los valores',
    pattern: /\b(distribucion|distribuyen|distribuye|histograma|rangos? de valores)\b/,
    covered: (ops) => has(ops, 'histogram'),
    detail: 'Pediste ver cómo se distribuyen los valores, pero ningún plan incluye un histograma.',
  },
  {
    label: 'Relación entre dos variables',
    pattern: /\b(relacion entre|relacion con|correlacion|correlaciona|asociacion entre|se relaciona)\b/,
    covered: (ops) => has(ops, 'scatter'),
    detail: 'Pediste ver la relación entre dos medidas, pero ningún plan calcula una correlación.',
  },
  {
    label: 'Promedios',
    pattern: /\b(promedio|promedios|media|en promedio|mediana)\b/,
    covered: (ops) => has(ops, 'mean', 'median'),
    detail: 'Pediste un promedio, pero ningún plan calcula promedios ni medianas.',
  },
  {
    label: 'Comparación entre grupos',
    pattern: /\b(comparar|compara|comparacion|ranking|participacion|porcentaje del total)\b/,
    covered: (ops) => has(ops, 'compare_groups', 'group_by', 'frequency') || ops.some((o) => o.group_by.length > 0),
    detail: 'Pediste comparar grupos, pero ningún plan separa los resultados por categoría.',
  },
  {
    label: 'Evaluación de un clasificador',
    pattern: /\b(roc|auc|clasificador|sensibilidad|especificidad)\b/,
    covered: (ops) => has(ops, 'roc_curve'),
    detail: 'Pediste evaluar un clasificador, pero ningún plan incluye la curva ROC.',
  },
]

const NOT_OBTAINABLE: { label: string; pattern: RegExp; detail: string }[] = [
  {
    label: 'Causas o motivos',
    pattern: /\b(por que|causa|causas|motivo|motivos|razon|razones|a que se debe)\b/,
    detail: 'Los cálculos describen qué pasó y cuánto; no pueden demostrar por qué pasó.',
  },
  {
    label: 'Pronósticos o proyecciones',
    pattern: /\b(predec\w*|predic\w*|pronostic\w*|proyecc\w*|proyectar|a futuro|el futuro|proximo (mes|ano|anio|trimestre|semestre)|proximos (meses|anos))\b/,
    detail: 'El catálogo de análisis no incluye modelos predictivos: no se calculan valores futuros.',
  },
  {
    label: 'Unir o cruzar archivos',
    pattern: /\b(cruzar|unir|combinar|juntar|vincular) (los |las |ambos |ambas )?(archivos|fuentes|tablas|planillas)\b/,
    detail: 'Cada plan usa una sola fuente: los archivos no se unen ni se relacionan entre sí.',
  },
]

/** Columna con la información que hace falta para las reglas que dependen del tipo o del signo. */
export interface CoverageColumn {
  name: string
  semanticType?: string | null
  /** Signo de los valores de una medida (del perfil): con «mixed», una suma es neta. */
  valueSign?: 'positive' | 'negative' | 'mixed' | null
}

/**
 * Pedidos sobre un TIPO de columna (personas, categorías). Se reconocen por vocabulario general en el
 * pedido y en los NOMBRES de columna (nunca por los valores ni por un nombre propio).
 */
interface EntityIntent {
  label: string
  request: RegExp
  columnWords: Set<string>
  example: string
}

const ENTITY_INTENTS: EntityIntent[] = [
  {
    label: 'Separar por persona o entidad',
    request: /\b(persona|personas|cliente|clientes|proveedor|proveedores|contraparte|contrapartes|beneficiario|beneficiarios|destinatario|destinatarios|empleado|empleados|usuario|usuarios|titular|titulares|alumno|alumnos|paciente|pacientes)\b/,
    columnWords: new Set(['persona', 'nombre', 'cliente', 'contraparte', 'proveedor', 'beneficiario', 'destinatario', 'titular', 'empleado', 'usuario', 'responsable', 'contacto', 'socio', 'alumno', 'paciente', 'comercio']),
    example: 'nombre, cliente o contraparte',
  },
  {
    label: 'Separar por categoría',
    request: /\b(categoria|categorias|rubro|rubros|tipo de gasto|tipos de gasto|concepto|conceptos)\b/,
    // Sin «tipo» ni «grupo»: «tipo de pago» o «grupo etario» no son categorías de gasto.
    columnWords: new Set(['categoria', 'rubro', 'concepto', 'clase', 'segmento', 'familia']),
    example: 'categoría, rubro o concepto',
  },
]

/** La columna parece identificar personas o entidades (por su NOMBRE, con vocabulario general). */
export function looksLikePersonColumn(name: string): boolean {
  return [...words(name)].some((w) => ENTITY_INTENTS[0].columnWords.has(w))
}

const COUNT_REQUEST = /\b(cuant[oa]s (?!pesos|dolares|euros|usd|ars|veces mas)[a-z]+|numero de [a-z]+|cantidad de (transacciones|movimientos|operaciones|registros|compras|ventas|casos|pedidos|filas))\b/
const FLOW_REQUEST = /\b(gast\w*|egres\w*|ingres\w*|cobr\w*|pague|pagos?|ganancias?|ingrese)\b/

/** Pedido sobre un caso concreto (no sobre todos los grupos). */
const SPECIFIC_REQUEST = /\b(especific[oa]s?|en particular|determinad[oa]s?|concret[oa]s?|individual(es)?|por separado)\b/

const columnWords = (name: string) => new Set(words(name))
const isTemporal = (c: CoverageColumn) => c.semanticType === 'temporal' || TEMPORAL_NAME.test(normalize(c.name))

/**
 * `requests`: el objetivo y lo que la persona pidió en la conversación. `columns`: las columnas que la
 * IA conoce (con su tipo y signo si se conocen). `operations`: las de los planes aprobados (o las calculadas).
 */
export function planCoverage(requests: string[], columns: (string | CoverageColumn)[], operations: PlanOperationLike[]): PlanCoverage {
  const text = normalize(requests.join(' \n '))
  const tokens = words(text)
  const info = [...new Map(columns.map((c) => (typeof c === 'string' ? { name: c } : c)).map((c) => [c.name, c])).values()]
  const used = new Set(operations.flatMap((o) => [...o.columns, ...o.group_by]).map(normalize))
  const missing: CoverageGap[] = []
  const notObtainable: CoverageGap[] = []

  for (const { name } of info) {
    if (!used.has(normalize(name)) && mentions(tokens, name)) {
      missing.push({ label: `La columna «${name}»`, detail: 'La mencionaste, pero ningún plan la usa.' })
    }
  }
  const mentioned = new Set(missing.map((m) => m.label))

  if (COUNT_REQUEST.test(text) && !has(operations, 'count', 'frequency', 'distinct_count')) {
    missing.push({ label: 'Cantidad de registros', detail: 'Pediste cuántos hay, pero ningún plan cuenta registros.' })
  }
  for (const intent of INTENTS) {
    if (!intent.pattern.test(text) || intent.covered(operations)) continue
    if (intent.label === 'Evolución en el tiempo' && info.length > 0 && !info.some(isTemporal)) {
      notObtainable.push({
        label: 'Falta información: fecha o período',
        detail: 'Pediste ver cómo cambia en el tiempo, pero ninguna columna compartida es una fecha o un período.',
      })
      continue
    }
    missing.push({ label: intent.label, detail: intent.detail })
  }

  for (const intent of ENTITY_INTENTS) {
    if (!intent.request.test(text)) continue
    const candidates = info.filter((c) => [...columnWords(c.name)].some((w) => intent.columnWords.has(w)))
    if (candidates.length === 0) {
      if (info.length > 0) {
        notObtainable.push({
          label: `Falta información: ${intent.label.toLowerCase()}`,
          detail: `Ninguna columna compartida parece indicarlo (por ejemplo, ${intent.example}). Sin esa columna no se puede calcular; si existe con otro nombre, compartila en «Revisar» o aclaralo en la conversación.`,
        })
      }
      continue
    }
    const names = candidates.map((c) => `«${c.name}»`).join(', ')
    if (candidates.some((c) => used.has(normalize(c.name))) || candidates.every((c) => mentioned.has(`La columna «${c.name}»`))) continue
    const grouping = [...new Set(operations.flatMap((o) => o.group_by))]
    missing.push({
      label: intent.label,
      detail: `Hay columnas que podrían servir (${names}), pero ningún plan las usa${grouping.length ? `; el plan agrupa por ${grouping.map((g) => `«${g}»`).join(', ')}` : ''}.`,
    })
  }

  // «Una persona específica»: el motor todavía no filtra por un valor. No se promete: se sugiere lo disponible.
  const person = ENTITY_INTENTS[0]
  if (person.request.test(text) && SPECIFIC_REQUEST.test(text)) {
    const columnsForPerson = info.filter((c) => [...columnWords(c.name)].some((w) => person.columnWords.has(w)))
    const where = columnsForPerson.length ? `esa columna (${columnsForPerson.map((c) => `«${c.name}»`).join(', ')})` : 'la columna que identifique a las personas'
    notObtainable.push({
      label: 'Filtrar una persona o entidad en particular',
      detail: `El motor todavía no filtra por un valor concreto. Podés pedir que el plan agrupe por ${where} y buscar a la persona en la tabla o el gráfico del resultado (o en sus filtros, si el resultado tiene varias dimensiones).`,
    })
  }

  // Gastos o ingresos sobre una medida con signos mixtos: una suma da un total neto, no cada sentido.
  if (FLOW_REQUEST.test(text)) {
    for (const c of info.filter((c) => c.valueSign === 'mixed')) {
      notObtainable.push({
        label: `Gastos e ingresos por separado («${c.name}»)`,
        detail: `«${c.name}» tiene valores positivos y negativos, y el catálogo no filtra por signo: una suma da un total neto (no el saldo de una cuenta, el total gastado ni el cobrado). Sin saber qué significa el signo en tus datos, no se pueden distinguir ingresos de egresos automáticamente.`,
      })
    }
  }

  notObtainable.push(...NOT_OBTAINABLE.filter((n) => n.pattern.test(text)).map(({ label, detail }) => ({ label, detail })))
  return { missing, notObtainable }
}

/** Mensaje sugerido (editable, no se envía solo) para pedirle al asistente que complete el plan. */
export function adjustmentMessage(missing: CoverageGap[]): string {
  const parts = missing.map((m) => m.label.replace(/^La columna /, 'la columna ').replace(/^./, (c) => c.toLowerCase()))
  return `Quisiera ajustar el plan: también necesito ${parts.join(', ')}.`
}

/** Nombres con los que la IA conoce las columnas compartidas en la revisión. */
export function sharedColumnNames(sources: SourceReview[]): string[] {
  return sources.flatMap((s) => Object.entries(s.columns).filter(([, c]) => c.include).map(([original]) => sharedName(s, original)))
}

/** Columnas compartidas con su tipo (el de la revisión) y el signo de sus valores (del perfil). */
export function sharedColumns(sources: SourceReview[], catalog: DatasetCatalog): CoverageColumn[] {
  return sources.flatMap((review) => {
    const source = catalog.sources.find((s) => s.alias === review.alias)
    return Object.entries(review.columns)
      .filter(([, c]) => c.include)
      .map(([original, decision]) => {
        const column = source?.columns.find((c) => c.name === original)
        return {
          name: sharedName(review, original),
          semanticType: decision.semanticType ?? column?.semanticType ?? null,
          valueSign: column?.valueSign ?? null,
        }
      })
  })
}
