import { useState } from 'react'
import { AlertTriangle, CheckCircle2, HelpCircle, ListChecks } from 'lucide-react'
import { Alert } from '@/components/ui/Alert'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { getErrorMessage } from '@/services'
import type { AIAuthorizeResult, AIOperationName, AIPlan, AIReply } from '@/services/aiGateway'

const OPERATION_LABELS: Record<AIOperationName, string> = {
  count: 'Conteo',
  distinct_count: 'Valores distintos',
  sum: 'Suma',
  mean: 'Promedio',
  median: 'Mediana',
  min: 'Mínimo',
  max: 'Máximo',
  std: 'Desvío estándar',
  percentage: 'Porcentaje',
  frequency: 'Frecuencias',
  group_by: 'Agrupación',
  time_series: 'Serie temporal',
  top_n: 'Ranking',
  compare_groups: 'Comparación de grupos',
  correlation: 'Correlación',
  missing_summary: 'Resumen de faltantes',
}

const CHART_LABELS: Record<string, string> = {
  bar: 'Barras',
  line: 'Líneas',
  pie: 'Torta',
  histogram: 'Histograma',
  scatter: 'Dispersión',
  box: 'Caja',
  table: 'Tabla',
  kpi: 'Indicador',
}

const RELATIONSHIP_LABELS: Record<AIReply['source_relationship'], string> = {
  single: 'Una fuente',
  independent: 'Fuentes analizadas por separado',
  compare: 'Comparación entre fuentes',
  concatenate: 'Unión de fuentes (no disponible)',
  relate: 'Relación entre fuentes (no disponible)',
  unclear: 'Relación entre fuentes sin definir',
}

interface Props {
  result: AIAuthorizeResult
  approvedPlanIds: string[]
  /** Registra la aprobación en el backend; no ejecuta cálculos. */
  onApprove?: (planId: string) => Promise<void>
}

/**
 * Contenido de un plan estructurado tal como lo validó el backend. Lo usan el
 * asistente y el paso «Confirmar», para mostrar exactamente el mismo plan.
 */
export function AIPlanDetails({ plan }: { plan: AIPlan }) {
  return (
    <>
      <p className="mt-1 text-xs text-slate-600">{plan.rationale}</p>
      {plan.columns_needed.length > 0 && (
        <p className="mt-1.5 text-xs text-slate-600">
          Columnas: <span className="font-mono">{plan.columns_needed.join(', ')}</span>
        </p>
      )}
      <ul className="mt-2 space-y-1 text-xs text-slate-700">
        {plan.operations.map((op, j) => (
          <li key={j}>
            <strong className="font-medium">{OPERATION_LABELS[op.operation] ?? op.operation}</strong> de{' '}
            {op.columns.join(', ') || '—'}
            {op.group_by.length > 0 && <> por {op.group_by.join(', ')}</>}
            {op.description && <span className="text-slate-500"> · {op.description}</span>}
          </li>
        ))}
      </ul>
      {plan.charts.length > 0 && (
        <p className="mt-1.5 text-xs text-slate-600">
          Gráficos: {plan.charts.map((c) => `${CHART_LABELS[c.type] ?? c.type} — ${c.title}`).join(' · ')}
        </p>
      )}
      {plan.limitations.length > 0 && (
        <p className="mt-1.5 text-xs text-amber-800">Limitaciones: {plan.limitations.join(' ')}</p>
      )}
    </>
  )
}

/** Respuesta de la IA real ya validada por el backend: preguntas y planes propuestos. */
export function AIReplyCard({ result, approvedPlanIds, onApprove }: Props) {
  const { reply, plan_ids: planIds, usage } = result
  const [busyPlan, setBusyPlan] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function approve(planId: string) {
    if (!onApprove) return
    setBusyPlan(planId)
    setError(null)
    try {
      await onApprove(planId)
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setBusyPlan(null)
    }
  }

  return (
    <div className="space-y-3 text-sm" data-testid="ai-reply">
      <p className="leading-relaxed whitespace-pre-wrap text-slate-800">{reply.message}</p>
      <p className="text-xs text-slate-500">
        <strong className="font-medium text-slate-600">Entendí:</strong> {reply.interpreted_objective} ·{' '}
        {RELATIONSHIP_LABELS[reply.source_relationship]}
      </p>

      {reply.questions.length > 0 && (
        <section aria-label="Preguntas del asistente" className="rounded-xl border border-blue-100 bg-blue-50/50 p-3">
          <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-blue-900">
            <HelpCircle className="size-3.5" aria-hidden /> Necesito que me aclares
          </p>
          <ul className="space-y-1.5 text-xs text-slate-700">
            {reply.questions.map((q, i) => (
              <li key={i}>
                <span className="font-medium">{q.question}</span>
                {q.source_alias && <span className="text-slate-500"> (fuente {q.source_alias}{q.column ? ` · ${q.column}` : ''})</span>}
                <span className="block text-slate-500">{q.reason}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {reply.plans.map((plan, i) => {
        const planId = planIds[i]
        const approved = approvedPlanIds.includes(planId)
        return (
          <section
            key={planId ?? i}
            aria-label={`Plan propuesto: ${plan.title}`}
            className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm"
          >
            <div className="flex flex-wrap items-center gap-2">
              <ListChecks className="size-4 text-violet-700" aria-hidden />
              <p className="font-semibold text-slate-900">{plan.title}</p>
              <Badge tone="neutral">Fuente {plan.source_alias}</Badge>
              {approved && (
                <Badge tone="green" icon={<CheckCircle2 className="size-3" aria-hidden />}>
                  Aprobado
                </Badge>
              )}
            </div>
            <AIPlanDetails plan={plan} />
            {planId && onApprove && !approved && (
              <Button size="sm" variant="outline" className="mt-2" loading={busyPlan === planId} onClick={() => void approve(planId)}>
                Aprobar este plan
              </Button>
            )}
          </section>
        )
      })}

      {reply.warnings.length > 0 && (
        <p className="flex items-start gap-1.5 text-xs text-amber-800">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden /> {reply.warnings.join(' ')}
        </p>
      )}
      {error && <Alert tone="error">{error}</Alert>}
      <p className="text-[11px] text-slate-400">
        IA real · {usage.model} · {usage.input_tokens} tokens de entrada y {usage.output_tokens} de salida · USD{' '}
        {usage.cost_usd.toFixed(4)} · Sin resultados calculados todavía
      </p>
    </div>
  )
}
