import { createContext } from 'react'
import type { Dataset, DatasetProfile } from '@/types/domain'
import type { AnalysisSource } from '@/lib/datasetCatalog'
import type { SourceReview } from '@/lib/aiContext'
import type { AIAuthorizeResult } from '@/services/aiGateway'
import type { ExecutionResponse } from '@/services/analysisEngine'

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
/** Turno de la conversación con la IA real (solo lo enviado y lo validado por el backend). */
export interface AIChatTurn {
  id: string
  role: 'user' | 'assistant'
  content: string
  result?: AIAuthorizeResult
}

/** Permiso de conversación vigente (el backend lo valida en cada mensaje). */
export interface AIConversationGrant {
  id: string
  /** Momento de vencimiento (ms desde epoch, reloj del navegador). */
  expiresAt: number
  maxMessages: number
}

export interface AnalysisSessionState {
  /** Fuentes del análisis (hasta MAX_SOURCES), perfiladas por separado. */
  sources: AnalysisSource[]
  projectId: string | null
  projectName: string
  review: AnalysisReviewState | null
  /** Solo con la revisión confirmada se puede conversar con el asistente. */
  reviewConfirmed: boolean
  /** Conversación con la IA real; se reinicia al cambiar las fuentes o la revisión. */
  aiChat: AIChatTurn[]
  /** Planes aprobados por el usuario (en orden de aprobación; guardados en el backend, sin ejecutar). */
  approvedPlanIds: string[]
  /** Planes aprobados que además se confirmaron en el paso 4 (todavía no se ejecutan). */
  confirmedPlanIds: string[]
  /** Autorización de la conversación con la IA real, si el usuario la otorgó. */
  aiConversationGrant: AIConversationGrant | null
  /** Último resultado del motor de análisis (Pandas) para los planes confirmados. */
  analysisRun: ExecutionResponse | null
}

export interface AnalysisSessionValue extends AnalysisSessionState {
  /** Fuente principal (la primera); se mantiene para las pantallas de una sola fuente. */
  dataset: Dataset | null
  profile: DatasetProfile | null
  addSource: (dataset: Dataset, profile: DatasetProfile, file?: File) => void
  /** Reemplaza una fuente en su misma posición, sin tocar las demás. */
  replaceSource: (datasetId: string, dataset: Dataset, profile: DatasetProfile, file?: File) => void
  removeSource: (datasetId: string) => void
  setProjectId: (projectId: string) => void
  setProjectName: (name: string) => void
  /** Guardar cambios en la revisión invalida una confirmación anterior. */
  setReview: (review: AnalysisReviewState) => void
  confirmReview: () => void
  appendAIChat: (turns: AIChatTurn[]) => void
  markPlanApproved: (planId: string) => void
  /** Confirmación final del paso 4 (no ejecuta cálculos). */
  confirmPlans: (planIds: string[]) => void
  setAIConversationGrant: (grant: AIConversationGrant | null) => void
  setAnalysisRun: (run: ExecutionResponse | null) => void
  reset: () => void
}

export const AnalysisSessionContext = createContext<AnalysisSessionValue | null>(null)
