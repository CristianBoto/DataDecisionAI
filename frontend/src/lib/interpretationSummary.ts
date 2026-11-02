/**
 * Resumen en lenguaje natural de lo que se enviaría a la IA para interpretar resultados.
 *
 * Se calcula en el navegador a partir del contenido EXACTO que preparó el backend (el mismo JSON
 * que se autoriza), sin consultar a ninguna IA. No resume ni oculta: lista todas las categorías
 * y períodos que viajan, porque son valores de los datos de la persona.
 *
 * Entiende el contexto compacto (versión 2: planes, filas como arreglos, detalle y cobertura) y el
 * anterior (versión 1: operaciones con filas como objetos).
 */

import { looksLikePersonColumn } from '@/lib/planCoverage'

interface PayloadOperation {
  ref?: string
  description?: string
  operation?: string
  status?: string
  dimensions?: string[]
  /** Versión 1: objetos con `keys`. Versión 2: arreglos [claves…, valores…]. */
  rows?: ({ keys?: unknown[] } | unknown[])[]
  rows_total?: number
  rows_withheld?: boolean
  detail?: 'full' | 'summary' | 'facts'
  omitted?: string
  same_as?: string
  repeated?: Record<string, string>
  facts?: unknown[]
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
  /** Cobertura del contexto compacto: null si va todo completo (o en la versión 1). */
  partial: string | null
  /** Planes que la persona dejó afuera de este envío. */
  excludedPlans: string[]
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

function operationsOf(payload: Record<string, unknown>): PayloadOperation[] {
  if (Array.isArray(payload.plans)) {
    return (payload.plans as { operations?: PayloadOperation[] }[]).flatMap((p) => p.operations ?? [])
  }
  return (Array.isArray(payload.operations) ? payload.operations : []) as PayloadOperation[]
}

function keysOf(row: { keys?: unknown[] } | unknown[], dimensions: number): unknown[] {
  return Array.isArray(row) ? row.slice(0, dimensions) : (row.keys ?? [])
}

export function summarizeInterpretationPayload(payload: Record<string, unknown>): InterpretationSummary {
  const operations = operationsOf(payload)
  const sources = (Array.isArray(payload.sources) ? payload.sources : []) as { alias?: string; rows?: number; columns?: number }[]
  const v1Facts = (Array.isArray(payload.descriptive_summary) ? payload.descriptive_summary : []) as { facts?: unknown[] }[]
  const coverage = (payload.coverage ?? null) as { summarized?: number; facts_only?: number; note?: string; plans_excluded?: string[] } | null
  const title = (op: PayloadOperation) => (op.description && op.description !== '—' ? op.description : (op.operation ?? 'Operación'))

  const sent: SentOperation[] = operations.map((op) => {
    const rows = op.rows ?? []
    const dims = op.dimensions ?? []
    const values = dims
      .map((dimension, i) => ({
        dimension,
        values: [...new Set(rows.map((r) => String(keysOf(r, dims.length)[i] ?? '')).filter(Boolean))],
      }))
      .filter((d) => d.values.length > 0)
    const stats = Object.keys(op.stats ?? {}).map((k) => STAT_NAMES[k]).filter(Boolean)
    const total = op.rows_total ?? rows.length
    let content: string
    if (op.same_as) content = `es igual a ${op.same_as}: no se repite`
    else if (op.status !== 'ok') content = 'el motivo por el que no se pudo calcular (sin resultados)'
    else if (op.rows_withheld || (op.detail === 'facts' && op.omitted?.includes('registro individual'))) {
      content = 'sin filas de resultados: cada grupo correspondería a un registro individual, así que no se envían'
    } else if (op.detail === 'facts') content = `solo sus hechos principales (no sus ${total.toLocaleString('es-AR')} filas), por el límite de tamaño`
    else if (rows.length === 0 && stats.length) content = `solo estadísticos (${stats.join(', ')}), sin puntos individuales`
    else {
      const repeated = Object.keys(op.repeated ?? {}).length
      content =
        `${plural(rows.length, 'fila', 'filas')} de resultados agregados` +
        (total > rows.length ? ` (de ${total.toLocaleString('es-AR')}: ${op.detail === 'summary' ? 'filas representativas' : 'las demás no se envían'})` : '') +
        ', con sus cifras' +
        (repeated ? `; ${repeated === 1 ? 'una medida va' : `${repeated} medidas van`} como referencia a otra operación` : '')
    }
    return { ref: op.ref ?? '', title: title(op), content, values }
  })

  const facts = v1Facts.reduce((n, f) => n + (f.facts?.length ?? 0), 0) + operations.reduce((n, op) => n + (op.facts?.length ?? 0), 0)
  return {
    objective: typeof payload.objective === 'string' && payload.objective.trim() ? payload.objective : null,
    sources: sources.map((s) => `Fuente ${s.alias}: ${plural(s.rows ?? 0, 'fila', 'filas')} y ${plural(s.columns ?? 0, 'columna', 'columnas')}`),
    calculated: operations.filter((o) => o.status === 'ok').map((o) => ({ ref: o.ref ?? '', title: title(o) })),
    failed: operations.filter((o) => o.status !== 'ok').map((o) => ({ ref: o.ref ?? '', title: title(o), reason: o.error ?? 'sin detalle' })),
    sent,
    facts,
    includesDataValues: sent.some((s) => s.values.length > 0),
    personDimensions: sent.flatMap((s) => s.values).filter((d) => looksLikePersonColumn(d.dimension)),
    partial: coverage && ((coverage.summarized ?? 0) > 0 || (coverage.facts_only ?? 0) > 0 || (coverage.plans_excluded?.length ?? 0) > 0) ? (coverage.note ?? null) : null,
    excludedPlans: coverage?.plans_excluded ?? [],
  }
}
