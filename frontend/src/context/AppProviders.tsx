import { useCallback, useMemo, useState, type ReactNode } from 'react'
import type { DataDecisionService } from '@/services'
import { service as defaultService } from '@/services'
import type { Dataset, DatasetProfile } from '@/types/domain'
import { MAX_SOURCES } from '@/lib/datasetCatalog'
import type { AIGatewayClient } from '@/services/aiGateway'
import { AIGatewayContext, defaultAIGateway, ServiceContext } from './serviceContext'
import { AnalysisSessionContext, type AnalysisSessionState } from './sessionContext'

const EMPTY_SESSION: AnalysisSessionState = { sources: [], projectId: null, projectName: '', review: null, reviewConfirmed: false }
// Cambiar las fuentes obliga a revisar de nuevo y a crear otro proyecto.
const SOURCES_CHANGED = { projectId: null, review: null, reviewConfirmed: false }

interface AppProvidersProps {
  children: ReactNode
  service?: DataDecisionService
  /** Cliente de la frontera de IA; null = sin conexión (demo pública). */
  aiGateway?: AIGatewayClient | null
}

export function AppProviders({ children, service = defaultService, aiGateway = defaultAIGateway }: AppProvidersProps) {
  const [session, setSession] = useState<AnalysisSessionState>(EMPTY_SESSION)

  // Cambiar las fuentes implica empezar un proyecto nuevo.
  const addSource = useCallback((dataset: Dataset, profile: DatasetProfile) => {
    setSession((current) => ({
      ...current,
      ...SOURCES_CHANGED,
      sources: [...current.sources, { dataset, profile }].slice(0, MAX_SOURCES),
    }))
  }, [])
  const replaceSource = useCallback((datasetId: string, dataset: Dataset, profile: DatasetProfile) => {
    setSession((current) => ({
      ...current,
      ...SOURCES_CHANGED,
      sources: current.sources.map((s) => (s.dataset.id === datasetId ? { dataset, profile } : s)),
    }))
  }, [])
  const removeSource = useCallback((datasetId: string) => {
    setSession((current) => ({ ...current, ...SOURCES_CHANGED, sources: current.sources.filter((s) => s.dataset.id !== datasetId) }))
  }, [])
  const setProjectId = useCallback((projectId: string) => {
    setSession((current) => ({ ...current, projectId }))
  }, [])
  const setProjectName = useCallback((projectName: string) => {
    setSession((current) => ({ ...current, projectName }))
  }, [])
  const setReview = useCallback((review: AnalysisSessionState['review']) => {
    setSession((current) => ({ ...current, review, reviewConfirmed: false, projectId: null }))
  }, [])
  const confirmReview = useCallback(() => {
    setSession((current) => (current.review ? { ...current, reviewConfirmed: true } : current))
  }, [])
  const reset = useCallback(() => setSession(EMPTY_SESSION), [])

  const value = useMemo(
    () => ({
      ...session,
      dataset: session.sources[0]?.dataset ?? null,
      profile: session.sources[0]?.profile ?? null,
      addSource,
      replaceSource,
      removeSource,
      setProjectId,
      setProjectName,
      setReview,
      confirmReview,
      reset,
    }),
    [session, addSource, replaceSource, removeSource, setProjectId, setProjectName, setReview, confirmReview, reset],
  )

  return (
    <ServiceContext.Provider value={service}>
      <AIGatewayContext.Provider value={aiGateway}>
        <AnalysisSessionContext.Provider value={value}>{children}</AnalysisSessionContext.Provider>
      </AIGatewayContext.Provider>
    </ServiceContext.Provider>
  )
}
