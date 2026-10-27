import type { AnalysisSessionState } from '@/context/sessionContext'

/**
 * Pasos del recorrido y sus requisitos, en un único lugar: los usa el
 * encabezado (qué paso se puede abrir) y las pantallas (qué mostrar si se
 * llega escribiendo la URL). Volver atrás siempre está permitido; avanzar,
 * solo con los requisitos cumplidos.
 */

export type StepKey = 'cargar' | 'revisar' | 'asistente' | 'confirmar' | 'resultados'

export interface WizardStep {
  key: StepKey
  path: string
  label: string
}

export const WIZARD_STEPS: WizardStep[] = [
  { key: 'cargar', path: '/analisis/cargar', label: 'Cargar datos' },
  { key: 'revisar', path: '/analisis/revisar', label: 'Revisar' },
  { key: 'asistente', path: '/analisis/asistente', label: 'Conversar' },
  { key: 'confirmar', path: '/analisis/confirmar', label: 'Confirmar' },
  { key: 'resultados', path: '/analisis/resultados', label: 'Resultados' },
]

export interface StepAccess {
  available: boolean
  /** Por qué el paso está bloqueado (se muestra al usuario). */
  reason?: string
}

type SessionForSteps = Pick<AnalysisSessionState, 'sources' | 'reviewConfirmed' | 'projectId'> &
  Partial<Pick<AnalysisSessionState, 'analysisRun'>>

export function stepAccess(session: SessionForSteps): Record<StepKey, StepAccess> {
  const hasSources = session.sources.length > 0
  const reviewed = hasSources && session.reviewConfirmed && session.projectId !== null
  const blockedUntilReview = hasSources ? 'Primero confirmá la revisión de datos.' : 'Primero cargá al menos un archivo.'
  return {
    cargar: { available: true },
    revisar: hasSources ? { available: true } : { available: false, reason: 'Primero cargá al menos un archivo.' },
    asistente: reviewed ? { available: true } : { available: false, reason: blockedUntilReview },
    confirmar: reviewed ? { available: true } : { available: false, reason: blockedUntilReview },
    resultados: reviewed && session.analysisRun
      ? { available: true }
      : { available: false, reason: 'Primero ejecutá el análisis en «Confirmar».' },
  }
}
