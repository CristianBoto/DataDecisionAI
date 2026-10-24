import { appConfig } from '@/lib/config'
import { createDemoService } from './demoProvider'
import { createHttpService } from './httpProvider'
import type { DataDecisionService } from './types'

/**
 * Punto único de acceso a los datos. VITE_DEMO_MODE decide qué
 * implementación se usa; el resto de la app no necesita saberlo.
 */
export function createService(demoMode: boolean = appConfig.demoMode): DataDecisionService {
  return demoMode ? createDemoService() : createHttpService(appConfig.apiBaseUrl)
}

export const service: DataDecisionService = createService()

export type { DataDecisionService } from './types'
export { ApiError, BackendRequiredError, getErrorMessage, isBackendRequiredError } from './errors'
