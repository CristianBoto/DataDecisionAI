import { useCallback, useMemo, useState, type ReactNode } from 'react'
import type { DataDecisionService } from '@/services'
import { service as defaultService } from '@/services'
import type { Dataset, DatasetProfile } from '@/types/domain'
import { ServiceContext } from './serviceContext'
import { AnalysisSessionContext, type AnalysisSessionState } from './sessionContext'

const EMPTY_SESSION: AnalysisSessionState = { dataset: null, profile: null, projectId: null }

interface AppProvidersProps {
  children: ReactNode
  service?: DataDecisionService
}

export function AppProviders({ children, service = defaultService }: AppProvidersProps) {
  const [session, setSession] = useState<AnalysisSessionState>(EMPTY_SESSION)

  const setDataset = useCallback((dataset: Dataset, profile: DatasetProfile) => {
    // Un dataset nuevo implica empezar un proyecto nuevo.
    setSession({ dataset, profile, projectId: null })
  }, [])
  const setProjectId = useCallback((projectId: string) => {
    setSession((current) => ({ ...current, projectId }))
  }, [])
  const reset = useCallback(() => setSession(EMPTY_SESSION), [])

  const value = useMemo(
    () => ({ ...session, setDataset, setProjectId, reset }),
    [session, setDataset, setProjectId, reset],
  )

  return (
    <ServiceContext.Provider value={service}>
      <AnalysisSessionContext.Provider value={value}>{children}</AnalysisSessionContext.Provider>
    </ServiceContext.Provider>
  )
}
