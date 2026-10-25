import { useMemo } from 'react'
import { ShieldCheck, ShieldOff } from 'lucide-react'
import type { AnalysisReviewState } from '@/context/sessionContext'
import { Alert } from '@/components/ui/Alert'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { useAIAuthorization } from '@/hooks/useAIAuthorization'
import { buildAIContext } from '@/lib/aiContext'
import { buildDatasetCatalog, type AnalysisSource } from '@/lib/datasetCatalog'
import type { AIGatewayClient } from '@/services/aiGateway'

interface Props {
  sources: AnalysisSource[]
  review: AnalysisReviewState
  /** Texto que el usuario está escribiendo en el chat. */
  message: string
  gateway: AIGatewayClient | null
}

/**
 * Autorización de UN mensaje para la IA real (acción B), separada de la
 * confirmación de la revisión (acción A) y del «Enviar» del asistente DEMO.
 * Contenido: el contexto revisado en el paso 2 + el texto del mensaje. Si
 * cualquiera cambia, la validación anterior se cancela. Sin backend (demo
 * pública) no se muestra: no hay conexión.
 *
 * Diseño compacto: las acciones van antes del JSON, que tiene altura máxima y
 * scroll propio, para que los botones queden a la vista con cualquier zoom.
 */
export function MessageAuthorization({ sources, review, message, gateway }: Props) {
  const catalog = useMemo(() => buildDatasetCatalog(sources), [sources])
  const payload = useMemo(
    () => buildAIContext(catalog, review.objective, review.sources, message),
    [catalog, review, message],
  )
  const { status, prepared, busy, result, prepare, authorize, cancel } = useAIAuthorization(gateway, payload)

  if (!gateway) return null
  const hasMessage = Boolean(payload.message)
  const aiDisabled = status?.ai_enabled === false

  return (
    <details
      className="group rounded-2xl border border-violet-200 bg-violet-50/50 text-xs open:bg-white"
      aria-label="Envío a la IA real"
    >
      <summary className="flex cursor-pointer flex-wrap items-center gap-2 rounded-2xl px-4 py-3 font-medium text-violet-900 focus-visible:ring-4 focus-visible:ring-violet-200 focus-visible:outline-none">
        <ShieldCheck className="size-4 shrink-0" aria-hidden />
        <span>Enviar a la IA real (requiere autorización)</span>
        {status && (
          <Badge tone={status.ai_enabled ? 'green' : 'neutral'}>
            {status.ai_enabled ? 'IA habilitada' : 'IA deshabilitada'}
          </Badge>
        )}
      </summary>

      <div className="space-y-3 border-t border-violet-100 px-4 pt-3 pb-4">
        <p className="text-slate-600">
          Esto es distinto de «Enviar»: el asistente DEMO responde en este equipo. Para OpenAI, cada mensaje se valida y
          autoriza por separado, una sola vez.
        </p>

        {aiDisabled && !result && (
          <p className="flex items-start gap-1.5 rounded-lg bg-slate-100 px-3 py-2 text-slate-700">
            <ShieldOff className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span>
              <strong>Prueba de autorización.</strong> La IA está deshabilitada en este servidor: podés recorrer los pasos,
              pero no habrá respuesta de IA ni se enviará ningún dato.
            </span>
          </p>
        )}

        {result && (
          <Alert tone={result.tone} title={result.final ? 'Resultado de la autorización' : undefined}>
            {result.text}
            {result.final && ' La conversación y tus decisiones se conservan.'}
          </Alert>
        )}

        {!result?.final && (
          <div className="flex flex-wrap items-center gap-2">
            {!prepared ? (
              <Button size="sm" variant="outline" onClick={() => void prepare()} disabled={!hasMessage} loading={busy}>
                Validar este mensaje
              </Button>
            ) : (
              <>
                <Button size="sm" icon={<ShieldCheck className="size-3.5" />} onClick={() => void authorize()} loading={busy}>
                  Autorizar este envío
                </Button>
                <Button size="sm" variant="ghost" onClick={cancel} disabled={busy}>
                  Cancelar
                </Button>
              </>
            )}
            {!hasMessage && <span className="text-slate-500">Escribí un mensaje para revisar su envío.</span>}
          </div>
        )}

        {prepared && <p className="break-all text-[11px] text-slate-500">Huella SHA-256: {prepared.payload_sha256} · un solo uso</p>}

        <div>
          <p className="mb-1 font-medium text-slate-700">Contenido exacto que se enviaría</p>
          <pre
            data-testid="message-payload-preview"
            tabIndex={0}
            role="region"
            aria-label="Contenido exacto en formato JSON"
            className="scrollbar-thin max-h-[min(12rem,30vh)] overflow-auto rounded-lg bg-navy-950 p-2 text-[11px] text-slate-100 focus-visible:ring-4 focus-visible:ring-violet-200 focus-visible:outline-none"
          >
            {JSON.stringify(prepared?.payload ?? payload, null, 2)}
          </pre>
        </div>
      </div>
    </details>
  )
}
