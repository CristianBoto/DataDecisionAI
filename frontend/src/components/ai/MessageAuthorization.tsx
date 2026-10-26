import { useEffect, useMemo } from 'react'
import { ShieldCheck } from 'lucide-react'
import type { AnalysisReviewState } from '@/context/sessionContext'
import { Alert } from '@/components/ui/Alert'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { useAIAuthorization } from '@/hooks/useAIAuthorization'
import { buildAIContext, type AIHistoryTurn } from '@/lib/aiContext'
import { buildDatasetCatalog, type AnalysisSource } from '@/lib/datasetCatalog'
import type { AIAuthorizationScope, AIAuthorizeResult, AIGatewayClient } from '@/services/aiGateway'

interface AuthorizedSendProps {
  sources: AnalysisSource[]
  review: AnalysisReviewState
  /** Mensaje que el usuario quiere enviar (el objetivo, al comenzar). */
  message: string
  history: AIHistoryTurn[]
  gateway: AIGatewayClient
  onSent: (result: AIAuthorizeResult) => void
  onCancel: () => void
  /** Aviso cuando hace falta autorizar de nuevo (permiso vencido, revocado o configuración cambiada). */
  notice?: string | null
}

/**
 * Envío a la IA real (modo IA habilitada). El contenido se valida en el
 * backend apenas se pide enviar (sin llamadas externas) y se muestra con su
 * costo máximo estimado. Solo una autorización explícita (este mensaje o esta
 * conversación) llega a OpenAI.
 */
export function AuthorizedSend({ sources, review, message, history, gateway, onSent, onCancel, notice }: AuthorizedSendProps) {
  const catalog = useMemo(() => buildDatasetCatalog(sources), [sources])
  const payload = useMemo(
    () => buildAIContext(catalog, review.objective, review.sources, message, history),
    [catalog, review, message, history],
  )
  const { status, prepared, busy, result, prepare, authorize, cancel } = useAIAuthorization(gateway, payload)
  const key = JSON.stringify(payload)

  // Validar no envía nada: solo pide al backend que revise la lista blanca y estime el costo.
  useEffect(() => {
    void prepare()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  async function send(scope: AIAuthorizationScope) {
    const response = (await authorize(scope)) as AIAuthorizeResult | null
    if (response) onSent(response)
  }
  const canAuthorizeConversation = Boolean(gateway.sendInConversation)
  const ttl = status?.conversation_ttl_minutes ?? 30
  const maxMessages = status?.conversation_max_messages ?? 20

  function close() {
    cancel()
    onCancel()
  }

  const cost = prepared?.estimated_max_cost_usd
  return (
    <section
      aria-label="Autorizar envío a OpenAI"
      className="space-y-3 rounded-2xl border border-violet-200 bg-white p-4 text-xs shadow-sm"
    >
      <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-violet-900">
        <ShieldCheck className="size-4" aria-hidden /> Revisá y autorizá este envío a OpenAI
        {status?.model && <Badge tone="neutral">{status.model}</Badge>}
      </p>
      <p className="rounded-lg bg-slate-50 px-3 py-2 text-slate-700">
        <span className="font-medium">Mensaje:</span> {payload.message ?? payload.objective}
        {!payload.message && <span className="text-slate-500"> (tu objetivo confirmado)</span>}
      </p>
      {prepared && (
        <p className="text-slate-600">
          Costo máximo estimado: <strong>USD {cost != null ? cost.toFixed(4) : '—'}</strong>
          {status?.remaining_usd != null && <> · Presupuesto local disponible: USD {status.remaining_usd.toFixed(4)}</>}
          <span className="block text-slate-500">
            Es una estimación con la salida máxima permitida; el consumo real puede diferir y se informa con la respuesta.
          </span>
        </p>
      )}
      {notice && <Alert tone="warning" title="Se requiere nueva autorización">{notice}</Alert>}
      {result && !result.final && <Alert tone={result.tone}>{result.text}</Alert>}
      {prepared ? (
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="rounded-xl border border-slate-200 p-3">
            <Button size="sm" variant="outline" icon={<ShieldCheck className="size-3.5" />} onClick={() => void send('message')} loading={busy}>
              Autorizar solo este mensaje
            </Button>
            <p className="mt-1.5 text-slate-500">Cada mensaje siguiente vuelve a pedir tu autorización (opción más restrictiva).</p>
          </div>
          {canAuthorizeConversation && (
            <div className="rounded-xl border border-violet-200 bg-violet-50/50 p-3">
              <Button size="sm" icon={<ShieldCheck className="size-3.5" />} onClick={() => void send('conversation')} loading={busy}>
                Autorizar esta conversación
              </Button>
              <p className="mt-1.5 text-slate-600">
                Los próximos mensajes que envíes voluntariamente irán a OpenAI sin mostrar este panel. Cada envío comparte
                tu nuevo mensaje y un historial limitado de la conversación, además del objetivo y los metadatos ya
                autorizados. Vence a los {ttl} minutos o tras {maxMessages} mensajes, se anula si cambiás la
                configuración de datos y podés desactivarla cuando quieras.
              </p>
            </div>
          )}
        </div>
      ) : (
        <Button size="sm" variant="outline" onClick={() => void prepare()} loading={busy}>
          Validar de nuevo
        </Button>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="ghost" onClick={close} disabled={busy}>
          Cancelar
        </Button>
        <span className="text-slate-500">Los límites de tokens, solicitudes y presupuesto se aplican siempre en el backend.</span>
      </div>
      <details>
        <summary className="cursor-pointer font-medium text-slate-700">Ver el contenido exacto (JSON)</summary>
        <pre
          data-testid="authorized-payload-preview"
          tabIndex={0}
          role="region"
          aria-label="Contenido exacto que se enviaría a OpenAI"
          className="scrollbar-thin mt-1 max-h-[min(12rem,30vh)] overflow-auto rounded-lg bg-navy-950 p-2 text-[11px] text-slate-100"
        >
          {JSON.stringify(prepared?.payload ?? payload, null, 2)}
        </pre>
      </details>
    </section>
  )
}
