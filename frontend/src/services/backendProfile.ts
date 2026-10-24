import type { DataQualityIssue, DatasetProfile } from '@/types/domain'
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
}

export interface BackendProfileResponse {
  filename: string
  format: 'csv' | 'xlsx'
  encoding: string | null
  sheet_name: string | null
  row_count: number
  column_count: number
  duplicate_rows: number
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
    columns: response.columns.map((column) => ({
      name: column.name,
      // Pandas lee todo como texto; el tipo se estima con ejemplos y primeras filas.
      inferredType: inferColumnType([...column.examples, ...response.preview.map((row) => row[column.name] ?? '')]),
      nonNullCount: column.non_empty,
      nullCount: column.missing,
      uniqueCount: column.distinct,
      sampleValues: column.examples,
    })),
    previewRows: response.preview,
    issues: response.warnings.map(toIssue),
    note: `Perfil calculado con Python (Pandas) sobre el archivo completo (${source}). Los tipos de columna son estimados.`,
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
