import { createContext } from 'react'
import type { Dataset, DatasetProfile } from '@/types/domain'
import type { AnalysisSource } from '@/lib/datasetCatalog'
import type { SourceReview } from '@/lib/aiContext'

/**
 * Revisión obligatoria de datos y privacidad. Guarda las DECISIONES del
 * usuario (interpretación, marcadores, columnas a compartir y nombres para la
 * IA) para las fases siguientes; los datos y perfiles originales no cambian.
 */
export interface AnalysisReviewState {
  /** Lo que el usuario necesita analizar; se lleva a la conversación. */
  objective: string
  sources: SourceReview[]
}

/**
 * Estado del recorrido de creación de análisis (carga → revisión → chat → confirmación).
 * Vive solo en memoria: no se guardan archivos ni datos en localStorage.
 */
export interface AnalysisSessionState {
  /** Fuentes del análisis (hasta MAX_SOURCES), perfiladas por separado. */
  sources: AnalysisSource[]
  projectId: string | null
  projectName: string
  review: AnalysisReviewState | null
  /** Solo con la revisión confirmada se puede conversar con el asistente. */
  reviewConfirmed: boolean
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
  setProjectName: (name: string) => void
  /** Guardar cambios en la revisión invalida una confirmación anterior. */
  setReview: (review: AnalysisReviewState) => void
  confirmReview: () => void
  reset: () => void
}

export const AnalysisSessionContext = createContext<AnalysisSessionValue | null>(null)
