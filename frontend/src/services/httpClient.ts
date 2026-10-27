import { accessSession } from './accessSession'
import { ApiError } from './errors'

/**
 * Cliente HTTP mínimo sobre `fetch` para hablar con FastAPI.
 * Centraliza la URL base, los encabezados, los tiempos de espera y el
 * formato de errores (`{ "detail": "..." }`, propio de FastAPI).
 *
 * Si hay una sesión de invitación, agrega `Authorization: Bearer <token>`. Una
 * respuesta 401 cierra la sesión local para que se vuelva a pedir el código.
 */

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: unknown
  /** Tiempo máximo de espera en milisegundos. */
  timeoutMs?: number
  signal?: AbortSignal
}

interface FastApiErrorBody {
  detail?: string | Array<{ msg?: string }>
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as FastApiErrorBody
    if (typeof body.detail === 'string') return body.detail
    if (Array.isArray(body.detail) && body.detail[0]?.msg) return body.detail[0].msg
  } catch {
    // La respuesta no era JSON: se usa el mensaje genérico.
  }
  return `El servidor respondió con un error (${response.status}).`
}

export class HttpClient {
  private readonly baseUrl: string

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, '')
  }

  private async send(path: string, options: RequestOptions = {}): Promise<Response> {
    const { method = 'GET', body, timeoutMs = 30_000, signal } = options
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    signal?.addEventListener('abort', () => controller.abort())

    const isFormData = body instanceof FormData
    const headers: Record<string, string> = { Accept: 'application/json' }
    if (body !== undefined && !isFormData) headers['Content-Type'] = 'application/json'
    const token = accessSession.token()
    if (token) headers.Authorization = `Bearer ${token}`

    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : isFormData ? body : JSON.stringify(body),
        signal: controller.signal,
      })
      if (!response.ok) {
        const message = await readErrorMessage(response)
        if (response.status === 401 && token) {
          accessSession.clear()
          throw new ApiError(message, { status: 401, code: 'unauthenticated' })
        }
        throw new ApiError(message, { status: response.status })
      }
      return response
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new ApiError('La solicitud tardó demasiado y fue cancelada.', { code: 'timeout' })
      }
      throw error
    } finally {
      clearTimeout(timeout)
    }
  }

  async json<T>(path: string, options?: RequestOptions): Promise<T> {
    const response = await this.send(path, options)
    return (await response.json()) as T
  }

  /** Para respuestas sin cuerpo (por ejemplo, 204). */
  async empty(path: string, options?: RequestOptions): Promise<void> {
    await this.send(path, options)
  }

  async blob(path: string, options?: RequestOptions): Promise<{ blob: Blob; fileName: string | null }> {
    const response = await this.send(path, options)
    const disposition = response.headers.get('Content-Disposition') ?? ''
    const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition)
    return { blob: await response.blob(), fileName: match ? decodeURIComponent(match[1]) : null }
  }
}
