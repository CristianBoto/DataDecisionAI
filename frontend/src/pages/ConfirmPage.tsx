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
import { AnalysisExecution } from '@/components/analysis/AnalysisExecution'
import { AIPlanDetails } from '@/components/chat/AIReplyCard'
import { MissingCoverageNotice, NotObtainableNotice } from '@/components/analysis/CoverageNotice'
import { useAnalysisSession } from '@/hooks/useAnalysisSession'
import { useAsync } from '@/hooks/useAsync'
import { useAIGateway, useService } from '@/hooks/useService'
import { approvedAIPlans, collectAIPlans, conversationClarifications } from '@/lib/aiPlans'
import { buildDatasetCatalog } from '@/lib/datasetCatalog'
import { planCoverage, sharedColumns } from '@/lib/planCoverage'
import { getErrorMessage } from '@/services'

const CHART_TYPE_LABEL = { bar: 'Barras', line: 'Líneas', area: 'Áreas', histogram: 'Distribución', pie: 'Torta', scatter: 'Dispersión', roc: 'Curva ROC' }

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

/**
 * Paso 4 con la IA real: muestra los planes APROBADOS tal como los validó el
 * backend (misma fuente que el asistente: la sesión). No consulta a OpenAI ni
 * ejecuta cálculos; la confirmación final solo existe si hay un plan aprobado.
 */
function AIPlanConfirmation() {
  const navigate = useNavigate()
  const session = useAnalysisSession()
  const { aiChat, approvedPlanIds, confirmedPlanIds, review, sources } = session
  const [acknowledged, setAcknowledged] = useState(false)
  const approved = approvedAIPlans(aiChat, approvedPlanIds)
  const proposed = collectAIPlans(aiChat, approvedPlanIds).length
  const objective = review?.objective.trim() ?? ''
  const clarifications = conversationClarifications(aiChat, objective)
  const fileByAlias = new Map(buildDatasetCatalog(sources).sources.map((s) => [s.alias, s.fileName]))
  const confirmed = approved.length > 0 && approved.every((p) => confirmedPlanIds.includes(p.planId))

  if (approved.length === 0) {
    return (
      <EmptyState
        icon={<ClipboardCheck className="size-6" />}
        title="Todavía no aprobaste ningún plan"
        description={
          proposed > 0
            ? `El asistente propuso ${proposed} ${proposed === 1 ? 'plan' : 'planes'}. Aprobá el que quieras usar para continuar.`
            : 'Conversá con el asistente para que proponga un plan de análisis.'
        }
        action={
          <Link to="/analisis/asistente">
            <Button>Volver al asistente</Button>
          </Link>
        }
      />
    )
  }

  const warnings = [...new Set(approved.flatMap((p) => p.reply.warnings))]
  // Comprobación local (sin IA): ¿los planes aprobados cubren lo que la persona pidió?
  const coverage = planCoverage(
    [objective, ...clarifications],
    sharedColumns(review?.sources ?? [], buildDatasetCatalog(sources)),
    approved.flatMap((p) => p.plan.operations),
  )

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={
          <>
            <Badge tone="blue">Paso 4 de 5</Badge>
            <Badge tone="green" icon={<CheckCircle2 className="size-3" aria-hidden />}>
              {approved.length === 1 ? '1 plan aprobado' : `${approved.length} planes aprobados`}
            </Badge>
          </>
        }
        title="Confirmá la propuesta de análisis"
        description="Estos son los planes que aprobaste, tal como los validó el backend. Nada se calcula todavía."
      />

      <Card className="relative overflow-hidden border-blue-200 bg-gradient-to-br from-navy-950 to-navy-800 p-6 text-white">
        <div className="relative">
          <p className="flex items-center gap-2 text-xs font-semibold tracking-wide text-cyan-300 uppercase">
            <Target className="size-4" aria-hidden /> Objetivo confirmado
          </p>
          <p className="mt-2 text-lg leading-relaxed font-semibold">{objective}</p>
          <p className="mt-3 text-sm text-slate-300">La IA lo interpretó así: {approved[0].reply.interpreted_objective}</p>
        </div>
      </Card>

      {approved.map((p) => (
        <Card key={p.planId} className="p-5" role="region" aria-label={`Plan aprobado: ${p.plan.title}`}>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold text-slate-900">{p.plan.title}</h2>
            <Badge tone="neutral">
              Fuente {p.plan.source_alias}
              {fileByAlias.get(p.plan.source_alias) ? ` · ${fileByAlias.get(p.plan.source_alias)}` : ''}
            </Badge>
            <Badge tone="green">Aprobado</Badge>
            <span className="text-xs text-slate-400">Propuesta {p.proposal}</span>
          </div>
          <AIPlanDetails plan={p.plan} />
        </Card>
      ))}

      <div className="grid gap-4 md:grid-cols-2">
        <Section icon={<PencilLine className="size-4" />} title="Aclaraciones de la conversación">
          {clarifications.length === 0 ? (
            <Empty>Sin aclaraciones adicionales al objetivo.</Empty>
          ) : (
            <ul className="list-inside list-disc space-y-1 text-sm text-slate-700">
              {clarifications.map((c, i) => <li key={i}>{c}</li>)}
            </ul>
          )}
        </Section>
        <Section icon={<AlertTriangle className="size-4" />} title="Advertencias y suposiciones">
          {warnings.length === 0 ? (
            <Empty>La IA no informó advertencias.</Empty>
          ) : (
            <ul className="list-inside list-disc space-y-1 text-sm text-slate-700">
              {warnings.map((w) => <li key={w}>{w}</li>)}
            </ul>
          )}
        </Section>
      </div>

      <MissingCoverageNotice missing={coverage.missing} title="Puede que el plan no cubra todo lo que pediste" />
      <NotObtainableNotice items={coverage.notObtainable} />

      <Alert tone="info" title="Todavía no se ejecuta ningún cálculo">
        Aprobar un plan y confirmarlo acá no consulta a la IA ni procesa tus datos. El cálculo con Pandas ocurre solo
        cuando, después de confirmar, pulsás «Ejecutar análisis». Estos planes viven en la memoria de la sesión: se pierden
        al recargar la página o reiniciar el backend.
      </Alert>

      {/* Fija abajo solo mientras falta confirmar: después no debe tapar la ejecución ni el dashboard. */}
      <Card className={confirmed ? 'p-4 sm:p-5' : 'sticky bottom-4 z-10 p-4 shadow-elevated sm:p-5'}>
        {confirmed ? (
          <Alert tone="success" title="Propuesta confirmada">
            Ya podés ejecutar el análisis con Pandas. Podés volver al asistente si querés ajustarla.
          </Alert>
        ) : (
          <label className="flex cursor-pointer items-start gap-3 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
              className="mt-0.5 size-4 rounded border-slate-300 accent-blue-600"
            />
            Revisé los planes aprobados y entiendo sus limitaciones.
          </label>
        )}
        <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" icon={<PencilLine className="size-4" />} onClick={() => navigate('/analisis/asistente')}>
            Volver al asistente
          </Button>
          {!confirmed && (
            <Button
              icon={<ClipboardCheck className="size-4" />}
              disabled={!acknowledged}
              onClick={() => session.confirmPlans(approved.map((p) => p.planId))}
            >
              Confirmar propuesta
            </Button>
          )}
        </div>
      </Card>

      {confirmed && <AnalysisExecution plans={approved} />}
    </div>
  )
}

export function ConfirmPage() {
  const navigate = useNavigate()
  const service = useService()
  const { projectId, sources, reviewConfirmed } = useAnalysisSession()
  // Modo real (hay backend): la propuesta son los planes de la IA real en la sesión, nunca la del servicio DEMO.
  const realAIConversation = Boolean(useAIGateway())
  const proposal = useAsync(
    () => (projectId && !realAIConversation ? service.getCurrentProposal(projectId) : Promise.resolve(null)),
    [projectId, service, realAIConversation],
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
  if (realAIConversation) return <AIPlanConfirmation />
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
            <Badge tone="blue">Paso 4 de 5</Badge>
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
