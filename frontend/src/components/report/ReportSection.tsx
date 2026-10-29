import { useEffect, useMemo, useRef, useState } from 'react'
import { Bot, Calculator, Download, Eye, EyeOff, FileText, ShieldCheck, Sparkles, XCircle } from 'lucide-react'
import { AnalysisStatus } from '@/components/report/AnalysisStatus'
import { InterpretationReview } from '@/components/report/InterpretationReview'
import { ReportPreview } from '@/components/report/ReportPreview'
import { Alert } from '@/components/ui/Alert'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { useAnalysisSession } from '@/hooks/useAnalysisSession'
import { useAIGateway } from '@/hooks/useService'
import { conversationClarifications } from '@/lib/aiPlans'
import { buildDatasetCatalog } from '@/lib/datasetCatalog'
import { planCoverage, sharedColumns } from '@/lib/planCoverage'
import { buildReport } from '@/lib/report'
import { downloadReportPdf } from '@/lib/reportPdf'
import { getErrorMessage } from '@/services'
import { isRealAIAvailable, type AIStatus, type PreparedInterpretation } from '@/services/aiGateway'
import type { ExecutionResponse } from '@/services/analysisEngine'

/**
 * Paso 5 · «Informe de análisis e interpretación» (Fase 4C).
 *
 * 1. Resumen descriptivo: lo calcula el backend a partir de los resultados de Pandas, sin IA.
 * 2. «Interpretar resultados con IA» (opcional): el backend arma el contexto AGREGADO, se muestra
 *    exactamente y con su costo máximo, y solo se envía si la persona lo autoriza (uso único).
 *    La respuesta llega ya verificada contra los resultados.
 * 3. Vista previa y «Descargar PDF»: el mismo documento, generado en el navegador.
 */
export function ReportSection({ run, fileNames }: { run: ExecutionResponse; fileNames: Record<string, string> }) {
  const session = useAnalysisSession()
  const gateway = useAIGateway()
  const [status, setStatus] = useState<AIStatus | null>(null)
  const [prepared, setPrepared] = useState<PreparedInterpretation | null>(null)
  const [busy, setBusy] = useState<'prepare' | 'send' | 'pdf' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [pdfNotice, setPdfNotice] = useState<string | null>(null)
  const previewRef = useRef<HTMLDivElement>(null)
  const preparedRef = useRef<PreparedInterpretation | null>(null)
  useEffect(() => {
    preparedRef.current = prepared
  }, [prepared])

  const interpretation = session.analysisInterpretation
  const summary = run.summary ?? null
  // Partes del pedido sin resultados: misma comprobación local que en «Confirmar», sobre lo calculado.
  const coverage = useMemo(() => {
    const objective = session.review?.objective.trim() ?? ''
    const calculated = run.results.flatMap((r) => r.operations.filter((o) => o.status === 'ok'))
    const columns = sharedColumns(session.review?.sources ?? [], buildDatasetCatalog(session.sources))
    return planCoverage([objective, ...conversationClarifications(session.aiChat, objective)], columns, calculated)
  }, [run, session.review, session.aiChat, session.sources])
  const canInterpret = Boolean(gateway?.prepareInterpretation && run.execution_id)
  const aiAvailable = isRealAIAvailable(status)

  useEffect(() => {
    if (!gateway) return
    gateway.status().then(setStatus, () => setStatus(null))
  }, [gateway])

  // Al salir de la pantalla, lo preparado y no autorizado se cancela en el backend.
  useEffect(
    () => () => {
      const pending = preparedRef.current
      if (pending) void gateway?.cancelInterpretation?.(pending.request_id).catch(() => undefined)
    },
    [gateway],
  )

  const report = useMemo(
    () =>
      buildReport({
        run,
        objective: session.review?.objective ?? null,
        projectName: session.projectName || 'Análisis de datos',
        fileNames,
        interpretation,
      }),
    [run, session.review?.objective, session.projectName, fileNames, interpretation],
  )

  async function prepare() {
    if (!gateway?.prepareInterpretation || !run.execution_id) return
    setBusy('prepare')
    setError(null)
    try {
      setPrepared(await gateway.prepareInterpretation(run.execution_id))
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  function cancel() {
    if (prepared) void gateway?.cancelInterpretation?.(prepared.request_id).catch(() => undefined)
    setPrepared(null)
  }

  async function authorize() {
    if (!gateway?.authorizeInterpretation || !prepared) return
    setBusy('send')
    setError(null)
    const request = prepared
    // La autorización es de un solo uso: lo preparado deja de valer, salga bien o mal.
    setPrepared(null)
    try {
      session.setAnalysisInterpretation(await gateway.authorizeInterpretation(request.request_id, request.payload_sha256))
      gateway.status().then(setStatus, () => undefined)
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  async function download() {
    if (!previewRef.current) return
    setBusy('pdf')
    setPdfNotice(null)
    try {
      const { missingCharts } = await downloadReportPdf(report, previewRef.current)
      setPdfNotice(
        missingCharts
          ? `PDF generado. ${missingCharts} gráfico(s) no se pudieron convertir en imagen: sus valores están en las tablas del informe.`
          : 'PDF generado con los gráficos, las tablas y la interpretación de la vista previa.',
      )
    } catch (err) {
      setPdfNotice(`No se pudo generar el PDF: ${getErrorMessage(err)}`)
    } finally {
      setBusy(null)
    }
  }

  return (
    <Card className="space-y-5 p-5" role="region" aria-label="Informe de análisis e interpretación">
      <div className="flex flex-wrap items-center gap-2">
        <FileText className="size-5 text-blue-700" aria-hidden />
        <h2 className="text-lg font-semibold text-slate-900">Informe de análisis e interpretación</h2>
      </div>

      {/* 0. Qué está calculado, qué falta y qué no se puede concluir (local, sin IA) */}
      <AnalysisStatus summary={summary} coverage={coverage} />

      {/* 1. Resumen descriptivo, sin IA */}
      <div className="space-y-2" role="region" aria-label="Resumen descriptivo">
        <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-800">
          <Calculator className="size-4 text-slate-500" aria-hidden /> Resumen descriptivo
          <Badge tone="blue">Calculado con Pandas · sin IA</Badge>
        </p>
        {summary ? (
          <>
            <ul className="space-y-2 text-sm text-slate-700">
              {summary.items.map((item) => (
                <li key={item.ref} className="rounded-lg border border-slate-200 p-3">
                  <p className="font-medium text-slate-900">
                    <span className="font-mono text-xs text-slate-400">{item.ref}</span> {item.title}
                  </p>
                  {item.status === 'error' ? (
                    <p className="mt-1 flex items-start gap-1.5 text-red-800">
                      <XCircle className="mt-0.5 size-4 shrink-0" aria-hidden /> No se pudo calcular: {item.error}. No se extraen
                      conclusiones de esta operación.
                    </p>
                  ) : (
                    <ul className="mt-1 list-disc space-y-0.5 pl-5">
                      {item.facts.map((f) => <li key={f}>{f}</li>)}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
            <p className="text-xs text-slate-500">{summary.notes.join(' ')}</p>
          </>
        ) : (
          <p className="text-sm text-slate-500">El backend no informó un resumen descriptivo para esta ejecución.</p>
        )}
      </div>

      {/* 2. Interpretación con IA, opcional y autorizada */}
      <div className="space-y-3 border-t border-slate-100 pt-4" role="region" aria-label="Interpretación con IA">
        <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-800">
          <Bot className="size-4 text-slate-500" aria-hidden /> Interpretación con IA
          {interpretation && <Badge tone="cyan" icon={<Sparkles className="size-3" aria-hidden />}>Generada por IA · verificada</Badge>}
        </p>

        {!canInterpret && (
          <p className="text-sm text-slate-500">La interpretación con IA no está disponible para estos resultados.</p>
        )}
        {canInterpret && !aiAvailable && !interpretation && (
          <Alert tone="info" title="IA no disponible">
            El informe y el PDF usan el resumen descriptivo calculado con Pandas. No se envía nada a OpenAI.
          </Alert>
        )}

        {canInterpret && aiAvailable && !interpretation && !prepared && (
          <div className="space-y-2">
            <p className="text-sm text-slate-600">
              La IA puede redactar un resumen ejecutivo, hallazgos, tendencias, recomendaciones y limitaciones a partir de
              estos resultados. Antes de enviar, vas a ver el contenido exacto y su costo máximo estimado.
            </p>
            <Button icon={<Sparkles className="size-4" />} loading={busy === 'prepare'} onClick={prepare}>
              Interpretar resultados con IA
            </Button>
          </div>
        )}

        {prepared && (
          <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50/60 p-4" role="region" aria-label="Autorizar interpretación con IA">
            <p className="flex items-center gap-1.5 text-sm font-semibold text-amber-950">
              <ShieldCheck className="size-4" aria-hidden /> Antes de enviar a OpenAI, revisá este resumen
            </p>
            <InterpretationReview prepared={prepared} executive={summary?.executive ?? []} />
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={authorize} loading={busy === 'send'}>
                Autorizar y enviar
              </Button>
              <Button size="sm" variant="outline" onClick={cancel} disabled={busy === 'send'}>
                Cancelar
              </Button>
            </div>
          </div>
        )}
        {busy === 'send' && <p className="text-xs text-slate-500">Enviando a la IA y verificando la respuesta…</p>}
        {error && <Alert tone="error" title="No se pudo interpretar con IA">{error}</Alert>}

        {interpretation && (
          <div className="space-y-2 text-sm text-slate-700">
            <p className="text-xs text-slate-500">
              Redactada por {interpretation.usage.model} con los resultados autorizados · USD{' '}
              {interpretation.usage.cost_usd.toFixed(4)}. Cada cifra se recalculó sobre los resultados; se muestra
              completa en la vista previa del informe.
            </p>
            <ul className="space-y-1">
              {interpretation.interpretation.executive_summary.map((i) => (
                <li key={i.text} className="flex flex-wrap items-baseline gap-1.5">
                  <Badge tone={i.status === 'verified' ? 'green' : 'amber'}>{i.status === 'verified' ? 'Verificada' : 'No verificada'}</Badge>
                  {i.text}
                </li>
              ))}
            </ul>
            {interpretation.notes.length > 0 && (
              <ul className="space-y-0.5 text-xs text-amber-800">{interpretation.notes.map((n) => <li key={n}>{n}</li>)}</ul>
            )}
            <Button size="sm" variant="ghost" onClick={() => session.setAnalysisInterpretation(null)}>
              Quitar la interpretación del informe
            </Button>
          </div>
        )}
      </div>

      {/* 3. Revisión y descarga */}
      <div className="space-y-3 border-t border-slate-100 pt-4">
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            icon={previewOpen ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            onClick={() => setPreviewOpen((v) => !v)}
            aria-expanded={previewOpen}
          >
            {previewOpen ? 'Ocultar vista previa' : 'Revisar el informe'}
          </Button>
          {previewOpen && (
            <Button icon={<Download className="size-4" />} loading={busy === 'pdf'} onClick={download}>
              Descargar PDF
            </Button>
          )}
        </div>
        {!previewOpen && <p className="text-xs text-slate-500">Revisá el informe completo antes de descargarlo en PDF.</p>}
        {pdfNotice && <p className="text-xs text-slate-600" role="status">{pdfNotice}</p>}
        {previewOpen && <ReportPreview ref={previewRef} report={report} />}
      </div>
    </Card>
  )
}
