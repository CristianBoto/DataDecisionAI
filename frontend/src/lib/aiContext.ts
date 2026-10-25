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

export interface AIColumnContext {
  name: string
  format: ColumnType
  semantic_type: SemanticType | null
  semantic_confidence: SemanticConfidence | null
}

export interface AISourceContext {
  alias: 'A' | 'B' | 'C'
  columns: AIColumnContext[]
  size_range: SizeRange | null
}

export interface AIContextPayload {
  version: 1
  objective: string
  sources: AISourceContext[]
}

export interface ColumnReview {
  include: boolean
  /** Nombre que se enviaría (por defecto, el original). */
  name: string
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
    columns: Object.fromEntries(source.columns.map((c) => [c.name, { include: true, name: c.name }])),
  }))
}

export function buildAIContext(catalog: DatasetCatalog, objective: string, review: SourceReview[]): AIContextPayload {
  const sources = catalog.sources
    .slice(0, 3)
    .map((source): AISourceContext | null => {
      const sourceReview = review.find((r) => r.alias === source.alias)
      const columns = source.columns
        .filter((c) => sourceReview?.columns[c.name]?.include ?? false)
        .map((c) => ({
          name: (sourceReview?.columns[c.name]?.name ?? c.name).trim() || c.name,
          format: c.format,
          semantic_type: c.semanticType ?? null,
          semantic_confidence: c.semanticConfidence ?? null,
        }))
      if (columns.length === 0) return null // una fuente sin columnas autorizadas no se menciona
      return {
        alias: source.alias as AISourceContext['alias'],
        columns,
        size_range: sourceReview?.includeSize ? sizeRange(source.rowCount) : null,
      }
    })
    .filter((s): s is AISourceContext => s !== null)

  return { version: 1, objective: objective.trim(), sources }
}

/** Motivo por el que todavía no se puede preparar la solicitud, o null. */
export function contextProblem(payload: AIContextPayload): string | null {
  if (payload.objective.length < 3) return 'Escribí el objetivo que querés compartir (al menos 3 caracteres).'
  if (payload.objective.length > MAX_OBJECTIVE_CHARS) return `El objetivo no puede superar los ${MAX_OBJECTIVE_CHARS} caracteres.`
  if (payload.sources.length === 0) return 'Incluí al menos una columna de alguna fuente.'
  return null
}
