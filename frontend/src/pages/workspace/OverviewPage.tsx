import { Link } from 'react-router-dom'
import {
  AlertTriangle,
  BarChart3,
  Bot,
  CalendarCheck,
  DollarSign,
  Hourglass,
  Lightbulb,
  Package,
  Percent,
  Receipt,
  Rows3,
  Target,
} from 'lucide-react'
import type { EvidenceLevel, Finding, Indicator } from '@/types/domain'
import { ChartCard } from '@/components/charts/ChartCard'
import { KpiCard } from '@/components/charts/KpiCard'
import { Alert } from '@/components/ui/Alert'
import { Badge, DemoBadge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardHeader } from '@/components/ui/Card'
import { ErrorState, Skeleton } from '@/components/ui/Feedback'
import { PageHeader } from '@/components/ui/PageHeader'
import { useWorkspace } from '@/hooks/useWorkspace'
import { formatDateTime } from '@/lib/format'
import { COMPLETENESS_CRITERIA, getCompleteness } from '@/lib/profileMetrics'

const EVIDENCE: Record<EvidenceLevel, { label: string; tone: 'green' | 'amber' | 'neutral'; bar: string }> = {
  strong: { label: 'Evidencia sólida', tone: 'green', bar: 'bg-emerald-500' },
  moderate: { label: 'Evidencia moderada', tone: 'amber', bar: 'bg-amber-400' },
  weak: { label: 'Evidencia débil', tone: 'neutral', bar: 'bg-slate-300' },
}

const KPI_ICONS = [DollarSign, Package, Receipt, Percent]

function FindingCard({ finding }: { finding: Finding }) {
  const evidence = EVIDENCE[finding.evidence]
  return (
    <li className="relative overflow-hidden rounded-xl border border-slate-200 bg-white p-4 pl-5">
      <span className={`absolute inset-y-0 left-0 w-1 ${evidence.bar}`} aria-hidden />
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-900">{finding.title}</h3>
        <Badge tone={evidence.tone}>{evidence.label}</Badge>
      </div>
      <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{finding.detail}</p>
      {finding.recommendation && (
        <p className="mt-3 flex gap-2 rounded-lg bg-blue-50/70 px-3 py-2 text-xs leading-relaxed text-blue-900">
          <Lightbulb className="mt-px size-3.5 shrink-0 text-blue-600" aria-hidden />
          <span>
            <strong>Recomendación:</strong> {finding.recommendation}
          </span>
        </p>
      )}
    </li>
  )
}

function ResultsSkeleton() {
  return (
    <div className="space-y-6" aria-label="Cargando resultados">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-36" />)}
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        {[0, 1].map((i) => <Skeleton key={i} className="h-80" />)}
      </div>
    </div>
  )
}

export function OverviewPage() {
  const { project, profile, results, openAssistant } = useWorkspace()
  const plan = project.approvedPlan

  let body
  if (results.status === 'loading') {
    body = <ResultsSkeleton />
  } else if (results.status === 'error') {
    body = (
      <Card>
        <ErrorState message={results.error} onRetry={results.retry} />
      </Card>
    )
  } else if (results.data.status !== 'available') {
    // Archivo propio en modo DEMO: no se inventan resultados.
    const completeness = getCompleteness(profile)
    const fromBackend = profile.origin === 'backend'
    const source = fromBackend ? 'Calculado con Pandas sobre el archivo completo.' : 'Calculado localmente sobre tu archivo.'
    const profileIndicators: Indicator[] = [
      { id: 'rows', label: fromBackend ? 'Filas' : 'Filas (vista previa)', value: profile.rowCount ?? 0, format: 'number', description: source },
      { id: 'cols', label: 'Columnas detectadas', value: profile.columnCount, format: 'number', description: source },
      ...(completeness !== null
        ? [{ id: 'comp', label: 'Completitud', value: completeness, format: 'percent' as const, description: COMPLETENESS_CRITERIA }]
        : []),
    ]
    body = (
      <div className="space-y-6">
        <Alert tone="warning" title="Resultados pendientes de backend">
          {results.data.sourceNote}
        </Alert>
        {profile.columnCount > 0 && (
          <section aria-labelledby="perfil-title" className="space-y-3">
            <h2 id="perfil-title" className="text-sm font-semibold text-slate-900">Perfil preliminar de tu archivo (datos reales)</h2>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {profileIndicators.map((k) => <KpiCard key={k.id} indicator={k} icon={<Rows3 className="size-4" />} />)}
            </div>
          </section>
        )}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-slate-900">Gráficos del plan aprobado</h2>
          <div className="grid gap-4 md:grid-cols-2">
            {plan?.charts.map((c) => (
              <Card key={c.id} className="flex min-h-44 flex-col items-center justify-center border-dashed p-6 text-center">
                <Hourglass className="size-6 text-slate-300" aria-hidden />
                <p className="mt-3 text-sm font-semibold text-slate-700">{c.title}</p>
                <p className="mt-1 text-xs text-slate-400">Se generará con los datos reales al conectar el backend.</p>
              </Card>
            ))}
          </div>
        </section>
      </div>
    )
  } else {
    const r = results.data
    body = (
      <div className="space-y-8">
        {r.isDemo && (
          <Alert tone="demo" title="Resultados demostrativos">
            {r.sourceNote}
          </Alert>
        )}

        <section aria-labelledby="kpi-title">
          <h2 id="kpi-title" className="sr-only">Indicadores principales</h2>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {r.indicators.map((k, i) => {
              const Icon = KPI_ICONS[i % KPI_ICONS.length]
              return <KpiCard key={k.id} indicator={k} icon={<Icon className="size-4" />} />
            })}
          </div>
        </section>

        <section aria-labelledby="charts-title" className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 id="charts-title" className="flex items-center gap-2 text-base font-semibold text-slate-900">
              <BarChart3 className="size-4 text-blue-600" aria-hidden /> Visualizaciones
            </h2>
            {r.isDemo && <DemoBadge label="Datos ficticios" />}
          </div>
          <div className="grid gap-4 xl:grid-cols-2">
            {r.charts.map((chart, i) => (
              <ChartCard key={chart.id} chart={chart} className={r.charts.length % 2 === 1 && i === 0 ? 'xl:col-span-2' : undefined} />
            ))}
          </div>
        </section>

        <section aria-labelledby="findings-title" className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
          <Card>
            <CardHeader
              icon={<Lightbulb className="size-4" aria-hidden />}
              title={<span id="findings-title">Hallazgos e interpretaciones</span>}
              description="Cada conclusión indica qué tan sólida es la evidencia que la respalda."
              actions={
                <Button size="sm" variant="outline" icon={<Bot className="size-4" />} onClick={openAssistant}>
                  Preguntar
                </Button>
              }
            />
            <ul className="space-y-3 p-5">
              {r.findings.map((f) => <FindingCard key={f.id} finding={f} />)}
            </ul>
          </Card>
          <Card className="h-fit">
            <CardHeader icon={<AlertTriangle className="size-4" aria-hidden />} title="Limitaciones" description="Lo que estos datos no permiten afirmar." />
            <ul className="space-y-2.5 p-5">
              {r.limitations.map((l) => (
                <li key={l} className="flex gap-2 text-xs leading-relaxed text-slate-600">
                  <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-amber-500" aria-hidden />
                  {l}
                </li>
              ))}
            </ul>
          </Card>
        </section>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6 lg:p-8">
      <PageHeader
        eyebrow={
          <>
            <Badge tone="green" icon={<CalendarCheck className="size-3" aria-hidden />}>
              Plan aprobado {plan ? `· ${formatDateTime(plan.approvedAt)}` : ''}
            </Badge>
            {project.dataset.source === 'demo' && <DemoBadge label="Dataset ficticio" />}
          </>
        }
        title={project.name}
        description={
          plan && (
            <span className="inline-flex gap-1.5">
              <Target className="mt-0.5 size-4 shrink-0 text-blue-600" aria-hidden />
              {plan.objective}
            </span>
          )
        }
        actions={
          <Link to="exportar">
            <Button variant="secondary">Exportar análisis</Button>
          </Link>
        }
      />
      {body}
    </div>
  )
}
