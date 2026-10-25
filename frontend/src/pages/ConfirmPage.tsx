import { useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  ClipboardCheck,
  Database,
  Gauge,
  PencilLine,
  SearchX,
  Target,
} from 'lucide-react'
import { Alert } from '@/components/ui/Alert'
import { Badge, DemoBadge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { EmptyState, ErrorState, Spinner } from '@/components/ui/Feedback'
import { FeasibilityBadge } from '@/components/ui/FeasibilityBadge'
import { PageHeader } from '@/components/ui/PageHeader'
import { useAnalysisSession } from '@/hooks/useAnalysisSession'
import { useAsync } from '@/hooks/useAsync'
import { useService } from '@/hooks/useService'
import { getErrorMessage } from '@/services'

const CHART_TYPE_LABEL = { bar: 'Barras', line: 'Líneas', area: 'Áreas', histogram: 'Distribución' }

function Section({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <Card className="p-5">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
        <span className="text-blue-600">{icon}</span>
        {title}
      </h2>
      <div className="mt-3">{children}</div>
    </Card>
  )
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="text-sm text-slate-400">{children}</p>
}

export function ConfirmPage() {
  const navigate = useNavigate()
  const service = useService()
  const { projectId, sources, reviewConfirmed } = useAnalysisSession()
  const proposal = useAsync(
    () => (projectId ? service.getCurrentProposal(projectId) : Promise.resolve(null)),
    [projectId, service],
  )
  const [acknowledged, setAcknowledged] = useState(false)
  const [approving, setApproving] = useState(false)
  const [approveError, setApproveError] = useState<string | null>(null)

  if (sources.length > 0 && (!reviewConfirmed || !projectId)) {
    return (
      <EmptyState
        icon={<ClipboardCheck className="size-6" />}
        title="Primero revisá tus datos"
        description="Para confirmar un plan hace falta la revisión de datos confirmada y una conversación con el asistente."
        action={
          <Link to="/analisis/revisar">
            <Button>Ir a la revisión</Button>
          </Link>
        }
      />
    )
  }

  if (!projectId) {
    return (
      <EmptyState
        icon={<ClipboardCheck className="size-6" />}
        title="No hay un análisis en curso"
        description="Cargá un dataset y conversá con el asistente para generar una propuesta."
        action={
          <Link to="/analisis/cargar">
            <Button>Comenzar</Button>
          </Link>
        }
      />
    )
  }
  if (proposal.status === 'loading') return <Spinner label="Cargando propuesta…" />
  if (proposal.status === 'error') return <ErrorState message={proposal.error} onRetry={proposal.retry} />
  if (!proposal.data) {
    return (
      <EmptyState
        icon={<ClipboardCheck className="size-6" />}
        title="Todavía no hay una propuesta"
        description="Conversá con el asistente para que prepare una propuesta de análisis."
        action={
          <Link to="/analisis/asistente">
            <Button>Volver al asistente</Button>
          </Link>
        }
      />
    )
  }

  const p = proposal.data
  const insufficient = p.feasibility === 'insufficient'

  async function approve() {
    if (!projectId) return
    setApproving(true)
    setApproveError(null)
    try {
      await service.approveProposal(projectId, p.id)
      await service.runAnalysis(projectId)
      navigate(`/proyectos/${projectId}`)
    } catch (err) {
      setApproveError(getErrorMessage(err))
      setApproving(false)
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={
          <>
            <Badge tone="blue">Paso 4 de 4</Badge>
            <FeasibilityBadge value={p.feasibility} />
            {p.isDemo && <DemoBadge label="Propuesta simulada" />}
          </>
        }
        title="Confirmá la propuesta de análisis"
        description={`Versión ${p.version}. Revisá qué se va a analizar. Nada se ejecuta hasta que lo apruebes.`}
      />

      <Card className="relative overflow-hidden border-blue-200 bg-gradient-to-br from-navy-950 to-navy-800 p-6 text-white">
        <div className="grid-backdrop absolute inset-0 opacity-10" aria-hidden />
        <div className="relative">
          <p className="flex items-center gap-2 text-xs font-semibold tracking-wide text-cyan-300 uppercase">
            <Target className="size-4" aria-hidden /> Objetivo
          </p>
          <p className="mt-2 text-lg leading-relaxed font-semibold">{p.objective}</p>
          <p className="mt-3 max-w-3xl text-sm leading-relaxed text-slate-300">{p.summary}</p>
          <p className="mt-4 text-xs text-slate-400">
            <strong className="text-slate-200">Viabilidad:</strong> {p.feasibilityReason}
          </p>
        </div>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Section icon={<Gauge className="size-4" />} title="Indicadores que se analizarán">
          {p.indicators.length === 0 ? (
            <Empty>Sin indicadores definidos.</Empty>
          ) : (
            <ul className="space-y-2.5">
              {p.indicators.map((i) => (
                <li key={i.id} className="flex gap-2.5">
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden />
                  <div>
                    <p className="text-sm font-medium text-slate-800">{i.label}</p>
                    <p className="text-xs text-slate-500">{i.description}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section icon={<BarChart3 className="size-4" />} title="Gráficos propuestos">
          {p.charts.length === 0 ? (
            <Empty>Sin gráficos definidos.</Empty>
          ) : (
            <ul className="space-y-2.5">
              {p.charts.map((c) => (
                <li key={c.id} className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-slate-800">{c.title}</p>
                    <p className="text-xs text-slate-500">{c.description}</p>
                  </div>
                  <Badge>{CHART_TYPE_LABEL[c.type]}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section icon={<Database className="size-4" />} title="Datos necesarios">
          {p.requiredData.length === 0 ? (
            <Empty>No se requieren columnas específicas.</Empty>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {p.requiredData.map((d) => (
                <span key={d} className="rounded-md bg-slate-100 px-2 py-1 font-mono text-xs text-slate-700">{d}</span>
              ))}
            </div>
          )}
        </Section>

        <Section icon={<AlertTriangle className="size-4" />} title="Limitaciones e información faltante">
          <div className="space-y-3">
            {p.missingInformation.length > 0 && (
              <div>
                <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-amber-800">
                  <SearchX className="size-3.5" aria-hidden /> Información faltante
                </p>
                <ul className="list-inside list-disc space-y-1 text-sm text-slate-700">
                  {p.missingInformation.map((m) => <li key={m}>{m}</li>)}
                </ul>
              </div>
            )}
            {p.limitations.length > 0 ? (
              <ul className="list-inside list-disc space-y-1 text-sm text-slate-600">
                {p.limitations.map((l) => <li key={l}>{l}</li>)}
              </ul>
            ) : (
              <Empty>No se identificaron limitaciones.</Empty>
            )}
          </div>
        </Section>
      </div>

      {p.requestedChanges.length > 0 && (
        <Alert tone="info" title="Modificaciones solicitadas">
          <ul className="list-inside list-disc">
            {p.requestedChanges.map((c, i) => <li key={i}>{c}</li>)}
          </ul>
        </Alert>
      )}

      <Card className="sticky bottom-4 z-10 p-4 shadow-elevated sm:p-5">
        {insufficient ? (
          <Alert tone="error" title="No es posible aprobar esta propuesta">
            Los datos disponibles no alcanzan para el objetivo. Volvé al asistente o cargá otro archivo.
          </Alert>
        ) : (
          <label className="flex cursor-pointer items-start gap-3 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
              className="mt-0.5 size-4 rounded border-slate-300 accent-blue-600"
            />
            Revisé la propuesta y entiendo sus limitaciones.
          </label>
        )}
        {approveError && <Alert tone="error" className="mt-3">{approveError}</Alert>}
        <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            variant="outline"
            icon={<PencilLine className="size-4" />}
            onClick={() => navigate('/analisis/asistente', { state: { modify: true } })}
            disabled={approving}
          >
            Modificar propuesta
          </Button>
          <Button
            icon={<ClipboardCheck className="size-4" />}
            onClick={() => void approve()}
            disabled={insufficient || !acknowledged}
            loading={approving}
          >
            Aprobar y ejecutar análisis
          </Button>
        </div>
      </Card>
    </div>
  )
}
