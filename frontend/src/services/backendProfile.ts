import type { Additivity, ColumnType, DataQualityIssue, DatasetProfile, SemanticConfidence, SemanticType } from '@/types/domain'
import { inferColumnType } from '@/lib/csv'
import { ApiError } from './errors'
import { HttpClient } from './httpClient'

/**
 * Perfilado real con FastAPI + Pandas: `POST /api/datasets/profile`.
 * El backend no guarda el archivo; devuelve un diagnóstico que acá se adapta
 * al tipo `DatasetProfile` del frontend sin cambiar el contrato de ninguno.
 */

/** Respuesta JSON tal como la devuelve `app/services/dataset_profiler.py`. */
export interface BackendColumnProfile {
  name: string
  missing: number
  non_empty: number
  distinct: number
  examples: string[]
  // Calidad y tipo semántico (opcionales para tolerar versiones previas del backend).
  suspected_missing?: number
  suspected_missing_values?: Record<string, number>
  value_kind?: 'numeric' | 'date' | 'boolean' | 'text' | 'mixed' | 'empty'
  semantic_type?: SemanticType
  semantic_confidence?: SemanticConfidence
  semantic_reason?: string
  // Sugerencias sobre las medidas (motor generalista).
  unit_suggestion?: string | null
  unit_reason?: string | null
  additivity_suggestion?: Additivity | null
  additivity_reason?: string | null
  split_by_suggestion?: string[]
  value_sign?: 'positive' | 'negative' | 'mixed' | null
  split_reason?: string | null
  missing_value_suggestions?: string[]
}

export interface BackendProfileResponse {
  filename: string
  format: 'csv' | 'xlsx'
  encoding: string | null
  sheet_name: string | null
  row_count: number
  column_count: number
  duplicate_rows: number
  total_cells?: number
  empty_cells?: number
  suspected_missing_cells?: number
  completeness?: number | null
  columns: BackendColumnProfile[]
  preview: Record<string, string>[]
  warnings: string[]
}

export const BACKEND_PROFILE_PATH = '/api/datasets/profile'

const COLUMN_IN_WARNING = /^La columna '(.+?)'/

function toIssue(warning: string): DataQualityIssue {
  const column = COLUMN_IN_WARNING.exec(warning)?.[1]
  return column ? { severity: 'warning', column, message: warning } : { severity: 'warning', message: warning }
}

const VALUE_KIND_TO_TYPE: Record<NonNullable<BackendColumnProfile['value_kind']>, ColumnType> = {
  numeric: 'numeric',
  date: 'date',
  boolean: 'boolean',
  text: 'text',
  mixed: 'text',
  empty: 'unknown',
}

export function adaptBackendProfile(response: BackendProfileResponse, datasetId: string): DatasetProfile {
  const source =
    response.format === 'xlsx'
      ? `hoja «${response.sheet_name ?? 'primera'}»`
      : `codificación ${response.encoding ?? 'desconocida'}`

  return {
    datasetId,
    origin: 'backend',
    isComplete: true,
    rowCount: response.row_count,
    rowCountIsEstimate: false,
    columnCount: response.column_count,
    duplicateRowCount: response.duplicate_rows,
    completeness: response.completeness,
    suspectedMissingCellCount: response.suspected_missing_cells,
    columns: response.columns.map((column) => ({
      name: column.name,
      // El backend clasifica el formato con TODOS los valores; si no lo informa
      // (versión previa), se estima con ejemplos y primeras filas.
      inferredType: column.value_kind
        ? VALUE_KIND_TO_TYPE[column.value_kind]
        : inferColumnType([...column.examples, ...response.preview.map((row) => row[column.name] ?? '')]),
      nonNullCount: column.non_empty,
      nullCount: column.missing,
      suspectedMissingCount: column.suspected_missing,
      semanticType: column.semantic_type,
      semanticConfidence: column.semantic_confidence,
      semanticReason: column.semantic_reason,
      uniqueCount: column.distinct,
      sampleValues: column.examples,
      unitSuggestion: column.unit_suggestion ?? null,
      unitReason: column.unit_reason ?? null,
      additivitySuggestion: column.additivity_suggestion ?? null,
      additivityReason: column.additivity_reason ?? null,
      splitBySuggestion: column.split_by_suggestion ?? [],
      valueSign: column.value_sign ?? null,
      splitReason: column.split_reason ?? null,
      missingValueSuggestions: column.missing_value_suggestions ?? [],
    })),
    previewRows: response.preview,
    issues: response.warnings.map(toIssue),
    note:
      `Perfil calculado con Python (Pandas) sobre el archivo completo (${source}). ` +
      'La interpretación de cada columna es una estimación con nivel de confianza.',
  }
}

export interface DatasetProfiler {
  profile(file: File, datasetId: string): Promise<DatasetProfile>
}

export function createBackendProfiler(baseUrl: string): DatasetProfiler {
  const http = new HttpClient(baseUrl)
  return {
    async profile(file, datasetId) {
      const form = new FormData()
      form.append('file', file)
      try {
        const response = await http.json<BackendProfileResponse>(BACKEND_PROFILE_PATH, {
          method: 'POST',
          body: form,
          timeoutMs: 120_000,
        })
        return adaptBackendProfile(response, datasetId)
      } catch (error) {
        if (error instanceof TypeError) {
          throw new ApiError(
            `No se pudo conectar con el backend en ${baseUrl}. Verificá que FastAPI esté en ejecución y que CORS permita este origen.`,
            { code: 'backend_unreachable' },
          )
        }
        throw error
      }
    },
  }
}
