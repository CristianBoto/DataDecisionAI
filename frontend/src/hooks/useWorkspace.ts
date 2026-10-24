import { useOutletContext } from 'react-router-dom'
import type { AnalysisResults, DatasetProfile, Project } from '@/types/domain'
import type { AsyncState } from './useAsync'

/** Datos que el WorkspaceLayout comparte con sus páginas hijas. */
export interface WorkspaceContextValue {
  project: Project
  profile: DatasetProfile
  results: AsyncState<AnalysisResults> & { retry: () => void }
  openAssistant: () => void
}

export function useWorkspace() {
  return useOutletContext<WorkspaceContextValue>()
}
