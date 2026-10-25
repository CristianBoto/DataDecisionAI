import { useEffect, useMemo, useState } from 'react'
import { Ban, ShieldCheck, X } from 'lucide-react'
import { Alert } from '@/components/ui/Alert'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardHeader } from '@/components/ui/Card'
import { buildAIContext, contextProblem, defaultReview, MAX_OBJECTIVE_CHARS, NEVER_SENT, type SourceReview } from '@/lib/aiContext'
import { buildDatasetCatalog, type AnalysisSource } from '@/lib/datasetCatalog'
import { getErrorMessage } from '@/services'
import type { AIGatewayClient, AIStatus, PreparedAIRequest } from '@/services/aiGateway'

interface AIContextReviewProps {
  sources: AnalysisSource[]
  initialObjective: string
  /** null en la demo pública: no existe conexión alguna. */
  gateway: AIGatewayClient | null
  onClose: () => void
}

/**
 * Revisión de privacidad antes de cualquier envío a la IA (Fase 3B.1).
 * Nada se transmite automáticamente: el usuario edita el contenido, el backend
 * lo valida contra una lista blanca y solo después puede autorizar ESE envío.
 */
export function AIContextReview({ sources, initialObjective, gateway, onClose }: AIContextReviewProps) {
  const catalog = useMemo(() => buildDatasetCatalog(sources), [sources])
  const [objective, setObjective] = useState(initialObjective)
  const [review, setReview] = useState<SourceReview[]>(() => defaultReview(catalog))
  const [status, setStatus] = useState<AIStatus | null>(null)
  const [prepared, setPrepared] = useState<PreparedAIRequest | null>(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ tone: 'info' | 'error'; text: string } | null>(null)

  const payload = useMemo(() => buildAIContext(catalog, objective, review), [catalog, objective, review])
  const problem = contextProblem(payload)

  useEffect(() => {
    if (!gateway) return
    gateway.status().then(setStatus, () => setStatus(null))
  }, [gateway])

  /** Cualquier cambio invalida lo preparado: hay que volver a revisar. */
  function invalidate() {
    if (prepared && gateway) void gateway.cancel(prepared.request_id).catch(() => undefined)
    setPrepared(null)
    setResult(null)
  }

  function updateColumn(alias: string, column: string, changes: Partial<{ include: boolean; name: string }>) {
    invalidate()
    setReview((current) =>
      current.map((r) =>
        r.alias === alias ? { ...r, columns: { ...r.columns, [column]: { ...r.columns[column], ...changes } } } : r,
      ),
    )
  }

  async function handlePrepare() {
    if (!gateway || problem) return
    setBusy(true)
    setResult(null)
    try {
      setPrepared(await gateway.prepare(payload))
    } catch (err) {
      setResult({ tone: 'error', text: getErrorMessage(err) })
    } finally {
      setBusy(false)
    }
  }

  async function handleAuthorize() {
    if (!gateway || !prepared) return
    setBusy(true)
    try {
      await gateway.authorize(prepared.request_id, prepared.payload_sha256)
      setResult({ tone: 'info', text: 'Envío autorizado y realizado.' })
    } catch (err) {
      // 403 (IA deshabilitada) o 501 (Fase 3B.2 pendiente): el backend explica que no se envió nada.
      setResult({ tone: 'info', text: getErrorMessage(err) })
    } finally {
      setPrepared(null) // la autorización es de uso único
      setBusy(false)
    }
  }

  function handleCancel() {
    invalidate()
    onClose()
  }

  const shown = prepared?.payload ?? payload

  return (
    <Card role="region" aria-label="Revisión de privacidad para la IA">
      <CardHeader
        icon={<ShieldCheck className="size-4" aria-hidden />}
        title="Revisá qué se compartiría con la IA"
        description="Nada se envía automáticamente. Elegí qué columnas compartir, revisá el objetivo y mirá el contenido exacto antes de autorizar."
        actions={
          <button type="button" onClick={handleCancel} aria-label="Cerrar revisión" className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100">
            <X className="size-4" aria-hidden />
          </button>
        }
      />
      <div className="grid gap-6 p-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-5">
          {!gateway ? (
            <Alert tone="warning" title="Demo pública: sin conexión">
              Esta vista solo muestra qué se enviaría. La demo pública no tiene backend ni conexión con ningún servicio externo.
            </Alert>
          ) : (
            status && (
              <p className="text-xs text-slate-500">
                IA externa: <Badge tone={status.ai_enabled ? 'green' : 'neutral'}>{status.ai_enabled ? 'habilitada' : 'deshabilitada'}</Badge>{' '}
                {!status.external_calls_implemented && '· La conexión con OpenAI todavía no está implementada (Fase 3B.2).'}
              </p>
            )
          )}

          <div>
            <label htmlFor="ai-objective" className="text-sm font-semibold text-slate-900">
              Objetivo que se compartiría
            </label>
            <textarea
              id="ai-objective"
              value={objective}
              maxLength={MAX_OBJECTIVE_CHARS}
              onChange={(e) => {
                invalidate()
                setObjective(e.target.value)
              }}
              rows={3}
              className="mt-1.5 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-4 focus:ring-blue-100 focus:outline-none"
            />
            <p className="mt-1 text-xs text-slate-400">Quitá nombres, cifras u otros datos que no quieras compartir.</p>
          </div>

          {catalog.sources.map((source) => {
            const sourceReview = review.find((r) => r.alias === source.alias)
            return (
              <fieldset key={source.alias} className="rounded-xl border border-slate-200 p-3">
                <legend className="px-1 text-sm font-semibold text-slate-900">
                  Fuente {source.alias}{' '}
                  <span className="text-xs font-normal text-slate-400">({source.fileName}: el nombre del archivo no se envía)</span>
                </legend>
                <ul className="scrollbar-thin max-h-56 space-y-1.5 overflow-y-auto">
                  {source.columns.map((c) => {
                    const col = sourceReview?.columns[c.name]
                    return (
                      <li key={c.name} className="flex items-center gap-2 text-xs">
                        <input
                          type="checkbox"
                          checked={col?.include ?? false}
                          onChange={(e) => updateColumn(source.alias, c.name, { include: e.target.checked })}
                          aria-label={`Compartir la columna ${c.name} de la fuente ${source.alias}`}
                        />
                        <input
                          value={col?.name ?? c.name}
                          disabled={!col?.include}
                          onChange={(e) => updateColumn(source.alias, c.name, { name: e.target.value })}
                          aria-label={`Nombre a compartir para ${c.name}`}
                          className="h-7 min-w-0 flex-1 rounded border border-slate-200 px-2 disabled:bg-slate-50 disabled:text-slate-400"
                        />
                      </li>
                    )
                  })}
                </ul>
                <label className="mt-2 flex items-center gap-2 text-xs text-slate-600">
                  <input
                    type="checkbox"
                    checked={sourceReview?.includeSize ?? false}
                    onChange={(e) => {
                      invalidate()
                      setReview((current) => current.map((r) => (r.alias === source.alias ? { ...r, includeSize: e.target.checked } : r)))
                    }}
                  />
                  Compartir solo un rango de tamaño (por ejemplo, «10k-100k» filas)
                </label>
              </fieldset>
            )
          })}

          <div className="rounded-xl bg-slate-50 p-3">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
              <Ban className="size-3.5" aria-hidden /> Nunca se envía
            </p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-slate-600">
              {NEVER_SENT.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        </div>

        <div className="min-w-0 space-y-3">
          <p className="text-sm font-semibold text-slate-900">
            {prepared ? 'Contenido validado por el backend' : 'Contenido exacto que se enviaría'}
          </p>
          <pre data-testid="ai-payload-preview" className="scrollbar-thin max-h-96 overflow-auto rounded-xl bg-navy-950 p-3 text-[11px] leading-relaxed text-slate-100">
            {JSON.stringify(shown, null, 2)}
          </pre>
          {prepared && (
            <p className="break-all text-[11px] text-slate-500">
              Huella SHA-256: {prepared.payload_sha256} · vence en {Math.round(prepared.expires_in_seconds / 60)} min · autorización de un solo uso
            </p>
          )}
          {problem && <Alert tone="warning">{problem}</Alert>}
          {result && <Alert tone={result.tone}>{result.text}</Alert>}
          <div className="flex flex-wrap gap-2">
            {!prepared ? (
              <Button onClick={() => void handlePrepare()} disabled={!gateway || !!problem} loading={busy}>
                Validar contenido
              </Button>
            ) : (
              <Button onClick={() => void handleAuthorize()} loading={busy}>
                Autorizar este envío
              </Button>
            )}
            <Button variant="ghost" onClick={handleCancel} disabled={busy}>
              Cancelar
            </Button>
          </div>
        </div>
      </div>
    </Card>
  )
}
