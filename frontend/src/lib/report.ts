import { measureLabel, planDashboard, runSummary, selectionCaption, viewCharts, type DashboardKpi } from '@/lib/dashboard'
import type { AIInterpretation, AIInterpretationResult, InterpretationItem } from '@/services/aiGateway'
import type { DescriptiveSummary, ExecutionResponse, OperationResult } from '@/services/analysisEngine'
import type { PlanCoverage } from '@/lib/planCoverage'
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

/**
 * Alcance real del informe (Fase 4E). Separa lo que se ejecutó del plan aprobado de lo que el
 * objetivo pedía: un plan puede completarse y dejar partes del objetivo sin responder. Usa la
 * misma comprobación de cobertura que «Confirmar» y «Resultados» (`planCoverage`), que es por
 * palabras clave: nunca se presenta como garantía.
 */
export interface ReportScope {
  /** Frase principal: qué se completó y qué quedó pendiente, con redacción prudente. */
  headline: string
  tone: 'ok' | 'warn'
  operations: { calculated: number; total: number; plans: number }
  calculated: string[]
  pending: string[]
  notConcludable: string[]
  /** Aclaración sobre los límites de la detección automática. */
  caveat: string
}

/** Indicador calculado A PARTIR de resultados reales (no es una operación del catálogo). */
export interface DerivedIndicator {
  ref: string
  title: string
  fact: string
}

/** Advertencia original, con una aclaración cuando el informe sí contiene lo que dice que falta. */
export interface ReportWarning {
  text: string
  clarification: string | null
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
  scope: ReportScope
  derived: DerivedIndicator[]
  /** Advertencias y notas del motor, con sus aclaraciones (lo que muestra el PDF). */
  warningNotes: ReportWarning[]
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

/** Título predeterminado del PDF: se deriva del análisis y la persona lo puede cambiar. */
export function defaultReportTitle(report: Pick<ReportDocument, 'projectName'>): string {
  return `Informe de análisis · ${report.projectName}`
}

function joinList(items: string[]): string {
  return items.length < 2 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} y ${items[items.length - 1]}`
}

const lowerFirst = (s: string) => (/^[A-ZÁÉÍÓÚÑ][a-záéíóúñ]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s)

export function reportScope(input: {
  objective: string | null
  methodology: ReportMethodRow[]
  plans: number
  coverage: PlanCoverage | null
}): ReportScope {
  const { methodology, coverage } = input
  const ok = methodology.filter((m) => m.status === 'ok')
  const failed = methodology.filter((m) => m.status !== 'ok')
  const total = methodology.length
  const planWord = input.plans === 1 ? 'del plan aprobado' : `de los ${input.plans} planes aprobados`
  const missing = coverage?.missing ?? []
  const pending = [
    ...failed.map((m) => `${m.ref} · ${m.operation}: no se pudo calcular (${(m.error ?? 'error').replace(/\.$/, '')}).`),
    ...missing.map((m) => `${m.label}: ${m.detail}`),
  ]
  const notObtainable = coverage?.notObtainable ?? []
  const notConcludable = [
    ...notObtainable.map((m) => `${m.label}: ${m.detail}`),
    ...(notObtainable.some((m) => m.label === 'Causas o motivos') ? [] : ['Causas: los resultados describen qué pasó y cuánto, no por qué.']),
    ...(failed.length ? ['Nada sobre las operaciones sin resultado.'] : []),
  ]

  let headline: string
  if (!ok.length) headline = 'No se obtuvieron resultados: ninguna operación del plan aprobado se pudo calcular.'
  else {
    const done = failed.length
      ? `Se calcularon ${ok.length} de las ${total} operaciones ${planWord}; ${failed.length === 1 ? 'una no se pudo calcular' : `${failed.length} no se pudieron calcular`}.`
      : `Se completaron ${total === 1 ? 'la operación' : `las ${total} operaciones`} ${planWord}.`
    if (missing.length) {
      headline = `${done} Sin embargo, quedaron pendientes otras partes del objetivo original, como ${joinList(missing.map((m) => lowerFirst(m.label)))}.`
    } else if (!input.objective || !coverage) {
      headline = `${done} No se registró un objetivo con el que comparar: no se puede establecer si el análisis lo responde por completo.`
    } else {
      headline = `${done} La revisión automática no detectó otras partes del objetivo sin calcular.`
    }
  }
  return {
    headline,
    tone: failed.length || missing.length || !ok.length ? 'warn' : 'ok',
    operations: { calculated: ok.length, total, plans: input.plans },
    calculated: ok.map((m) => `${m.ref} · ${m.operation}`),
    pending,
    notConcludable,
    caveat:
      'La cobertura se revisa comparando las palabras del objetivo con las operaciones calculadas. Es una ayuda, no una garantía: ' +
      'conviene confirmar que el informe responde a todo lo que se preguntó.',
  }
}

/** Variaciones entre el primer y el último período que el resumen descriptivo calculó con Pandas. */
const DERIVED_VARIATION = /; variación de [+\-−]?\d/
const VARIATION_WORD = /\bvariaci[oó]n(es)?\b/i
const NOT_AVAILABLE = /\b(no (disponibles?|est[aá]n?|es|son|hay|existe|se (puede|pueden|calcula|calculan|incluye|incluyen|obtiene|obtienen)|incluye|calcula|figura)|sin (una )?operaci[oó]n|fuera del cat[aá]logo|ninguna operaci[oó]n)/i
/** Pedidos que de verdad no se pueden responder: la aclaración nunca los toca. */
const REAL_LIMIT = /\b(caus\w*|motiv\w*|pron[oó]stic\w*|predic\w*|proyecc\w*|futur\w*|rentabilidad|margen|ganancia\w*)\b/i

/**
 * Hechos de una operación para «Hallazgos calculados», sin repetir los que ya figuran en
 * «Indicadores derivados»: en su lugar queda una remisión a esa sección.
 */
export function findingFacts(item: DescriptiveSummary['items'][number], derived: DerivedIndicator[]): string[] {
  const shown = new Set(derived.filter((d) => d.ref === item.ref).map((d) => d.fact))
  const rest = item.facts.filter((f) => !shown.has(f))
  if (!shown.size) return rest.length ? rest : ['Sin hechos destacados para esta operación.']
  const count = shown.size === 1 ? 'La variación de esta serie' : `Las variaciones de sus ${shown.size} series`
  return [...rest, `${count} entre el primer y el último período se detallan en «Indicadores derivados».`]
}

export function derivedIndicators(summary: DescriptiveSummary | null): DerivedIndicator[] {
  return (summary?.items ?? [])
    .filter((i) => i.status === 'ok')
    .flatMap((i) => i.facts.filter((f) => DERIVED_VARIATION.test(f)).map((fact) => ({ ref: i.ref, title: i.title, fact })))
}

/**
 * Una advertencia que dice que la variación no está disponible, cuando el resumen sí la calculó,
 * se conserva tal cual pero con una aclaración: lo que falta es una operación independiente del
 * catálogo, no el dato. Las limitaciones reales (causas, pronósticos, rentabilidad) no se tocan.
 */
export function clarifyWarnings(warnings: string[], derived: DerivedIndicator[]): ReportWarning[] {
  const refs = [...new Set(derived.map((d) => d.ref))]
  return warnings.map((text) => {
    const contradicted = refs.length > 0 && VARIATION_WORD.test(text) && NOT_AVAILABLE.test(text) && !REAL_LIMIT.test(text)
    return {
      text,
      clarification: contradicted
        ? `Aclaración: el catálogo no tiene una operación independiente para esa variación, pero la variación entre el primer y el último período sí se calculó como indicador derivado de los resultados de Pandas (${joinList(refs)}; ver «Indicadores derivados»).`
        : null,
    }
  })
}

export function buildReport(input: {
  run: ExecutionResponse
  objective: string | null
  projectName: string
  fileNames: Record<string, string>
  interpretation: AIInterpretationResult | null
  /** Cobertura del objetivo calculada en «Resultados» (la misma comprobación local, sin IA). */
  coverage?: PlanCoverage | null
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
  const objective = input.objective?.trim() || null
  const summary = run.summary ?? null
  const derived = derivedIndicators(summary)
  const uniqueWarnings = [...new Set(warnings)]
  return {
    title: 'Informe de análisis e interpretación',
    projectName: input.projectName,
    generatedAt: input.now ?? new Date(),
    executedAt: run.executed_at,
    objective,
    status: runSummary(run).status,
    sources: run.sources.map((s) => ({ ...s, fileName: input.fileNames[s.alias] ?? null })),
    methodology,
    engineNotes: run.notes,
    plans,
    summary,
    interpretation: input.interpretation,
    warnings: uniqueWarnings,
    scope: reportScope({ objective, methodology, plans: run.results.length, coverage: input.coverage ?? null }),
    derived,
    warningNotes: clarifyWarnings([...new Set([...uniqueWarnings, ...run.notes])], derived),
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
