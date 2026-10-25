import { appConfig } from '@/lib/config'
import type { AIContextPayload } from '@/lib/aiContext'
import { HttpClient } from './httpClient'

/**
 * Cliente de la frontera de IA del backend (Fase 3B.1).
 *
 * El navegador NUNCA llama a OpenAI ni conoce la clave: solo pide al backend
 * que valide un contexto (lista blanca), lo muestra y, si el usuario lo
 * autoriza, solicita ese envío puntual. En esta fase el backend no realiza
 * llamadas externas.
 */

export interface AIStatus {
  ai_enabled: boolean
  provider_configured: boolean
  external_calls_implemented: boolean
}

export interface PreparedAIRequest {
  request_id: string
  /** Contenido EXACTO validado por el backend: es lo que se aprueba. */
  payload: AIContextPayload
  payload_sha256: string
  expires_in_seconds: number
  ai_enabled: boolean
  external_calls_implemented: boolean
}

export interface AIGatewayClient {
  status(): Promise<AIStatus>
  prepare(payload: AIContextPayload): Promise<PreparedAIRequest>
  authorize(requestId: string, payloadSha256: string): Promise<unknown>
  cancel(requestId: string): Promise<void>
}

export function createAIGatewayClient(baseUrl: string): AIGatewayClient {
  const http = new HttpClient(baseUrl)
  const id = encodeURIComponent
  return {
    status: () => http.json<AIStatus>('/api/ai/status'),
    prepare: (payload) => http.json<PreparedAIRequest>('/api/ai/requests', { method: 'POST', body: payload }),
    authorize: (requestId, payloadSha256) =>
      http.json(`/api/ai/requests/${id(requestId)}/authorize`, {
        method: 'POST',
        body: { payload_sha256: payloadSha256, confirm: true },
      }),
    cancel: (requestId) => http.empty(`/api/ai/requests/${id(requestId)}`, { method: 'DELETE' }),
  }
}

/**
 * Solo existe con un backend propio (instalación privada o perfilado local).
 * En la demo pública es null: no hay ninguna conexión que pueda usarse.
 */
export function createDefaultAIGateway(): AIGatewayClient | null {
  const hasBackend = !appConfig.demoMode || appConfig.backendProfiling
  return hasBackend ? createAIGatewayClient(appConfig.apiBaseUrl) : null
}
