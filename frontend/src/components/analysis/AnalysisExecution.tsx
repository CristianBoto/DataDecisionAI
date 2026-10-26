import { useEffect, useMemo, useRef, useState } from 'react'
import { Play } from 'lucide-react'
import { Spinner } from '@/components/ui/Feedback'
import { AnalysisResults } from '@/components/analysis/AnalysisResults'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { useAnalysisSession } from '@/hooks/useAnalysisSession'
import { useAnalysisEngine } from '@/hooks/useService'
import type { SessionAIPlan } from '@/lib/aiPlans'
import { buildExecution, quantitativeColumns, rocLabelColumns, unitKey } from '@/lib/analysisRequest'
import { buildDatasetCatalog } from '@/lib/datasetCatalog'
import { getErrorMessage } from '@/services'

/**
 * «Ejecutar análisis» (Fase 4A). Solo aparece después de la confirmación final.
 * Envía los archivos originales y los planes aprobados al motor Pandas del
 * backend. No consulta a la IA: es una acción distinta de autorizar envíos a OpenAI.
 */
export function AnalysisExecution({ plans }: { plans: SessionAIPlan[] }) {
  const session = useAnalysisSession()
  const engine = useAnalysisEngine()
  const [units, setUnits] = useState<Record<string, string>>({})
  const [positives, setPositives] = useState<Record<string, string>>({})
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const review = session.review
  const prepared = useMemo(
    () => (review ? buildExecution(session.sources, review, plans, units, positives) : null),
    [session.sources, review, plans, units, positives],
  )
  const fileNames = useMemo(
    () => Object.fromEntries(buildDatasetCatalog(session.sources).sources.map((s) => [s.alias, s.fileName])),
    [session.sources],
  )
  // Al terminar el cálculo, el dashboard queda a la vista sin navegar a otra pantalla.
  const dashboardRef = useRef<HTMLDivElement>(null)
  const lastRun = session.analysisRun
  useEffect(() => {
    if (lastRun) dashboardRef.current?.scrollIntoView?.({ block: 'start' })
  }, [lastRun])

  if (!engine) {
    return (
      <Alert tone="info" title="El cálculo requiere el backend local">
        En la demo pública no hay motor de análisis: los cálculos con Pandas se ejecutan en la instalación local.
      </Alert>
    )
  }
  if (!prepared) return null
  const quantities = quantitativeColumns(prepared, plans)
  const rocLabels = rocLabelColumns(prepared, plans, session.sources)
  const missingPositive = rocLabels.filter(({ alias, name }) => !positives[unitKey(alias, name)])
  const blocker =
    prepared.problem ??
    (missingPositive.length
      ? `Elegí la clase positiva de ${missingPositive.map((r) => `«${r.name}» (fuente ${r.alias})`).join(', ')} para la curva ROC.`
      : null)

  async function run() {
    if (!engine || !prepared || blocker) return
    setRunning(true)
    setError(null)
    try {
      session.setAnalysisRun(await engine.execute(prepared.request, prepared.files))
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="space-y-4">
      <Card className="space-y-3 p-5" role="region" aria-label="Ejecutar análisis">
        <p className="text-sm font-semibold text-slate-900">Ejecutar el análisis con Pandas</p>
        <p className="text-xs text-slate-600">
          Tus archivos se vuelven a enviar a tu backend local, se calculan en memoria las operaciones de los planes aprobados
          y se descartan. No se consulta a la IA ni se envían datos a OpenAI.
        </p>
        {quantities.length > 0 && (
          <fieldset className="flex flex-wrap gap-3">
            <legend className="mb-1 text-xs font-medium text-slate-700">Unidad de las cantidades (opcional)</legend>
            {quantities.map(({ alias, name }) => {
              const key = unitKey(alias, name)
              return (
                <label key={key} className="flex items-center gap-1.5 text-xs text-slate-600">
                  {name} (fuente {alias})
                  <input
                    value={units[key] ?? ''}
                    onChange={(e) => setUnits((u) => ({ ...u, [key]: e.target.value.slice(0, 16) }))}
                    placeholder="ARS, USD, kg…"
                    aria-label={`Unidad de ${name} (fuente ${alias})`}
                    className="w-24 rounded-md border border-slate-300 px-2 py-1 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 focus:outline-none"
                  />
                </label>
              )
            })}
          </fieldset>
        )}
        {rocLabels.length > 0 && (
          <fieldset className="flex flex-wrap gap-3">
            <legend className="mb-1 text-xs font-medium text-slate-700">Clase positiva de la curva ROC</legend>
            {rocLabels.map(({ alias, name, classes }) => {
              const key = unitKey(alias, name)
              const label = `Clase positiva de ${name} (fuente ${alias})`
              return (
                <label key={key} className="flex items-center gap-1.5 text-xs text-slate-600">
                  {name} (fuente {alias})
                  {classes.length >= 2 ? (
                    <select
                      value={positives[key] ?? ''}
                      onChange={(e) => setPositives((p) => ({ ...p, [key]: e.target.value }))}
                      aria-label={label}
                      className="rounded-md border border-slate-300 px-2 py-1 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 focus:outline-none"
                    >
                      <option value="">Elegir…</option>
                      {classes.map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      value={positives[key] ?? ''}
                      onChange={(e) => setPositives((p) => ({ ...p, [key]: e.target.value.slice(0, 250) }))}
                      placeholder="Valor de la clase positiva"
                      aria-label={label}
                      className="w-40 rounded-md border border-slate-300 px-2 py-1 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 focus:outline-none"
                    />
                  )}
                </label>
              )
            })}
            <p className="w-full text-[11px] text-slate-500">
              El backend verifica que sea una de las dos clases reales de la columna. Este valor no se envía a la IA.
            </p>
          </fieldset>
        )}
        {blocker && <Alert tone="warning">{blocker}</Alert>}
        {error && <Alert tone="error">{error}</Alert>}
        <Button icon={<Play className="size-4" />} onClick={() => void run()} loading={running} disabled={Boolean(blocker)}>
          {session.analysisRun ? 'Volver a ejecutar análisis' : 'Ejecutar análisis'}
        </Button>
      </Card>
      {running && (
        <Card className="p-6">
          <Spinner label="Calculando con Pandas…" />
        </Card>
      )}
      <div ref={dashboardRef}>{lastRun && !running && <AnalysisResults run={lastRun} fileNames={fileNames} />}</div>
    </div>
  )
}
