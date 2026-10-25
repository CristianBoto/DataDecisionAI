import type { Chart, ChartType } from '@/types/domain'
import type { ExecutionResponse, OperationResult, PlanResult, ResultMeasure } from '@/services/analysisEngine'

/**
 * Del resultado del motor Pandas a un dashboard (Fase 4B).
 *
 * Funciones puras: reciben el JSON de `/api/analysis/execute` y devuelven qué
 * mostrar (indicadores, gráficos de Recharts, tablas y avisos). No calculan
 * nada nuevo: cada número de un gráfico es una celda de una tabla del motor.
 *
 * Selección de visualizaciones, por cada operación con resultados:
 * - sin dimensiones (un solo valor)           → tarjeta de indicador (KPI);
 * - una dimensión temporal (mes o año)        → líneas;
 * - temporal + una categoría                  → líneas, una serie por categoría;
 * - una categoría                             → barras;
 * - dos categorías                            → barras agrupadas;
 * - porcentajes (`share_pct`) válidos         → torta solo si el plan la pidió;
 * - más dimensiones o demasiados grupos       → solo tabla, con explicación.
 * Si el plan pidió un gráfico concreto, se usa ese tipo cuando los resultados
 * lo permiten; si no, se explica por qué y NO se reemplaza por otro.
 */

export const MAX_BAR_CATEGORIES = 30
export const MAX_SERIES = 6
export const MAX_PIE_SLICES = 6

export interface DashboardKpi {
  id: string
  label: string
  value: number
  unit: string | null
  /** Operación de origen (descripción del plan). */
  description: string
}

export interface PlanDashboard {
  planId: string
  title: string
  sourceAlias: string
  status: PlanResult['status']
  kpis: DashboardKpi[]
  charts: Chart[]
  /** Operaciones con resultados (para las tablas detalladas). */
  tables: OperationResult[]
  /** Operaciones que no se pudieron calcular, con su motivo. */
  errors: { title: string; message: string }[]
  /** Gráficos pedidos por el plan que no se pueden construir, y por qué. */
  notices: string[]
  warnings: string[]
}

export interface SourceDashboard {
  alias: string
  rows: number | null
  plans: PlanDashboard[]
}

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
  distinct_count: 'Valores distintos de',
  share_pct: 'Participación de',
}

const CHART_NAMES: Record<string, string> = {
  bar: 'barras', line: 'líneas', pie: 'torta', histogram: 'histograma', scatter: 'dispersión', box: 'caja', table: 'tabla', kpi: 'indicador',
}

export function operationTitle(op: OperationResult): string {
  return `${OPERATION_LABELS[op.operation] ?? op.operation}${op.description ? ` · ${op.description}` : ''}`
}

export function measureLabel(m: ResultMeasure): string {
  if (m.aggregate === 'count') return 'Registros'
  return `${AGGREGATE_LABELS[m.aggregate] ?? m.aggregate} ${m.column}`
}

function dimensionLabel(op: OperationResult, index: number): string {
  const name = op.dimensions[index]
  return index === 0 && op.period ? `${name} (${op.period === 'month' ? 'mes' : 'año'})` : name
}

/** Medidas graficables agrupadas por unidad: nunca se mezclan unidades distintas en un mismo eje. */
function measuresByUnit(op: OperationResult): { unit: string | null; indexes: number[] }[] {
  const groups: { unit: string | null; indexes: number[] }[] = []
  op.measures.forEach((m, i) => {
    if (m.aggregate === 'share_pct') return
    const group = groups.find((g) => g.unit === m.unit)
    if (group) group.indexes.push(i)
    else groups.push({ unit: m.unit, indexes: [i] })
  })
  return groups
}

interface ChartRequest {
  type: string
  x: string | null
  y: string | null
  title: string
}

/** Tipo de gráfico automático para una operación, o null si conviene solo la tabla. */
function autoType(op: OperationResult): ChartType | null {
  if (op.dimensions.length === 0 || op.dimensions.length > 2) return null
  return op.period ? 'line' : 'bar'
}

/** ¿Se puede construir este tipo con estos resultados? Devuelve el motivo si no. */
function incompatibility(op: OperationResult, type: string): string | null {
  const dims = op.dimensions.length
  switch (type) {
    case 'line':
      return op.period ? null : 'un gráfico de líneas necesita una dimensión temporal (mes o año)'
    case 'bar':
      return dims >= 1 && dims <= 2 ? null : 'un gráfico de barras necesita una o dos dimensiones'
    case 'pie': {
      if (dims !== 1) return 'una torta necesita una sola dimensión'
      if (op.rows.length < 2 || op.rows.length > MAX_PIE_SLICES) return `una torta necesita entre 2 y ${MAX_PIE_SLICES} grupos`
      const values = op.rows.map((r) => r.values[0])
      if (values.some((v) => v === null || v < 0)) return 'una torta necesita valores no negativos en todos los grupos'
      if (values.reduce<number>((a, v) => a + (v ?? 0), 0) <= 0) return 'el total es cero: no hay proporciones válidas'
      if (op.measures[0]?.aggregate === 'mean' || op.measures[0]?.aggregate === 'median') {
        return 'los promedios o medianas no forman partes de un total'
      }
      return null
    }
    case 'kpi':
      return dims === 0 ? null : 'un indicador necesita un único valor (sin agrupaciones)'
    case 'table':
      return null
    default:
      return `el gráfico de ${CHART_NAMES[type] ?? type} requiere los datos fila a fila, y el motor devuelve resultados agregados`
  }
}

let chartSeq = 0

/** Convierte una operación con resultados en uno o más gráficos de Recharts (uno por unidad). */
export function operationCharts(op: OperationResult, type: ChartType, title?: string): { charts: Chart[]; notice: string | null } {
  const charts: Chart[] = []
  if (type === 'pie') {
    const m = op.measures[0]
    charts.push({
      id: `c${(chartSeq += 1)}`,
      type: 'pie',
      title: title ?? operationTitle(op),
      description: `${measureLabel(m)} por ${dimensionLabel(op, 0)}`,
      xKey: 'x',
      animated: false,
      xLabel: dimensionLabel(op, 0),
      series: [{ key: 's0', label: measureLabel(m), unit: m.unit ?? undefined }],
      data: op.rows.map((r) => ({ x: r.keys[0], s0: r.values[0] })),
    })
    return { charts, notice: null }
  }

  for (const group of measuresByUnit(op)) {
    if (op.dimensions.length === 1) {
      if (type === 'bar' && op.rows.length > MAX_BAR_CATEGORIES) {
        return { charts, notice: `«${operationTitle(op)}» tiene ${op.rows.length} grupos: se muestra solo la tabla para que el gráfico sea legible.` }
      }
      charts.push({
        id: `c${(chartSeq += 1)}`,
        type,
        title: title ?? operationTitle(op),
        description: `${group.indexes.map((i) => measureLabel(op.measures[i])).join(', ')} por ${dimensionLabel(op, 0)}`,
        xKey: 'x',
      animated: false,
        xLabel: dimensionLabel(op, 0),
        yLabel: group.unit ?? undefined,
        series: group.indexes.map((i) => ({ key: `s${i}`, label: measureLabel(op.measures[i]), unit: op.measures[i].unit ?? undefined })),
        data: op.rows.map((r) => Object.fromEntries([['x', r.keys[0]], ...group.indexes.map((i) => [`s${i}`, r.values[i]])])),
      })
      continue
    }
    // Dos dimensiones: se pivota la segunda como series (una por categoría), con la primera medida del grupo.
    const measure = group.indexes[0]
    const categories = [...new Set(op.rows.map((r) => r.keys[1]))]
    if (categories.length > MAX_SERIES) {
      return { charts, notice: `«${operationTitle(op)}» tiene ${categories.length} categorías en ${op.dimensions[1]}: se muestra solo la tabla.` }
    }
    const xs = [...new Set(op.rows.map((r) => r.keys[0]))]
    const data = xs.map((x) => {
      const row: Record<string, string | number | null> = { x }
      categories.forEach((c, j) => {
        // Cada celda es exactamente un valor del motor (sin sumar ni repetir filas).
        row[`s${j}`] = op.rows.find((r) => r.keys[0] === x && r.keys[1] === c)?.values[measure] ?? null
      })
      return row
    })
    charts.push({
      id: `c${(chartSeq += 1)}`,
      type,
      title: title ?? operationTitle(op),
      description: `${measureLabel(op.measures[measure])} por ${dimensionLabel(op, 0)} y ${op.dimensions[1]}`,
      xKey: 'x',
      animated: false,
      xLabel: dimensionLabel(op, 0),
      yLabel: group.unit ?? undefined,
      series: categories.map((c, j) => ({ key: `s${j}`, label: c, unit: op.measures[measure].unit ?? undefined })),
      data,
    })
  }
  return { charts, notice: null }
}

function kpisFor(op: OperationResult): DashboardKpi[] {
  if (op.dimensions.length !== 0 || op.rows.length === 0) return []
  return op.measures.flatMap((m, i) => {
    const value = op.rows[0].values[i]
    return value === null ? [] : [{ id: `${op.operation}-${i}-${m.column}`, label: measureLabel(m), value, unit: m.unit, description: operationTitle(op) }]
  })
}

/** ¿Este pedido del plan corresponde a esta operación (mismos ejes)? */
function matches(request: ChartRequest, op: OperationResult): boolean {
  const xOk = !request.x || op.dimensions.includes(request.x)
  const yOk = !request.y || op.measures.some((m) => m.column === request.y) || (request.y === 'registros' && op.measures.some((m) => m.aggregate === 'count'))
  return xOk && yOk
}

export function planDashboard(plan: PlanResult): PlanDashboard {
  const ok = plan.operations.filter((op) => op.status === 'ok' && op.rows.length > 0)
  const dashboard: PlanDashboard = {
    planId: plan.plan_id,
    title: plan.title,
    sourceAlias: plan.source_alias,
    status: plan.status,
    kpis: ok.flatMap(kpisFor),
    charts: [],
    tables: ok,
    errors: plan.operations
      .filter((op) => op.status === 'error')
      .map((op) => ({ title: operationTitle(op), message: op.error ?? 'Error desconocido.' })),
    notices: [],
    warnings: plan.warnings,
  }

  // 1) Los gráficos que pidió el plan, con su tipo, si los resultados lo permiten.
  const covered = new Set<OperationResult>()
  for (const request of plan.charts) {
    if (request.type === 'table' || request.type === 'kpi') continue // tablas e indicadores ya se muestran siempre
    const candidates = ok.filter((op) => !covered.has(op) && matches(request, op))
    const name = CHART_NAMES[request.type] ?? request.type
    if (candidates.length === 0) {
      dashboard.notices.push(`El plan pidió un gráfico de ${name} («${request.title}»), pero ningún resultado calculado tiene esos ejes.`)
      continue
    }
    const target = candidates.find((op) => incompatibility(op, request.type) === null)
    if (!target) {
      // No se fabrica el gráfico pedido. La operación conserva su visualización estándar (si tiene),
      // y el aviso lo dice explícitamente: nada se reemplaza en silencio.
      dashboard.notices.push(
        `El plan pidió un gráfico de ${name} («${request.title}»), pero no se puede construir porque ${incompatibility(candidates[0], request.type)}. ` +
          `Los valores de «${operationTitle(candidates[0])}» se muestran en su tabla y, si corresponde, en su gráfico estándar.`,
      )
      continue
    }
    const built = operationCharts(target, request.type as ChartType, request.title)
    dashboard.charts.push(...built.charts)
    if (built.notice) dashboard.notices.push(built.notice)
    covered.add(target)
  }

  // 2) Las demás operaciones con resultados: un gráfico automático si corresponde.
  for (const op of ok) {
    if (covered.has(op)) continue
    const type = autoType(op)
    if (!type) {
      if (op.dimensions.length > 2) dashboard.notices.push(`«${operationTitle(op)}» combina ${op.dimensions.length} dimensiones: se muestra como tabla.`)
      continue
    }
    const built = operationCharts(op, type)
    dashboard.charts.push(...built.charts)
    if (built.notice) dashboard.notices.push(built.notice)
  }
  return dashboard
}

/** Un dashboard por fuente: los resultados de A, B y C nunca se mezclan. */
export function buildDashboard(run: ExecutionResponse): SourceDashboard[] {
  const aliases = [...new Set(run.results.map((r) => r.source_alias))].sort()
  return aliases.map((alias) => ({
    alias,
    rows: run.sources.find((s) => s.alias === alias)?.rows ?? null,
    plans: run.results.filter((r) => r.source_alias === alias).map(planDashboard),
  }))
}
