/** Error estándar de la capa de servicios, independiente del proveedor. */
export class ApiError extends Error {
  readonly status: number | null
  readonly code: string

  constructor(message: string, options: { status?: number | null; code?: string } = {}) {
    super(message)
    this.name = 'ApiError'
    this.status = options.status ?? null
    this.code = options.code ?? 'api_error'
  }
}

/** La operación existe en la interfaz, pero necesita el backend para funcionar. */
export class BackendRequiredError extends ApiError {
  constructor(message: string) {
    super(message, { code: 'backend_required' })
    this.name = 'BackendRequiredError'
  }
}

export function isBackendRequiredError(error: unknown): error is BackendRequiredError {
  return error instanceof ApiError && error.code === 'backend_required'
}

/** Mensaje legible para mostrar en la interfaz a partir de cualquier error. */
export function getErrorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message
  if (error instanceof TypeError) {
    return 'No se pudo conectar con el servidor. Verificá que el backend esté en ejecución.'
  }
  if (error instanceof Error) return error.message
  return 'Ocurrió un error inesperado.'
}
