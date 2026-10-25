import { useEffect, useRef, useState } from 'react'
import type { AIContextPayload } from '@/lib/aiContext'
import { ApiError, getErrorMessage } from '@/services'
import type { AIGatewayClient, AIStatus, PreparedAIRequest } from '@/services/aiGateway'

export interface AuthorizationResult {
  tone: 'info' | 'error' | 'success'
  text: string
  /** Autorización ya usada para este contenido: no se ofrece repetirla. */
  final: boolean
}

export const TEST_FINISHED_DISABLED = 'Prueba finalizada. La IA está deshabilitada y no se envió ningún dato.'
export const TEST_FINISHED_NOT_IMPLEMENTED =
  'Prueba finalizada. La conexión con OpenAI todavía no está implementada y no se envió ningún dato.'

/**
 * Flujo de autorización de UN envío a la IA: validar → revisar → autorizar.
 *
 * - Nada se envía solo: `prepare` solo pide al backend que valide (lista blanca).
 * - Si el contenido cambia (contexto o mensaje), lo preparado se cancela.
 * - Al desmontar la pantalla, lo preparado también se cancela.
 * - La autorización es de un solo uso. Su resultado queda visible mientras el
 *   contenido sea el mismo; un contenido distinto empieza de cero.
 */
export function useAIAuthorization(gateway: AIGatewayClient | null, payload: AIContextPayload) {
  const [status, setStatus] = useState<AIStatus | null>(null)
  const [prepared, setPrepared] = useState<PreparedAIRequest | null>(null)
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState<(AuthorizationResult & { key: string }) | null>(null)

  const key = JSON.stringify(payload)
  const preparedRef = useRef<{ request: PreparedAIRequest; key: string } | null>(null)

  const cancelPending = () => {
    const pending = preparedRef.current
    preparedRef.current = null
    if (pending && gateway) void gateway.cancel(pending.request.request_id).catch(() => undefined)
  }

  useEffect(() => {
    if (!gateway) return
    gateway.status().then(setStatus, () => setStatus(null))
  }, [gateway])

  // Contenido distinto del validado: la validación anterior deja de valer.
  useEffect(() => {
    if (preparedRef.current && preparedRef.current.key !== key) {
      cancelPending()
      setPrepared(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => () => cancelPending(), [gateway])

  async function prepare() {
    if (!gateway) return
    setBusy(true)
    setOutcome(null)
    try {
      const request = await gateway.prepare(payload)
      preparedRef.current = { request, key }
      setPrepared(request)
    } catch (err) {
      setOutcome({ tone: 'error', text: getErrorMessage(err), final: false, key })
    } finally {
      setBusy(false)
    }
  }

  async function authorize() {
    const pending = preparedRef.current
    if (!gateway || !pending) return
    setBusy(true)
    preparedRef.current = null // uso único, pase lo que pase
    try {
      await gateway.authorize(pending.request.request_id, pending.request.payload_sha256)
      setOutcome({ tone: 'success', text: 'Envío autorizado y realizado.', final: true, key: pending.key })
    } catch (err) {
      setOutcome({ ...describeRejection(err, status), final: true, key: pending.key })
    } finally {
      setPrepared(null)
      setBusy(false)
    }
  }

  function cancel() {
    cancelPending()
    setPrepared(null)
    setOutcome(null)
  }

  // El resultado corresponde a un contenido concreto: si el usuario lo cambia, deja de mostrarse.
  const result: AuthorizationResult | null = outcome && outcome.key === key ? outcome : null
  return { status, prepared, busy, result, prepare, authorize, cancel }
}

/** 403 (IA deshabilitada) y 501 (Fase 3B.2 pendiente) son el final esperado de una prueba. */
function describeRejection(err: unknown, status: AIStatus | null): Pick<AuthorizationResult, 'tone' | 'text'> {
  const httpStatus = err instanceof ApiError ? err.status : null
  if (httpStatus === 403 || (httpStatus === null && status?.ai_enabled === false)) {
    return { tone: 'info', text: TEST_FINISHED_DISABLED }
  }
  if (httpStatus === 501) return { tone: 'info', text: TEST_FINISHED_NOT_IMPLEMENTED }
  return { tone: 'error', text: getErrorMessage(err) }
}
