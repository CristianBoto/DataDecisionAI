import { appConfig } from '@/lib/config'
import { createDemoService } from './demoProvider'
import { createBackendProfiler } from './backendProfile'
import type { DataDecisionService } from './types'

/**
 * Punto único de acceso a los datos; el resto de la app no necesita saber cuál se usa.
 *
 * - Demo pública (VITE_DEMO_MODE=true, sin VITE_BACKEND_PROFILING): todo en el navegador.
 * - Con backend local (VITE_BACKEND_PROFILING=true, o VITE_DEMO_MODE=false): sesión
 *   en memoria del navegador + perfilado real con Pandas (`POST /api/datasets/profile`).
 *
 * El backend actual expone solo `/api/health`, `/api/datasets/profile` y `/api/ai/*`.
 * El proveedor HTTP completo (`httpProvider.ts`: `POST /api/datasets`, `/api/projects`…)
 * corresponde a una API de almacenamiento todavía no implementada: usarlo hoy da 404.
 * No se "redirige" esa API al perfilado porque sus contratos son distintos (el
 * perfilado no guarda el archivo ni devuelve un dataset persistido).
 */
export function createService(
  demoMode: boolean = appConfig.demoMode,
  backendProfiling: boolean = appConfig.backendProfiling,
): DataDecisionService {
  // Fuera de la demo pública hay un backend local: el perfilado siempre es real.
  const useBackendProfiling = backendProfiling || !demoMode
  return createDemoService(useBackendProfiling ? { profiler: createBackendProfiler(appConfig.apiBaseUrl) } : {})
}

export const service: DataDecisionService = createService()

export type { DataDecisionService } from './types'
export { ApiError, BackendRequiredError, getErrorMessage, isBackendRequiredError } from './errors'
