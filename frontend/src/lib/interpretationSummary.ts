/**
 * Resumen en lenguaje natural de lo que se enviaría a la IA para interpretar resultados.
 *
 * Se calcula en el navegador a partir del contenido EXACTO que preparó el backend (el mismo JSON
 * que se autoriza), sin consultar a ninguna IA. No resume ni oculta: lista todas las categorías
 * y períodos que viajan, porque son valores de los datos de la persona.
 */

import { looksLikePersonColumn } from '@/lib/planCoverage'

interface PayloadRow {
  keys?: unknown[]
}

interface PayloadOperation {
  ref?: string
  description?: string
  operation?: string
  status?: string
  dimensions?: string[]
  rows?: PayloadRow[]
  rows_total?: number
  rows_withheld?: boolean
  stats?: Record<string, unknown> | null
  error?: string | null
}

export interface SentOperation {
  ref: string
  title: string
  /** Qué viaja de esta operación, en palabras simples. */
  content: string
  /** Valores de cada dimensión que viajan (categorías, períodos o intervalos), completos. */
  values: { dimension: string; values: string[] }[]
}

export interface InterpretationSummary {
  objective: string | null
  sources: string[]
  calculated: { ref: string; title: string }[]
  failed: { ref: string; title: string; reason: string }[]
  sent: SentOperation[]
  /** Hechos del resumen descriptivo que también viajan. */
  facts: number
  /** Algún resultado incluye nombres de categorías o períodos de los datos. */
  includesDataValues: boolean
  /** Dimensiones enviadas cuyo nombre sugiere personas o entidades (sus valores viajan tal cual). */
  personDimensions: { dimension: string; values: string[] }[]
}

const STAT_NAMES: Record<string, string> = {
  pearson: 'correlación de Pearson',
  spearman: 'correlación de Spearman',
  n: 'cantidad de pares',
  auc: 'AUC',
  positives: 'casos positivos',
  negatives: 'casos negativos',
  bins: 'cantidad de intervalos',
}

const plural = (n: number, one: string, many: string) => `${n.toLocaleString('es-AR')} ${n === 1 ? one : many}`

export function summarizeInterpretationPayload(payload: Record<string, unknown>): InterpretationSummary {
  const operations = (Array.isArray(payload.operations) ? payload.operations : []) as PayloadOperation[]
  const sources = (Array.isArray(payload.sources) ? payload.sources : []) as { alias?: string; rows?: number; columns?: number }[]
  const facts = (Array.isArray(payload.descriptive_summary) ? payload.descriptive_summary : []) as { facts?: unknown[] }[]
  const title = (op: PayloadOperation) => (op.description && op.description !== '—' ? op.description : (op.operation ?? 'Operación'))

  const sent: SentOperation[] = operations.map((op) => {
    const rows = op.rows ?? []
    const dims = op.dimensions ?? []
    const values = dims
      .map((dimension, i) => ({
        dimension,
        values: [...new Set(rows.map((r) => String(r.keys?.[i] ?? '')).filter(Boolean))],
      }))
      .filter((d) => d.values.length > 0)
    const stats = Object.keys(op.stats ?? {}).map((k) => STAT_NAMES[k]).filter(Boolean)
    let content: string
    if (op.status !== 'ok') content = 'el motivo por el que no se pudo calcular (sin resultados)'
    else if (op.rows_withheld) content = 'sin filas de resultados: cada grupo correspondería a un registro individual, así que no se envían'
    else if (rows.length === 0 && stats.length) content = `solo estadísticos (${stats.join(', ')}), sin puntos individuales`
    else {
      const total = op.rows_total ?? rows.length
      content = `${plural(rows.length, 'fila', 'filas')} de resultados agregados${total > rows.length ? ` (de ${total.toLocaleString('es-AR')}; las demás no se envían)` : ''}, con sus cifras`
    }
    return { ref: op.ref ?? '', title: title(op), content, values }
  })

  return {
    objective: typeof payload.objective === 'string' && payload.objective.trim() ? payload.objective : null,
    sources: sources.map((s) => `Fuente ${s.alias}: ${plural(s.rows ?? 0, 'fila', 'filas')} y ${plural(s.columns ?? 0, 'columna', 'columnas')}`),
    calculated: operations.filter((o) => o.status === 'ok').map((o) => ({ ref: o.ref ?? '', title: title(o) })),
    failed: operations.filter((o) => o.status !== 'ok').map((o) => ({ ref: o.ref ?? '', title: title(o), reason: o.error ?? 'sin detalle' })),
    sent,
    facts: facts.reduce((n, f) => n + (f.facts?.length ?? 0), 0),
    includesDataValues: sent.some((s) => s.values.length > 0),
    personDimensions: sent.flatMap((s) => s.values).filter((d) => looksLikePersonColumn(d.dimension)),
  }
}
