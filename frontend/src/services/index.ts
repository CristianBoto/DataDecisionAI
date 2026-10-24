import { appConfig } from '@/lib/config'
import { createDemoService } from './demoProvider'
import { createHttpService } from './httpProvider'
import { createBackendProfiler } from './backendProfile'
import type { DataDecisionService } from './types'

/**
 * Punto único de acceso a los datos. VITE_DEMO_MODE decide qué
 * implementación se usa; el resto de la app no necesita saberlo.
 * VITE_BACKEND_PROFILING suma, dentro de DEMO, el perfilado real con Pandas.
 */
export function createService(
  demoMode: boolean = appConfig.demoMode,
  backendProfiling: boolean = appConfig.backendProfiling,
): DataDecisionService {
  if (!demoMode) return createHttpService(appConfig.apiBaseUrl)
  return createDemoService(backendProfiling ? { profiler: createBackendProfiler(appConfig.apiBaseUrl) } : {})
}

export const service: DataDecisionService = createService()

export type { DataDecisionService } from './types'
export { ApiError, BackendRequiredError, getErrorMessage, isBackendRequiredError } from './errors'
