/**
 * Configuración leída de variables de entorno de Vite.
 * Nunca colocar secretos aquí: todo lo que empieza con VITE_ llega al navegador.
 */

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === '') return fallback
  return ['true', '1', 'yes', 'si', 'sí'].includes(value.trim().toLowerCase())
}

function parsePositiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

export const appConfig = {
  /** Modo DEMO activo por defecto para que la app funcione sin backend. */
  demoMode: parseBoolean(import.meta.env.VITE_DEMO_MODE, true),
  /**
   * Perfilado real con FastAPI + Pandas (POST /api/datasets/profile) aunque el
   * resto de la app siga en DEMO. Desactivado por defecto: la demo pública no
   * debe definirlo para que no haya llamadas al backend.
   */
  backendProfiling: parseBoolean(import.meta.env.VITE_BACKEND_PROFILING, false),
  apiBaseUrl: (import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000').replace(/\/+$/, ''),
  maxUploadMb: parsePositiveNumber(import.meta.env.VITE_MAX_UPLOAD_MB, 25),
} as const

export { parseBoolean, parsePositiveNumber }
