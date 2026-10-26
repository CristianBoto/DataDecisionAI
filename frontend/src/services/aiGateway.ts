import { appConfig } from '@/lib/config'
import type { AIContextPayload } from '@/lib/aiContext'
import { HttpClient } from './httpClient'

/**
 * Cliente de la frontera de IA del backend (Fase 3B.1).
 *
 * El navegador NUNCA llama a OpenAI ni conoce la clave: solo pide al backend
 * que valide un contexto (lista blanca), lo muestra y, si el usuario lo
 * autoriza, solicita ese envío puntual. Solo entonces el backend puede llamar
 * a OpenAI (Fase 3B.2), con límites de consumo y respuesta validada.
 */

export interface AIStatus {
  ai_enabled: boolean
  /** Solo indica si hay clave configurada en el backend; nunca su valor. */
  provider_configured: boolean
  external_calls_implemented: boolean
  model?: string
  budget_usd?: number
  spent_usd?: number
  remaining_usd?: number
  requests_used?: number
  max_requests?: number
  max_output_tokens?: number
  conversation_ttl_minutes?: number
  conversation_max_messages?: number
}

/** IA real disponible: habilitada, con clave y con el proveedor implementado. */
export function isRealAIAvailable(status: AIStatus | null): boolean {
  return Boolean(status?.ai_enabled && status.provider_configured && status.external_calls_implemented)
}

/** Mismo catálogo que el backend (SUPPORTED_OPERATIONS): solo lo que el motor Pandas ejecuta. */
export type AIOperationName =
  | 'count' | 'distinct_count' | 'sum' | 'mean' | 'median' | 'min' | 'max'
  | 'frequency' | 'group_by' | 'compare_groups' | 'time_series' | 'histogram' | 'scatter' | 'roc_curve'

export interface AIPlan {
  source_alias: 'A' | 'B' | 'C'
  title: string
  rationale: string
  columns_needed: string[]
  operations: { operation: AIOperationName; columns: string[]; group_by: string[]; description: string }[]
  charts: { type: string; x: string | null; y: string | null; title: string }[]
  limitations: string[]
}

export interface AIReply {
  message: string
  interpreted_objective: string
  source_relationship: 'single' | 'independent' | 'compare' | 'concatenate' | 'relate' | 'unclear'
  questions: { question: string; reason: string; source_alias: string | null; column: string | null }[]
  plans: AIPlan[]
  warnings: string[]
}

export interface AIUsage {
  model: string
  input_tokens: number
  output_tokens: number
  cost_usd: number
  remaining_usd: number
}

/** Permiso para los próximos mensajes de una conversación (lo controla el backend). */
export interface AIConversationPermission {
  conversation_id: string
  expires_in_seconds: number
  max_messages: number
}

/** Respuesta validada por el backend contra el contexto autorizado. */
export interface AIAuthorizeResult {
  reply: AIReply
  plan_ids: string[]
  usage: AIUsage
  /** Solo si el usuario eligió autorizar la conversación. */
  conversation?: AIConversationPermission
}

/** "message": solo este envío. "conversation": además, los próximos mensajes de la conversación. */
export type AIAuthorizationScope = 'message' | 'conversation'

export interface PreparedAIRequest {
  request_id: string
  /** Contenido EXACTO validado por el backend: es lo que se aprueba. */
  payload: AIContextPayload
  payload_sha256: string
  expires_in_seconds: number
  ai_enabled: boolean
  external_calls_implemented: boolean
  /** Estimación previa: el consumo real puede diferir. */
  estimated_input_tokens?: number
  estimated_max_cost_usd?: number | null
}

export interface AIGatewayClient {
  status(): Promise<AIStatus>
  prepare(payload: AIContextPayload): Promise<PreparedAIRequest>
  authorize(requestId: string, payloadSha256: string, scope?: AIAuthorizationScope): Promise<unknown>
  cancel(requestId: string): Promise<void>
  /** Mensaje dentro de una conversación autorizada (el backend verifica el permiso y los límites). */
  sendInConversation?(conversationId: string, payload: AIContextPayload): Promise<AIAuthorizeResult>
  /** Revoca el permiso de la conversación. */
  revokeConversation?(conversationId: string): Promise<void>
  /** Registra la aprobación de un plan validado. No ejecuta cálculos. */
  approvePlan?(planId: string): Promise<{ plan_id: string; status: string; executed: boolean }>
}

export function createAIGatewayClient(baseUrl: string): AIGatewayClient {
  const http = new HttpClient(baseUrl)
  const id = encodeURIComponent
  return {
    status: () => http.json<AIStatus>('/api/ai/status'),
    prepare: (payload) => http.json<PreparedAIRequest>('/api/ai/requests', { method: 'POST', body: payload }),
    authorize: (requestId, payloadSha256, scope = 'message') =>
      http.json(`/api/ai/requests/${id(requestId)}/authorize`, {
        method: 'POST',
        body: { payload_sha256: payloadSha256, confirm: true, scope },
      }),
    sendInConversation: (conversationId, payload) =>
      http.json<AIAuthorizeResult>(`/api/ai/conversations/${id(conversationId)}/messages`, { method: 'POST', body: payload }),
    revokeConversation: (conversationId) =>
      http.empty(`/api/ai/conversations/${id(conversationId)}`, { method: 'DELETE' }),
    cancel: (requestId) => http.empty(`/api/ai/requests/${id(requestId)}`, { method: 'DELETE' }),
    approvePlan: (planId) => http.json(`/api/ai/plans/${id(planId)}/approve`, { method: 'POST', body: {} }),
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
