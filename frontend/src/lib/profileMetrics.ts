import { formatValue } from '@/lib/format'
import type { ColumnProfile, DatasetProfile, SemanticConfidence, SemanticType } from '@/types/domain'

/**
 * Métricas de calidad derivadas del perfil, con un único criterio para toda la
 * interfaz. Si el backend informó el valor (archivo completo), se usa ese; el
 * cálculo local solo aplica a la vista previa del navegador.
 */

/** Celdas no vacías / total de celdas. Los marcadores como "NA" no se descuentan. */
export function getCompleteness(profile: DatasetProfile): number | null {
  if (profile.completeness !== undefined && profile.completeness !== null) return profile.completeness
  const total = (profile.rowCount ?? 0) * profile.columnCount
  if (total <= 0) return null
  const empty = profile.columns.reduce((sum, c) => sum + c.nullCount, 0)
  return 1 - empty / total
}

export function getSuspectedMissingCells(profile: DatasetProfile): number {
  return profile.suspectedMissingCellCount ?? profile.columns.reduce((sum, c) => sum + (c.suspectedMissingCount ?? 0), 0)
}

export const COMPLETENESS_CRITERIA =
  'Celdas no vacías sobre el total. Valores como "NA" o "-" no se descuentan: se informan aparte como posibles marcadores de ausencia.'

export const SEMANTIC_LABEL: Record<SemanticType, string> = {
  quantitative: 'Cuantitativa',
  categorical: 'Categórica',
  identifier: 'Código o ID',
  temporal: 'Temporal',
  text: 'Texto libre',
  unknown: 'Sin datos',
}

export const CONFIDENCE_LABEL: Record<SemanticConfidence, string> = {
  high: 'confianza alta',
  medium: 'confianza media',
  low: 'confianza baja',
}

/** true si tiene sentido sumar o promediar la columna (no es código, año ni categoría). */
export function isMeasurable(column: ColumnProfile): boolean {
  return column.inferredType === 'numeric' && (column.semanticType === undefined || column.semanticType === 'quantitative')
}

/** Mismo formato que los indicadores (`formatValue`): nunca "100 %" si falta al menos una celda. */
export function formatCompleteness(value: number): string {
  return formatValue(value, 'percent')
}
