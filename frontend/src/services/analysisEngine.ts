import { appConfig } from '@/lib/config'
import { HttpClient } from './httpClient'

/**
 * Cliente del motor de análisis del backend (Fase 4A): Python + Pandas.
 *
 * Al pulsar «Ejecutar análisis», el navegador vuelve a enviar los archivos
 * originales (el perfilado no los guardó) junto con los planes aprobados y la
 * correspondencia de columnas de la revisión. El backend calcula en memoria y
 * descarta los datos. No interviene ninguna IA.
 */

export interface ColumnMapping {
  /** Nombre que vio la IA (y que usa el plan). */
  name: string
  /** Nombre real de la columna en el archivo. */
  original: string
  semantic_type: string | null
  missing_markers: 'pending' | 'treat_as_missing' | 'valid_value' | null
  unit?: string | null
  /** Clase positiva elegida por el usuario (curva ROC). Viaja solo al backend, nunca a la IA. */
  positive_label?: string | null
}

export interface ExecutionRequest {
  plan_ids: string[]
  sources: { alias: 'A' | 'B' | 'C'; columns: ColumnMapping[] }[]
}

export interface ResultMeasure {
  column: string
  aggregate: 'count' | 'sum' | 'mean' | 'median' | 'min' | 'max' | 'distinct_count' | 'share_pct' | string
  unit: string | null
}

export interface OperationResult {
  operation: string
  description: string
  columns: string[]
  group_by: string[]
  status: 'ok' | 'error'
  dimensions: string[]
  measures: ResultMeasure[]
  rows: { keys: string[]; values: (number | null)[] }[]
  period: 'month' | 'year' | null
  rows_used: number | null
  /** Estadísticos de la operación: correlaciones (dispersión), AUC (ROC), intervalos (histograma). */
  stats?: Record<string, number | string | boolean | null> | null
  warnings: string[]
  error: string | null
}

export interface PlanResult {
  plan_id: string
  source_alias: string
  title: string
  status: 'ok' | 'partial' | 'error'
  operations: OperationResult[]
  charts: { type: string; x: string | null; y: string | null; title: string }[]
  warnings: string[]
}

export interface ExecutionResponse {
  engine: 'pandas'
  executed_at: string
  sources: { alias: string; rows: number; columns: number }[]
  results: PlanResult[]
  notes: string[]
}

export interface AnalysisEngineClient {
  execute(request: ExecutionRequest, files: Partial<Record<'A' | 'B' | 'C', File>>): Promise<ExecutionResponse>
}

export function createAnalysisEngineClient(baseUrl: string): AnalysisEngineClient {
  const http = new HttpClient(baseUrl)
  return {
    execute(request, files) {
      const form = new FormData()
      form.append('request', JSON.stringify(request))
      for (const [alias, file] of Object.entries(files)) if (file) form.append(`file_${alias}`, file)
      return http.json<ExecutionResponse>('/api/analysis/execute', { method: 'POST', body: form, timeoutMs: 180_000 })
    },
  }
}

/** Solo con un backend propio. En la demo pública es null: no hay motor ni conexión. */
export function createDefaultAnalysisEngine(): AnalysisEngineClient | null {
  const hasBackend = !appConfig.demoMode || appConfig.backendProfiling
  return hasBackend ? createAnalysisEngineClient(appConfig.apiBaseUrl) : null
}
