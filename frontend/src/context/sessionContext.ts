import { createContext } from 'react'
import type { Dataset, DatasetProfile } from '@/types/domain'
import type { AnalysisSource } from '@/lib/datasetCatalog'

/**
 * Estado del asistente de creación de análisis (carga → chat → confirmación).
 * Vive solo en memoria: no se guardan archivos ni datos en localStorage.
 */
export interface AnalysisSessionState {
  /** Fuentes del análisis (hasta MAX_SOURCES), perfiladas por separado. */
  sources: AnalysisSource[]
  projectId: string | null
}

export interface AnalysisSessionValue extends AnalysisSessionState {
  /** Fuente principal (la primera); se mantiene para las pantallas de una sola fuente. */
  dataset: Dataset | null
  profile: DatasetProfile | null
  addSource: (dataset: Dataset, profile: DatasetProfile) => void
  /** Reemplaza una fuente en su misma posición, sin tocar las demás. */
  replaceSource: (datasetId: string, dataset: Dataset, profile: DatasetProfile) => void
  removeSource: (datasetId: string) => void
  setProjectId: (projectId: string) => void
  reset: () => void
}

export const AnalysisSessionContext = createContext<AnalysisSessionValue | null>(null)
