import { useContext } from 'react'
import { AnalysisSessionContext } from '@/context/sessionContext'

export function useAnalysisSession() {
  const value = useContext(AnalysisSessionContext)
  if (!value) throw new Error('useAnalysisSession debe usarse dentro de <AppProviders>.')
  return value
}
