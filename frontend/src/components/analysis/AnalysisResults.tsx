import { useMemo } from 'react'
import { AlertTriangle, Calculator, CheckCircle2, Database, Info, XCircle } from 'lucide-react'
import { ChartCard } from '@/components/charts/ChartCard'
import { Alert } from '@/components/ui/Alert'
import { Badge } from '@/components/ui/Badge'
import { Card } from '@/components/ui/Card'
import { buildDashboard, measureLabel, operationTitle, type DashboardKpi, type PlanDashboard } from '@/lib/dashboard'
import type { ExecutionResponse, OperationResult, ResultMeasure } from '@/services/analysisEngine'

const number = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 })

function formatValue(value: number | null, m: ResultMeasure): string {
  if (value === null) return '—'
  const formatted = number.format(value)
  if (m.aggregate === 'share_pct') return `${formatted} %`
  return m.unit && m.aggregate !== 'count' && m.aggregate !== 'distinct_count' ? `${formatted} ${m.unit}` : formatted
}

/** Tabla exacta de una operación: los valores tal como los devolvió Pandas. */
function OperationTable({ op }: { op: OperationResult }) {
  const title = operationTitle(op)
  const dimensions = op.dimensions.map((d, i) => (op.period && i === 0 ? `${d} (${op.period === 'month' ? 'mes' : 'año'})` : d))
  return (
    <div className="rounded-xl border border-slate-200 p-3 text-sm" role="group" aria-label={`Resultado: ${title}`}>
      <p className="font-medium text-slate-800">{title}</p>
      <div className="scrollbar-thin mt-2 max-h-72 overflow-auto">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 bg-white text-slate-500">
            <tr>
              {dimensions.map((d) => (
                <th key={d} scope="col" className="py-1 pr-3 font-medium">{d}</th>
              ))}
              {op.measures.map((m, i) => (
                <th key={i} scope="col" className="py-1 pr-3 text-right font-medium">
                  {measureLabel(m)}
                  {m.unit && m.aggregate !== 'share_pct' ? ` (${m.unit})` : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {op.rows.map((row, i) => (
              <tr key={i} className="border-t border-slate-100">
                {row.keys.map((k, j) => (
                  <td key={j} className="py-1 pr-3 text-slate-700">{k}</td>
                ))}
                {row.values.map((v, j) => (
                  <td key={j} className="py-1 pr-3 text-right font-mono text-slate-900 tabular-nums">{formatValue(v, op.measures[j])}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-1.5 text-[11px] text-slate-400">
        Columnas: {[...op.group_by, ...op.columns.filter((c) => !op.group_by.includes(c))].join(', ') || '—'}
        {op.rows_used !== null && <> · {op.rows_used} filas usadas</>}
      </p>
      {op.warnings.length > 0 && (
        <ul className="mt-1 space-y-0.5 text-xs text-amber-800">
          {op.warnings.map((w) => <li key={w}>⚠ {w}</li>)}
        </ul>
      )}
    </div>
  )
}

function KpiTile({ kpi }: { kpi: DashboardKpi }) {
  return (
    <Card className="relative overflow-hidden p-4" role="group" aria-label={`Indicador: ${kpi.label}`}>
      <span className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-blue-600 via-cyan-400 to-transparent opacity-70" aria-hidden />
      <p className="text-xs font-medium text-slate-500">{kpi.label}</p>
      <p className="mt-1.5 text-2xl font-bold tracking-tight text-slate-900 tabular-nums">
        {number.format(kpi.value)}
        {kpi.unit && <span className="ml-1 text-base font-semibold text-slate-500">{kpi.unit}</span>}
      </p>
      <p className="mt-1 text-[11px] text-slate-400">{kpi.description}</p>
    </Card>
  )
}

function PlanSection({ plan }: { plan: PlanDashboard }) {
  const empty = plan.tables.length === 0
  return (
    <div className="space-y-4" role="region" aria-label={`Resultados: ${plan.title}`}>
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-semibold text-slate-900">{plan.title}</p>
        {plan.status === 'ok' && <Badge tone="green" icon={<CheckCircle2 className="size-3" aria-hidden />}>Completo</Badge>}
        {plan.status === 'partial' && <Badge tone="amber" icon={<AlertTriangle className="size-3" aria-hidden />}>Parcial</Badge>}
        {plan.status === 'error' && <Badge tone="red" icon={<XCircle className="size-3" aria-hidden />}>Sin resultados</Badge>}
      </div>

      {empty && (
        <Alert tone="warning" title="Este plan no produjo resultados para mostrar">
          {plan.errors.length > 0 || plan.warnings.length === 0
            ? 'Ninguna operación se pudo calcular. Revisá los motivos más abajo.'
            : plan.warnings[0]}
        </Alert>
      )}

      {plan.kpis.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {plan.kpis.map((kpi) => <KpiTile key={kpi.id} kpi={kpi} />)}
        </div>
      )}

      {plan.charts.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-2">
          {plan.charts.map((chart) => <ChartCard key={chart.id} chart={chart} />)}
        </div>
      )}

      {plan.notices.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600" role="note" aria-label="Gráficos no generados">
          <p className="mb-1 flex items-center gap-1.5 font-medium text-slate-700">
            <Info className="size-3.5" aria-hidden /> Gráficos no generados
          </p>
          <ul className="space-y-0.5">
            {plan.notices.map((n) => <li key={n}>{n}</li>)}
          </ul>
        </div>
      )}

      {plan.errors.length > 0 && (
        <div className="space-y-2">
          {plan.errors.map((e) => (
            <div key={e.title} className="rounded-xl border border-red-200 bg-red-50/50 p-3 text-sm" role="group" aria-label={`Resultado: ${e.title}`}>
              <p className="flex items-center gap-1.5 font-medium text-red-900">
                <XCircle className="size-4" aria-hidden /> {e.title}
              </p>
              <p className="mt-1 text-red-800">No se pudo calcular: {e.message}</p>
            </div>
          ))}
        </div>
      )}

      {!empty && (
        <details className="group rounded-xl border border-slate-200 bg-white" open>
          <summary className="cursor-pointer px-4 py-2.5 text-sm font-medium text-slate-700">Tablas detalladas (valores exactos)</summary>
          <div className="grid gap-3 border-t border-slate-100 p-3 lg:grid-cols-2">
            {plan.tables.map((op, i) => <OperationTable key={i} op={op} />)}
          </div>
        </details>
      )}

      {plan.warnings.length > 0 && !empty && <p className="text-xs text-slate-500">Limitaciones del plan: {plan.warnings.join(' ')}</p>}
    </div>
  )
}

/**
 * Dashboard de resultados reales (Fase 4B). Recibe el JSON del motor Pandas y
 * lo transforma con `buildDashboard` (lib/dashboard.ts) en indicadores,
 * gráficos de Recharts y tablas. Una sección por fuente: nunca se mezclan.
 */
export function AnalysisResults({ run, fileNames = {} }: { run: ExecutionResponse; fileNames?: Record<string, string> }) {
  const sources = useMemo(() => buildDashboard(run), [run])
  const nothing = sources.every((s) => s.plans.every((p) => p.tables.length === 0))
  return (
    <section aria-label="Resultados del análisis" className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <Calculator className="size-5 text-blue-700" aria-hidden />
        <h2 className="text-lg font-semibold text-slate-900">Dashboard del análisis</h2>
        <Badge tone="blue">Calculado con Pandas</Badge>
      </div>
      {nothing && (
        <Alert tone="warning" title="Sin resultados para mostrar">
          Ninguna operación de los planes se pudo calcular con los datos disponibles. Los motivos se detallan en cada plan.
        </Alert>
      )}
      {sources.map((source) => (
        <Card key={source.alias} className="space-y-5 p-5" role="region" aria-label={`Fuente ${source.alias}`}>
          <p className="flex flex-wrap items-center gap-2 border-b border-slate-100 pb-3 text-sm font-semibold text-slate-900">
            <Database className="size-4 text-slate-500" aria-hidden />
            Fuente {source.alias}
            {fileNames[source.alias] && <span className="font-normal text-slate-500">· {fileNames[source.alias]}</span>}
            {source.rows !== null && <Badge tone="neutral">{number.format(source.rows)} filas</Badge>}
          </p>
          {source.plans.map((plan) => <PlanSection key={plan.planId} plan={plan} />)}
        </Card>
      ))}
      <ul className="space-y-0.5 text-xs text-slate-500">
        {run.notes.map((n) => <li key={n}>{n}</li>)}
      </ul>
    </section>
  )
}
