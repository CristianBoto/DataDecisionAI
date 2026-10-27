import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AlertTriangle, BarChart3, CheckCircle2, FilePlus2, PencilLine, RotateCcw, XCircle } from 'lucide-react'
import { AnalysisResults } from '@/components/analysis/AnalysisResults'
import { Alert } from '@/components/ui/Alert'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/Feedback'
import { PageHeader } from '@/components/ui/PageHeader'
import { useAnalysisSession } from '@/hooks/useAnalysisSession'
import { useService } from '@/hooks/useService'
import { runSummary } from '@/lib/dashboard'
import { buildDatasetCatalog } from '@/lib/datasetCatalog'

const time = new Intl.DateTimeFormat('es-AR', { dateStyle: 'short', timeStyle: 'short' })

/**
 * Paso 5: resultados del motor Pandas. Siempre deja claro el estado (completo,
 * parcial o sin resultados) y cómo seguir: modificar el análisis (se conservan
 * archivos, revisión y conversación), volver a ejecutarlo o empezar uno nuevo
 * (solo después de confirmar que se descarta el trabajo actual).
 */
export function ResultsPage() {
  const navigate = useNavigate()
  const service = useService()
  const session = useAnalysisSession()
  const [confirmingNew, setConfirmingNew] = useState(false)
  const run = session.analysisRun
  // Se llega desde el final de «Confirmar»: el encabezado y el estado quedan a la vista.
  useEffect(() => {
    window.scrollTo?.({ top: 0 })
  }, [])
  const summary = useMemo(() => (run ? runSummary(run) : null), [run])
  const fileNames = useMemo(
    () => Object.fromEntries(buildDatasetCatalog(session.sources).sources.map((s) => [s.alias, s.fileName])),
    [session.sources],
  )

  if (!run || !summary) {
    return (
      <EmptyState
        icon={<BarChart3 className="size-6" />}
        title="Todavía no hay resultados"
        description="Confirmá un plan y pulsá «Ejecutar análisis» para calcularlo con Pandas."
        action={
          <Link to="/analisis/confirmar">
            <Button>Ir a Confirmar</Button>
          </Link>
        }
      />
    )
  }

  function startNew() {
    session.sources.forEach((s) => service.discardDataset(s.dataset.id))
    session.reset()
    navigate('/analisis/cargar')
  }

  const status = {
    complete: { tone: 'green' as const, icon: <CheckCircle2 className="size-3" aria-hidden />, label: 'Análisis completo' },
    partial: { tone: 'amber' as const, icon: <AlertTriangle className="size-3" aria-hidden />, label: 'Análisis parcial' },
    empty: { tone: 'red' as const, icon: <XCircle className="size-3" aria-hidden />, label: 'Sin resultados' },
  }[summary.status]

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={
          <>
            <Badge tone="blue">Paso 5 de 5</Badge>
            <Badge tone={status.tone} icon={status.icon}>{status.label}</Badge>
          </>
        }
        title="Resultados del análisis"
        description={`Calculado con Pandas (${time.format(new Date(run.executed_at))}) · ${summary.computed} de ${summary.total} operaciones calculadas en ${summary.plans} ${summary.plans === 1 ? 'plan' : 'planes'}.`}
      />

      <Card className="space-y-3 p-4 sm:p-5" role="region" aria-label="Cómo seguir">
        {summary.status === 'partial' && (
          <Alert tone="warning" title="Algunas operaciones no se pudieron calcular">
            Cada una explica el motivo en su plan. Podés modificar el análisis para corregirlas (por ejemplo, revisar
            cómo se interpreta una columna) sin volver a cargar tus archivos.
          </Alert>
        )}
        {summary.status === 'empty' && (
          <Alert tone="error" title="Ninguna operación produjo resultados">
            Revisá los motivos en cada plan y modificá el análisis.
          </Alert>
        )}
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <Button variant="outline" icon={<PencilLine className="size-4" />} onClick={() => navigate('/analisis/asistente')}>
            Modificar análisis
          </Button>
          <Button variant="outline" icon={<RotateCcw className="size-4" />} onClick={() => navigate('/analisis/confirmar')}>
            Volver a ejecutar
          </Button>
          <Button variant="outline" icon={<FilePlus2 className="size-4" />} onClick={() => setConfirmingNew(true)}>
            Nuevo análisis
          </Button>
        </div>
        <p className="text-xs text-slate-500">
          «Modificar análisis» conserva tus archivos, la revisión y la conversación mientras dure esta sesión.
        </p>
        {confirmingNew && (
          <Alert
            tone="warning"
            title="¿Empezar un análisis nuevo?"
            action={
              <span className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => setConfirmingNew(false)}>
                  Cancelar
                </Button>
                <Button size="sm" onClick={startNew}>
                  Sí, descartar y empezar
                </Button>
              </span>
            }
          >
            Se descartarán los archivos cargados, la revisión, la conversación con la IA y estos resultados. No se pueden
            recuperar.
          </Alert>
        )}
      </Card>

      <AnalysisResults run={run} fileNames={fileNames} />
    </div>
  )
}
