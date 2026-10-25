import { useMemo, useState } from 'react'
import { Ban, ShieldCheck, X } from 'lucide-react'
import { Alert } from '@/components/ui/Alert'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardHeader } from '@/components/ui/Card'
import { buildAIContext, contextProblem, defaultReview, MAX_OBJECTIVE_CHARS, NEVER_SENT, type SourceReview } from '@/lib/aiContext'
import { buildDatasetCatalog, type AnalysisSource } from '@/lib/datasetCatalog'
import { useAIAuthorization } from '@/hooks/useAIAuthorization'
import type { AIGatewayClient } from '@/services/aiGateway'

interface AIContextReviewProps {
  sources: AnalysisSource[]
  /** null en la demo pública: no existe conexión alguna. */
  gateway: AIGatewayClient | null
  onClose?: () => void
  /** Modo no controlado (panel del asistente): valores iniciales. */
  initialObjective?: string
  initialReview?: SourceReview[]
  /** Modo controlado (pantalla de revisión): el estado vive en la sesión del análisis. */
  objective?: string
  onObjectiveChange?: (objective: string) => void
  review?: SourceReview[]
  onReviewChange?: (review: SourceReview[]) => void
  objectiveLabel?: string
  /** Integrado en una página: sin botón de cerrar ni "Cancelar". */
  embedded?: boolean
}

/**
 * Revisión de privacidad antes de cualquier envío a la IA (Fase 3B.1).
 * Nada se transmite automáticamente: el usuario edita el contenido, el backend
 * lo valida contra una lista blanca y solo después puede autorizar ESE envío.
 */
export function AIContextReview({
  sources,
  gateway,
  onClose,
  initialObjective = '',
  initialReview,
  objective: objectiveProp,
  onObjectiveChange,
  review: reviewProp,
  onReviewChange,
  objectiveLabel = 'Objetivo que se compartiría',
  embedded = false,
}: AIContextReviewProps) {
  const catalog = useMemo(() => buildDatasetCatalog(sources), [sources])
  const [ownObjective, setOwnObjective] = useState(initialObjective)
  const [ownReview, setOwnReview] = useState<SourceReview[]>(() => initialReview ?? defaultReview(catalog))
  const objective = objectiveProp ?? ownObjective
  const review = reviewProp ?? ownReview
  const setObjective = (value: string) => (onObjectiveChange ? onObjectiveChange(value) : setOwnObjective(value))
  const setReview = (update: (current: SourceReview[]) => SourceReview[]) => {
    const next = update(review)
    if (onReviewChange) onReviewChange(next)
    else setOwnReview(next)
  }
  const payload = useMemo(() => buildAIContext(catalog, objective, review), [catalog, objective, review])
  const problem = contextProblem(payload)
  // Cualquier cambio del contenido invalida lo validado (lo resuelve el hook).
  const { status, prepared, busy, result, prepare, authorize, cancel } = useAIAuthorization(gateway, payload)

  function updateColumn(alias: string, column: string, changes: Partial<{ include: boolean; name: string }>) {
    setReview((current) =>
      current.map((r) =>
        r.alias === alias ? { ...r, columns: { ...r.columns, [column]: { ...r.columns[column], ...changes } } } : r,
      ),
    )
  }

  async function handlePrepare() {
    if (!problem) await prepare()
  }

  function handleCancel() {
    cancel()
    onClose?.()
  }

  const shown = prepared?.payload ?? payload

  return (
    <Card role="region" aria-label="Revisión de privacidad para la IA">
      <CardHeader
        icon={<ShieldCheck className="size-4" aria-hidden />}
        title="Revisá qué se compartiría con la IA"
        description="Nada se envía automáticamente. Elegí qué columnas compartir, revisá el objetivo y mirá el contenido exacto antes de autorizar."
        actions={
          !embedded && (
            <button type="button" onClick={handleCancel} aria-label="Cerrar revisión" className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100">
              <X className="size-4" aria-hidden />
            </button>
          )
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
              {objectiveLabel}
            </label>
            <textarea
              id="ai-objective"
              value={objective}
              maxLength={MAX_OBJECTIVE_CHARS}
              onChange={(e) => setObjective(e.target.value)}
              rows={3}
              placeholder="Ej.: Quiero saber qué productos se venden más en cada región"
              className="mt-1.5 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-4 focus:ring-blue-100 focus:outline-none"
            />
            <p className="mt-1 text-xs text-slate-400">
              Escribilo con tus palabras, una sola vez: no hace falta explicar cálculos, gráficos ni reportes. Quitá
              nombres, cifras u otros datos que no quieras compartir.
            </p>
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
                    onChange={(e) =>
                      setReview((current) => current.map((r) => (r.alias === source.alias ? { ...r, includeSize: e.target.checked } : r)))
                    }
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
          <pre data-testid="ai-payload-preview" tabIndex={0} aria-label="Contenido exacto en formato JSON" className="scrollbar-thin max-h-[min(24rem,50vh)] overflow-auto rounded-xl bg-navy-950 p-3 text-[11px] leading-relaxed text-slate-100">
            {JSON.stringify(shown, null, 2)}
          </pre>
          {prepared && (
            <p className="break-all text-[11px] text-slate-500">
              Huella SHA-256: {prepared.payload_sha256} · vence en {Math.round(prepared.expires_in_seconds / 60)} min · autorización de un solo uso
            </p>
          )}
          {problem && <Alert tone="warning">{problem}</Alert>}
          {result && <Alert tone={result.tone}>{result.text}</Alert>}
          {embedded ? (
            // En la revisión (acción A) no se autoriza ningún envío: eso ocurre mensaje por mensaje en el asistente.
            <p className="text-xs text-slate-500">
              Confirmar la revisión no envía nada. Cada envío a la IA se autoriza por separado en el asistente.
            </p>
          ) : (
          <div className="flex flex-wrap gap-2">
            {result?.final ? null : !prepared ? (
              <Button onClick={() => void handlePrepare()} disabled={!gateway || !!problem} loading={busy}>
                Validar contenido
              </Button>
            ) : (
              <Button onClick={() => void authorize()} loading={busy}>
                Autorizar este envío
              </Button>
            )}
            <Button variant="ghost" onClick={handleCancel} disabled={busy}>
              Cancelar
            </Button>
          </div>
          )}
        </div>
      </div>
    </Card>
  )
}
