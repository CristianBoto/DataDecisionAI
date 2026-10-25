import { AlertTriangle, Calculator, CheckCircle2, XCircle } from 'lucide-react'
import { Alert } from '@/components/ui/Alert'
import { Badge } from '@/components/ui/Badge'
import { Card } from '@/components/ui/Card'
import type { ExecutionResponse, OperationResult, ResultMeasure } from '@/services/analysisEngine'

const OPERATION_LABELS: Record<string, string> = {
  count: 'Conteo de registros',
  sum: 'Suma',
  mean: 'Promedio',
  median: 'Mediana',
  min: 'Mínimo',
  max: 'Máximo',
  group_by: 'Agrupación',
  compare_groups: 'Comparación entre grupos',
  time_series: 'Serie temporal',
  frequency: 'Frecuencias',
  distinct_count: 'Valores distintos',
}

const AGGREGATE_LABELS: Record<string, string> = {
  count: 'Registros',
  sum: 'Suma de',
  mean: 'Promedio de',
  median: 'Mediana de',
  min: 'Mínimo de',
  max: 'Máximo de',
  distinct_count: 'Distintos en',
  share_pct: 'Participación de',
}

const number = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 })

function measureLabel(m: ResultMeasure): string {
  if (m.aggregate === 'count') return 'Registros'
  const unit = m.unit ? ` (${m.unit})` : ''
  return `${AGGREGATE_LABELS[m.aggregate] ?? m.aggregate} ${m.column}${unit}`
}

function formatValue(value: number | null, m: ResultMeasure): string {
  if (value === null) return '—'
  const formatted = number.format(value)
  if (m.aggregate === 'share_pct') return `${formatted} %`
  return m.unit && m.aggregate !== 'count' && m.aggregate !== 'distinct_count' ? `${formatted} ${m.unit}` : formatted
}

function OperationTable({ op }: { op: OperationResult }) {
  const title = `${OPERATION_LABELS[op.operation] ?? op.operation}${op.description ? ` · ${op.description}` : ''}`
  if (op.status === 'error') {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50/50 p-3 text-sm" role="group" aria-label={`Resultado: ${title}`}>
        <p className="flex items-center gap-1.5 font-medium text-red-900">
          <XCircle className="size-4" aria-hidden /> {title}
        </p>
        <p className="mt-1 text-red-800">No se pudo calcular: {op.error}</p>
      </div>
    )
  }
  const dimensions = op.dimensions.map((d) => (op.period && d === op.dimensions[0] ? `${d} (${op.period === 'month' ? 'mes' : 'año'})` : d))
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
                <th key={i} scope="col" className="py-1 pr-3 text-right font-medium">{measureLabel(m)}</th>
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

/** Resultados del motor de análisis: solo los números que calculó Pandas, sin conclusiones generadas. */
export function AnalysisResults({ run }: { run: ExecutionResponse }) {
  return (
    <section aria-label="Resultados del análisis" className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Calculator className="size-5 text-blue-700" aria-hidden />
        <h2 className="text-base font-semibold text-slate-900">Resultados calculados con Pandas</h2>
        <Badge tone="neutral">
          {run.sources.map((s) => `Fuente ${s.alias}: ${number.format(s.rows)} filas`).join(' · ')}
        </Badge>
      </div>
      {run.results.map((plan) => (
        <Card key={plan.plan_id} className="space-y-3 p-5" role="region" aria-label={`Resultados: ${plan.title}`}>
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold text-slate-900">{plan.title}</p>
            <Badge tone="neutral">Fuente {plan.source_alias}</Badge>
            {plan.status === 'ok' && <Badge tone="green" icon={<CheckCircle2 className="size-3" aria-hidden />}>Completo</Badge>}
            {plan.status === 'partial' && <Badge tone="amber" icon={<AlertTriangle className="size-3" aria-hidden />}>Parcial</Badge>}
            {plan.status === 'error' && <Badge tone="red" icon={<XCircle className="size-3" aria-hidden />}>Sin resultados</Badge>}
          </div>
          {plan.operations.length === 0 && plan.warnings.length > 0 && <Alert tone="error">{plan.warnings[0]}</Alert>}
          <div className="grid gap-3 lg:grid-cols-2">
            {plan.operations.map((op, i) => <OperationTable key={i} op={op} />)}
          </div>
          {plan.operations.length > 0 && plan.warnings.length > 0 && (
            <p className="text-xs text-slate-500">Limitaciones del plan: {plan.warnings.join(' ')}</p>
          )}
        </Card>
      ))}
      <ul className="space-y-0.5 text-xs text-slate-500">
        {run.notes.map((n) => <li key={n}>{n}</li>)}
      </ul>
    </section>
  )
}
