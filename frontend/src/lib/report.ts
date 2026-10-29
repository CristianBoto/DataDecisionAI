import { measureLabel, planDashboard, runSummary, selectionCaption, viewCharts, type DashboardKpi } from '@/lib/dashboard'
import type { AIInterpretation, AIInterpretationResult, InterpretationItem } from '@/services/aiGateway'
import type { DescriptiveSummary, ExecutionResponse, OperationResult } from '@/services/analysisEngine'
import type { Chart } from '@/types/domain'

/**
 * Informe de análisis (Fase 4C): reúne en un documento lo que YA calculó el motor
 * Pandas y lo que ya verificó el backend. No calcula nada: indicadores, gráficos y
 * tablas salen de `planDashboard` (los mismos del dashboard); el resumen descriptivo
 * y la interpretación de la IA llegan del backend. La vista previa y el PDF usan este
 * mismo modelo, así que se descarga exactamente lo que se revisó.
 */

export interface ReportMethodRow {
  /** "P1.O2" = plan 1, operación 2 (la misma referencia que usa el backend). */
  ref: string
  plan: string
  operation: string
  columns: string
  rowsUsed: number | null
  status: 'ok' | 'error'
  error: string | null
}

export interface ReportPlan {
  title: string
  sourceAlias: string
  status: 'ok' | 'partial' | 'error'
  kpis: DashboardKpi[]
  /** Gráficos del dashboard con la vista por defecto; `note` explica filtros y recortes. */
  charts: { chart: Chart; note: string | null }[]
  tables: { ref: string; op: OperationResult }[]
  errors: { title: string; message: string }[]
}

export interface ReportDocument {
  title: string
  projectName: string
  generatedAt: Date
  executedAt: string
  objective: string | null
  status: 'complete' | 'partial' | 'empty'
  sources: { alias: string; fileName: string | null; rows: number; columns: number }[]
  methodology: ReportMethodRow[]
  engineNotes: string[]
  plans: ReportPlan[]
  summary: DescriptiveSummary | null
  interpretation: AIInterpretationResult | null
  /** Advertencias de las operaciones y limitaciones de los planes, sin repetir. */
  warnings: string[]
}

export const OPERATION_NAMES: Record<string, string> = {
  count: 'Conteo',
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
  histogram: 'Histograma',
  scatter: 'Dispersión y correlación',
  roc_curve: 'Curva ROC y AUC',
}

export const METHODOLOGY_TEXT =
  'Los cálculos se ejecutaron con Python y Pandas en el backend, sobre una copia en memoria de cada archivo, ' +
  'siguiendo solo los planes que la persona aprobó (catálogo cerrado de operaciones; no se ejecuta código generado por la IA). ' +
  'Las medidas que dependen de otra columna (por ejemplo, un indicador o una unidad) se calculan por separado y nunca se suman entre sí. ' +
  'Las correlaciones describen asociaciones, no causas. La curva ROC evalúa puntuaciones existentes; no se entrenó ningún modelo.'

const number = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 })

/** Valor de una medida con su unidad, como en las tablas del dashboard. */
export function formatMeasure(value: number | null, m: OperationResult['measures'][number]): string {
  if (value === null) return '—'
  const formatted = number.format(value)
  if (m.aggregate === 'share_pct') return `${formatted} %`
  return m.unit && m.aggregate !== 'count' && m.aggregate !== 'distinct_count' ? `${formatted} ${m.unit}` : formatted
}

export function measureHeader(m: OperationResult['measures'][number], op?: Pick<OperationResult, 'signed_measures'>): string {
  return `${measureLabel(m, op)}${m.unit && m.aggregate !== 'share_pct' ? ` (${m.unit})` : ''}`
}

export function buildReport(input: {
  run: ExecutionResponse
  objective: string | null
  projectName: string
  fileNames: Record<string, string>
  interpretation: AIInterpretationResult | null
  now?: Date
}): ReportDocument {
  const { run } = input
  const methodology: ReportMethodRow[] = []
  const plans: ReportPlan[] = run.results.map((plan, p) => {
    const refs = new Map(plan.operations.map((op, o) => [op, `P${p + 1}.O${o + 1}`]))
    plan.operations.forEach((op, o) =>
      methodology.push({
        ref: `P${p + 1}.O${o + 1}`,
        plan: plan.title,
        operation: `${OPERATION_NAMES[op.operation] ?? op.operation}${op.description && op.description !== '—' ? ` · ${op.description}` : ''}`,
        columns: [...op.group_by, ...op.columns.filter((c) => !op.group_by.includes(c))].join(', ') || '—',
        rowsUsed: op.rows_used,
        status: op.status,
        error: op.error,
      }),
    )
    const dashboard = planDashboard(plan)
    return {
      title: plan.title,
      sourceAlias: plan.source_alias,
      status: plan.status,
      kpis: dashboard.kpis,
      charts: dashboard.views.flatMap((view) => {
        const built = viewCharts(view, view.selection)
        const caption = view.selection ? selectionCaption(view.op, view.selection) : ''
        const note = [
          view.explorable
            ? `Vista predeterminada${caption ? ` (${caption})` : ''}: en la aplicación se pueden elegir otro eje, otras series y otros filtros.`
            : null,
          built.notice,
        ]
          .filter(Boolean)
          .join(' ')
        // Sin animación: el PDF captura el gráfico ya dibujado.
        return built.charts.map((chart) => ({ chart: { ...chart, animated: false }, note: note || null }))
      }),
      tables: dashboard.tables.map((op) => ({ ref: refs.get(op) ?? '', op })),
      errors: dashboard.errors,
    }
  })
  const warnings = [
    ...run.results.flatMap((r) => r.operations.flatMap((op) => op.warnings)),
    ...run.results.flatMap((r) => r.warnings),
  ]
  return {
    title: 'Informe de análisis e interpretación',
    projectName: input.projectName,
    generatedAt: input.now ?? new Date(),
    executedAt: run.executed_at,
    objective: input.objective?.trim() || null,
    status: runSummary(run).status,
    sources: run.sources.map((s) => ({ ...s, fileName: input.fileNames[s.alias] ?? null })),
    methodology,
    engineNotes: run.notes,
    plans,
    summary: run.summary ?? null,
    interpretation: input.interpretation,
    warnings: [...new Set(warnings)],
  }
}

type Section = 'executive_summary' | 'findings' | 'trends' | 'recommendations'

/** Afirmaciones con cifras recalculadas por el backend, separadas de las que no se pudieron verificar (sin cifras). */
export function splitVerified(interpretation: AIInterpretation, section: Section): { verified: InterpretationItem[]; unverified: InterpretationItem[] } {
  const items = interpretation[section]
  return { verified: items.filter((i) => i.status === 'verified'), unverified: items.filter((i) => i.status !== 'verified') }
}

/** Todas las afirmaciones sin verificar, con su sección (se muestran aparte y marcadas). */
export function unverifiedItems(interpretation: AIInterpretation): { section: string; item: InterpretationItem }[] {
  const names: Record<Section, string> = {
    executive_summary: 'Resumen',
    findings: 'Hallazgo',
    trends: 'Tendencia',
    recommendations: 'Recomendación',
  }
  return (Object.keys(names) as Section[]).flatMap((section) =>
    splitVerified(interpretation, section).unverified.map((item) => ({ section: names[section], item })),
  )
}
