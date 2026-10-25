import type { ColumnType, Dataset, DatasetProfile, ProfileOrigin, SemanticConfidence, SemanticType } from '@/types/domain'
import { getCompleteness, getSuspectedMissingCells } from './profileMetrics'

/**
 * Varias fuentes por análisis (Fase 3A).
 *
 * Las fuentes se perfilan por separado y se mantienen independientes: acá no
 * se une, concatena ni transforma nada. El catálogo resume sus ESQUEMAS para
 * que, en una fase posterior, el asistente (IA 1) pueda proponer cómo usarlas.
 * Por minimización de datos no incluye valores reales (ni ejemplos ni filas).
 */

/** Máximo de archivos por análisis en el MVP. */
export const MAX_SOURCES = 3
/** Tamaño total máximo de las fuentes de un análisis (cada archivo, además, respeta su propio límite). */
export const MAX_TOTAL_UPLOAD_MB = 60

export interface AnalysisSource {
  dataset: Dataset
  profile: DatasetProfile
}

export interface CatalogColumn {
  name: string
  /** Formato de los valores (tipo técnico). */
  format: ColumnType
  /** Interpretación estimada por el backend; ausente en la vista previa local. */
  semanticType?: SemanticType
  semanticConfidence?: SemanticConfidence
  missing: number
  suspectedMissing: number
  distinct: number | null
}

export interface CatalogSource {
  /** Alias estable dentro del análisis: A, B, C. */
  alias: string
  datasetId: string
  fileName: string
  format: Dataset['format']
  profileOrigin: ProfileOrigin
  rowCount: number | null
  rowCountIsEstimate: boolean
  columnCount: number
  completeness: number | null
  duplicateRows: number | null
  suspectedMissingCells: number
  columns: CatalogColumn[]
}

/** Columna con el mismo nombre normalizado en dos o más fuentes: pista, nunca una clave confirmada. */
export interface SharedColumn {
  name: string
  sources: string[]
}

export interface DatasetCatalog {
  version: 1
  sources: CatalogSource[]
  sharedColumns: SharedColumn[]
  /** Pares de fuentes con exactamente las mismas columnas (posible concatenación, a confirmar). */
  sameColumnSets: [string, string][]
  /** Recordatorio para quien consuma el catálogo (asistente o persona). */
  rules: string[]
}

export const CATALOG_RULES = [
  'Las fuentes se perfilaron por separado y no se unieron, concatenaron ni transformaron.',
  'Las columnas compartidas y las estructuras iguales son pistas, no relaciones confirmadas.',
  'Antes de unir fuentes se deben validar claves, unicidad, granularidad, cardinalidad y riesgo de multiplicar registros, y el usuario debe aprobar el plan.',
]

export function sourceAlias(index: number): string {
  return String.fromCharCode(65 + index)
}

/** 'Código País' y 'codigo_pais' se consideran el mismo nombre. */
export function normalizeColumnName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

export function buildDatasetCatalog(sources: AnalysisSource[]): DatasetCatalog {
  const catalogSources: CatalogSource[] = sources.map(({ dataset, profile }, index) => ({
    alias: sourceAlias(index),
    datasetId: dataset.id,
    fileName: dataset.fileName,
    format: dataset.format,
    profileOrigin: profile.origin,
    rowCount: profile.rowCount,
    rowCountIsEstimate: profile.rowCountIsEstimate,
    columnCount: profile.columnCount,
    completeness: getCompleteness(profile),
    duplicateRows: profile.duplicateRowCount ?? null,
    suspectedMissingCells: getSuspectedMissingCells(profile),
    columns: profile.columns.map((column) => ({
      name: column.name,
      format: column.inferredType,
      semanticType: column.semanticType,
      semanticConfidence: column.semanticConfidence,
      missing: column.nullCount,
      suspectedMissing: column.suspectedMissingCount ?? 0,
      distinct: column.uniqueCount,
    })),
  }))

  const byName = new Map<string, { name: string; sources: Set<string> }>()
  for (const source of catalogSources) {
    for (const column of source.columns) {
      const key = normalizeColumnName(column.name)
      if (!key) continue
      const entry = byName.get(key) ?? { name: column.name, sources: new Set<string>() }
      entry.sources.add(source.alias)
      byName.set(key, entry)
    }
  }
  const sharedColumns = [...byName.values()]
    .filter((entry) => entry.sources.size > 1)
    .map((entry) => ({ name: entry.name, sources: [...entry.sources] }))

  const signature = (source: CatalogSource) =>
    source.columns.map((c) => normalizeColumnName(c.name)).sort().join('|')
  const sameColumnSets: [string, string][] = []
  catalogSources.forEach((a, i) => {
    catalogSources.slice(i + 1).forEach((b) => {
      if (a.columnCount > 0 && signature(a) === signature(b)) sameColumnSets.push([a.alias, b.alias])
    })
  })

  return { version: 1, sources: catalogSources, sharedColumns, sameColumnSets, rules: CATALOG_RULES }
}
