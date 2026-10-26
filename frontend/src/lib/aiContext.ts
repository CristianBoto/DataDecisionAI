import type { ColumnType, SemanticConfidence, SemanticType } from '@/types/domain'
import type { DatasetCatalog } from './datasetCatalog'

/**
 * Contexto mínimo para la futura IA (Fase 3B.1).
 *
 * Coincide con `backend/app/schemas/ai_context.py`, que es la lista blanca
 * definitiva: el backend rechaza cualquier otro campo. Acá se arma lo que el
 * usuario revisa ANTES de que exista una solicitud.
 *
 * Nunca se incluyen: archivos, nombres de archivo, filas, vistas previas,
 * ejemplos, valores ni conteos exactos. Los nombres de columna sí, porque la
 * IA los necesita para proponer un plan, pero el usuario puede ocultarlos o
 * renombrarlos: también pueden ser sensibles.
 */

export type SizeRange = '<1k' | '1k-10k' | '10k-100k' | '100k-1M' | '>1M'

/** Formato que el usuario puede confirmar o corregir (más preciso que "numérico"). */
export type FormatChoice = 'integer' | 'decimal' | 'text' | 'date' | 'boolean'
/** Qué hacer más adelante con los marcadores como "NA". Se registra; no se aplica ahora. */
export type MarkerDecision = 'pending' | 'treat_as_missing' | 'valid_value'

export interface AIColumnContext {
  name: string
  format: ColumnType | FormatChoice
  semantic_type: SemanticType | null
  semantic_confidence: SemanticConfidence | null
  /** true si el usuario corrigió el formato o el significado sugeridos. */
  user_corrected: boolean
  /** Solo si la columna tiene posibles marcadores de ausencia (sin enviar sus valores). */
  missing_markers: MarkerDecision | null
  /** Valores distintos por rango (aproximado: nunca la cantidad exacta ni los valores). */
  distinct_values?: DistinctRange | null
}

export type DistinctRange = '1' | '2' | '3-10' | '11-50' | '51-500' | '>500'

/** Rango aproximado de valores distintos: suficiente para elegir agrupaciones, sin revelar el dato exacto. */
export function distinctRange(count: number | null | undefined): DistinctRange | null {
  if (count === null || count === undefined || count < 1) return null
  if (count === 1) return '1'
  if (count === 2) return '2'
  if (count <= 10) return '3-10'
  if (count <= 50) return '11-50'
  if (count <= 500) return '51-500'
  return '>500'
}

export interface AISourceContext {
  alias: 'A' | 'B' | 'C'
  columns: AIColumnContext[]
  size_range: SizeRange | null
}

export interface AIContextPayload {
  version: 1
  objective: string
  /** Mensaje concreto del chat que se autorizaría enviar (solo en la autorización por mensaje). */
  message?: string
  sources: AISourceContext[]
  /** Turnos anteriores con la IA real: también se revisan y aprueban. */
  history?: AIHistoryTurn[]
}

export interface AIHistoryTurn {
  role: 'user' | 'assistant'
  content: string
}

/** Máximo de turnos anteriores que se envían (el backend rechaza más). */
export const MAX_HISTORY_TURNS = 8

/**
 * Decisiones del usuario sobre una columna. Se guardan en el estado del
 * análisis para las fases siguientes; NO modifican el archivo ni el perfil.
 */
export interface ColumnReview {
  /** Compartir la columna con la IA. */
  include: boolean
  /** Nombre que se enviaría a la IA (por defecto, el original). No cambia los datos. */
  name: string
  /** Corrección del formato; null = se acepta lo detectado por Pandas. */
  format?: FormatChoice | null
  /** Corrección del significado estadístico; null = se acepta la sugerencia. */
  semanticType?: SemanticType | null
  /** Decisión sobre marcadores como "NA"; null si la columna no los tiene. */
  markers?: MarkerDecision | null
}

export interface SourceReview {
  alias: string
  /** Incluir solo un rango de tamaño (por ejemplo, "10k-100k"), nunca la cantidad exacta. */
  includeSize: boolean
  /** Clave: nombre original de la columna. */
  columns: Record<string, ColumnReview>
}

export const NEVER_SENT = [
  'Los archivos CSV/XLSX originales',
  'Los nombres originales de los archivos (se usan los alias A, B y C)',
  'Filas, vistas previas, ejemplos y valores individuales',
  'Conteos exactos, completitud y demás estadísticas',
  'Motivos de interpretación y observaciones (pueden incluir rangos reales)',
]

export const MAX_OBJECTIVE_CHARS = 2000

export function sizeRange(rowCount: number | null): SizeRange | null {
  if (rowCount === null) return null
  if (rowCount < 1_000) return '<1k'
  if (rowCount < 10_000) return '1k-10k'
  if (rowCount < 100_000) return '10k-100k'
  if (rowCount < 1_000_000) return '100k-1M'
  return '>1M'
}

/** Revisión inicial: columnas con su nombre original y sin tamaño. El usuario decide. */
export function defaultReview(catalog: DatasetCatalog): SourceReview[] {
  return catalog.sources.map((source) => ({
    alias: source.alias,
    includeSize: false,
    columns: Object.fromEntries(
      source.columns.map((c) => [
        c.name,
        { include: true, name: c.name, format: null, semanticType: null, markers: c.suspectedMissing > 0 ? 'pending' : null },
      ]),
    ),
  }))
}

export function buildAIContext(
  catalog: DatasetCatalog,
  objective: string,
  review: SourceReview[],
  message?: string,
  history: AIHistoryTurn[] = [],
): AIContextPayload {
  const sources = catalog.sources
    .slice(0, 3)
    .map((source): AISourceContext | null => {
      const sourceReview = review.find((r) => r.alias === source.alias)
      const columns = source.columns
        .filter((c) => sourceReview?.columns[c.name]?.include ?? false)
        .map((c) => {
          const decision = sourceReview?.columns[c.name]
          const corrected = Boolean(decision?.format || decision?.semanticType)
          return {
            name: (decision?.name ?? c.name).trim() || c.name,
            format: decision?.format ?? c.format,
            semantic_type: decision?.semanticType ?? c.semanticType ?? null,
            // Si el usuario corrigió, la confianza automática ya no aplica.
            semantic_confidence: corrected ? null : (c.semanticConfidence ?? null),
            user_corrected: corrected,
            missing_markers: decision?.markers ?? null,
            distinct_values: distinctRange(c.distinct),
          }
        })
      if (columns.length === 0) return null // una fuente sin columnas autorizadas no se menciona
      return {
        alias: source.alias as AISourceContext['alias'],
        columns,
        size_range: sourceReview?.includeSize ? sizeRange(source.rowCount) : null,
      }
    })
    .filter((s): s is AISourceContext => s !== null)

  const goal = objective.trim()
  const text = message?.trim()
  const payload: AIContextPayload = { version: 1, objective: goal, sources }
  // El objetivo no se envía dos veces: si el mensaje es el propio objetivo, alcanza con `objective`.
  if (text && text !== goal) payload.message = text
  if (history.length > 0) payload.history = history.slice(-MAX_HISTORY_TURNS)
  return payload
}

/** Motivo por el que todavía no se puede preparar la solicitud, o null. */
export function contextProblem(payload: AIContextPayload): string | null {
  if (payload.objective.length < 3) return 'Escribí el objetivo que querés compartir (al menos 3 caracteres).'
  if (payload.objective.length > MAX_OBJECTIVE_CHARS) return `El objetivo no puede superar los ${MAX_OBJECTIVE_CHARS} caracteres.`
  if (payload.sources.length === 0) return 'Incluí al menos una columna de alguna fuente.'
  return null
}
