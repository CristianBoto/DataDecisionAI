import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { DataDecisionService } from '@/services'
import { service as defaultService } from '@/services'
import type { Dataset, DatasetProfile } from '@/types/domain'
import { MAX_SOURCES } from '@/lib/datasetCatalog'
import type { AIGatewayClient } from '@/services/aiGateway'
import type { AnalysisEngineClient } from '@/services/analysisEngine'
import { AIGatewayContext, AnalysisEngineContext, defaultAIGateway, defaultAnalysisEngine, ServiceContext } from './serviceContext'
import { AnalysisSessionContext, type AnalysisSessionState } from './sessionContext'

const EMPTY_SESSION: AnalysisSessionState = {
  sources: [],
  projectId: null,
  projectName: '',
  review: null,
  reviewConfirmed: false,
  aiChat: [],
  approvedPlanIds: [],
  confirmedPlanIds: [],
  aiConversationGrant: null,
  analysisRun: null,
}
// Lo que depende de la frontera de privacidad: conversación, planes y permiso de conversación.
const CONVERSATION_RESET = { aiChat: [], approvedPlanIds: [], confirmedPlanIds: [], aiConversationGrant: null, analysisRun: null }
// Cambiar las fuentes obliga a revisar de nuevo, a crear otro proyecto y a empezar otra conversación.
const SOURCES_CHANGED = { projectId: null, review: null, reviewConfirmed: false, ...CONVERSATION_RESET }

interface AppProvidersProps {
  children: ReactNode
  service?: DataDecisionService
  /** Cliente de la frontera de IA; null = sin conexión (demo pública). */
  aiGateway?: AIGatewayClient | null
  /** Motor de análisis con Pandas; null = sin backend (demo pública). */
  analysisEngine?: AnalysisEngineClient | null
}

export function AppProviders({
  children,
  service = defaultService,
  aiGateway = defaultAIGateway,
  analysisEngine = defaultAnalysisEngine,
}: AppProvidersProps) {
  const [session, setSession] = useState<AnalysisSessionState>(EMPTY_SESSION)

  // Cambiar las fuentes implica empezar un proyecto nuevo.
  const addSource = useCallback((dataset: Dataset, profile: DatasetProfile, file?: File) => {
    setSession((current) => ({
      ...current,
      ...SOURCES_CHANGED,
      sources: [...current.sources, { dataset, profile, file }].slice(0, MAX_SOURCES),
    }))
  }, [])
  const replaceSource = useCallback((datasetId: string, dataset: Dataset, profile: DatasetProfile, file?: File) => {
    setSession((current) => ({
      ...current,
      ...SOURCES_CHANGED,
      sources: current.sources.map((s) => (s.dataset.id === datasetId ? { dataset, profile, file } : s)),
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
    // Cambiar la revisión cambia la frontera de privacidad: el permiso de conversación deja de valer.
    setSession((current) => ({ ...current, review, reviewConfirmed: false, projectId: null, ...CONVERSATION_RESET }))
  }, [])
  const appendAIChat = useCallback((turns: AnalysisSessionState['aiChat']) => {
    setSession((current) => ({ ...current, aiChat: [...current.aiChat, ...turns] }))
  }, [])
  const markPlanApproved = useCallback((planId: string) => {
    setSession((current) =>
      current.approvedPlanIds.includes(planId) ? current : { ...current, approvedPlanIds: [...current.approvedPlanIds, planId] },
    )
  }, [])
  const confirmPlans = useCallback((planIds: string[]) => {
    setSession((current) => ({ ...current, confirmedPlanIds: planIds.filter((id) => current.approvedPlanIds.includes(id)) }))
  }, [])
  const setAIConversationGrant = useCallback((aiConversationGrant: AnalysisSessionState['aiConversationGrant']) => {
    setSession((current) => ({ ...current, aiConversationGrant }))
  }, [])
  const setAnalysisRun = useCallback((analysisRun: AnalysisSessionState['analysisRun']) => {
    setSession((current) => ({ ...current, analysisRun }))
  }, [])

  // Un permiso que se descarta (revocación, cambio de fuentes o de revisión) también se revoca en el backend.
  const grantId = session.aiConversationGrant?.id ?? null
  const previousGrant = useRef<string | null>(null)
  useEffect(() => {
    const previous = previousGrant.current
    previousGrant.current = grantId
    if (previous && previous !== grantId) void aiGateway?.revokeConversation?.(previous).catch(() => undefined)
  }, [grantId, aiGateway])

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
      appendAIChat,
      markPlanApproved,
      confirmPlans,
      setAIConversationGrant,
      setAnalysisRun,
      reset,
    }),
    [
      session,
      addSource,
      replaceSource,
      removeSource,
      setProjectId,
      setProjectName,
      setReview,
      confirmReview,
      appendAIChat,
      markPlanApproved,
      confirmPlans,
      setAIConversationGrant,
      setAnalysisRun,
      reset,
    ],
  )

  return (
    <ServiceContext.Provider value={service}>
      <AIGatewayContext.Provider value={aiGateway}>
        <AnalysisEngineContext.Provider value={analysisEngine}>
          <AnalysisSessionContext.Provider value={value}>{children}</AnalysisSessionContext.Provider>
        </AnalysisEngineContext.Provider>
      </AIGatewayContext.Provider>
    </ServiceContext.Provider>
  )
}
