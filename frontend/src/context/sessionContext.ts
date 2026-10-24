import { createContext } from 'react'
import type { Dataset, DatasetProfile } from '@/types/domain'

/**
 * Estado del asistente de creación de análisis (carga → chat → confirmación).
 * Vive solo en memoria: no se guardan archivos ni datos en localStorage.
 */
export interface AnalysisSessionState {
  dataset: Dataset | null
  profile: DatasetProfile | null
  projectId: string | null
}

export interface AnalysisSessionValue extends AnalysisSessionState {
  setDataset: (dataset: Dataset, profile: DatasetProfile) => void
  setProjectId: (projectId: string) => void
  reset: () => void
}

export const AnalysisSessionContext = createContext<AnalysisSessionValue | null>(null)
