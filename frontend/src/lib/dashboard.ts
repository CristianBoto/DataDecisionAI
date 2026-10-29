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
 * - más dimensiones                          → se elige qué dimensión va en el eje, cuál
 *                                               como series y se FILTRAN las demás (una vista);
 * - dimensiones que definen qué se mide       → siempre filtradas (un indicador o una unidad
 *   (indicador, unidad: `split_dimensions`)     por vez): nunca se mezclan en un mismo eje;
 * - demasiadas categorías                     → se muestran las de mayor valor y se puede elegir.
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

/** Qué parte de un resultado multidimensional se grafica (la elige la persona en el dashboard). */
export interface ViewSelection {
  /** Dimensión del eje X. */
  x: string
  /** Dimensión cuyas categorías son series (líneas o barras agrupadas), o null. */
  series: string | null
  /** Valor fijado para cada una de las demás dimensiones. */
  filters: Record<string, string>
  /** Categorías de la serie que se muestran (como máximo MAX_SERIES). */
  seriesValues: string[]
}

/** Un gráfico del dashboard: la operación, el tipo y, si es explorable, la selección por defecto. */
export interface ChartView {
  id: string
  op: OperationResult
  type: ChartType
  title?: string
  /** true si la persona puede cambiar ejes, series o filtros. */
  explorable: boolean
  selection: ViewSelection | null
}

export interface PlanDashboard {
  planId: string
  title: string
  sourceAlias: string
  status: PlanResult['status']
  kpis: DashboardKpi[]
  /** Gráficos con la selección por defecto (lo que se ve al abrir el dashboard). */
  charts: Chart[]
  /** Las mismas vistas, para explorarlas (cambiar eje, series y filtros). */
  views: ChartView[]
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
  histogram: 'Histograma',
  scatter: 'Dispersión',
  roc_curve: 'Curva ROC',
}

/** Operaciones con una visualización propia (no se eligen por dimensiones). */
const FIXED_CHART: Record<string, ChartType> = { histogram: 'histogram', scatter: 'scatter', roc_curve: 'roc' }

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
  roc: 'curva ROC',
}

export function operationTitle(op: OperationResult): string {
  return `${OPERATION_LABELS[op.operation] ?? op.operation}${op.description ? ` · ${op.description}` : ''}`
}

/**
 * Nombre de una medida. Con `op`, una suma de valores positivos y negativos se llama «suma neta»:
 * no es el saldo de una cuenta ni un total de gastos o ingresos (el motor lo marca en `signed_measures`).
 */
export function measureLabel(m: ResultMeasure, op?: Pick<OperationResult, 'signed_measures'>): string {
  if (m.aggregate === 'sum' && op?.signed_measures?.includes(m.column)) return `Suma neta de ${m.column}`
  if (m.aggregate === 'count') return 'Registros'
  if (m.aggregate === 'value' || m.aggregate === 'fpr' || m.aggregate === 'tpr') return m.column
  return `${AGGREGATE_LABELS[m.aggregate] ?? m.aggregate} ${m.column}`
}

const PERIOD_LABELS: Record<string, string> = { day: 'día', month: 'mes', quarter: 'trimestre', semester: 'semestre', year: 'año' }

/** Dimensión temporal del resultado (versiones previas del motor: la primera si hay período). */
export function temporalDimension(op: OperationResult): string | null {
  if (!op.period) return null
  return op.temporal_dimension ?? op.dimensions[0] ?? null
}

export function dimensionName(op: OperationResult, name: string): string {
  return name === temporalDimension(op) && op.period ? `${name} (${PERIOD_LABELS[op.period] ?? op.period})` : name
}

function dimensionLabel(op: OperationResult, index: number): string {
  return dimensionName(op, op.dimensions[index])
}

// --- Exploración de resultados con varias dimensiones -------------------------------------

/** Valores distintos de una dimensión, en el orden del motor (cronológico para los períodos). */
export function dimensionValues(op: OperationResult, dimension: string): string[] {
  const index = op.dimensions.indexOf(dimension)
  return index < 0 ? [] : [...new Set(op.rows.map((r) => r.keys[index]))]
}

function splitDims(op: OperationResult): string[] {
  return (op.split_dimensions ?? []).filter((d) => op.dimensions.includes(d))
}

/** ¿Tiene sentido ofrecer controles? (más de una dimensión o dimensiones que definen la medida). */
export function isExplorable(op: OperationResult): boolean {
  if (FIXED_CHART[op.operation]) return false
  return op.dimensions.length > 1 || splitDims(op).length > 0
}

/** Dimensiones que pueden ir en el eje o como series (las que definen la medida, nunca). */
export function freeDimensions(op: OperationResult): string[] {
  const split = splitDims(op)
  return op.dimensions.filter((d) => !split.includes(d))
}

/** Categorías de mayor valor absoluto total (las más relevantes para mostrar primero). */
function topValues(op: OperationResult, dimension: string, rows: OperationResult['rows'], limit: number): string[] {
  const index = op.dimensions.indexOf(dimension)
  const totals = new Map<string, number>()
  for (const r of rows) totals.set(r.keys[index], (totals.get(r.keys[index]) ?? 0) + Math.abs(r.values[0] ?? 0))
  const ordered = dimensionValues(op, dimension).filter((v) => totals.has(v))
  if (ordered.length <= limit) return ordered
  const chosen = new Set([...ordered].sort((a, b) => (totals.get(b) ?? 0) - (totals.get(a) ?? 0)).slice(0, limit))
  return ordered.filter((v) => chosen.has(v))
}

/**
 * Selección por defecto: eje X = la dimensión temporal (o la primera libre); series = otra
 * dimensión libre, la de menos categorías; el resto, filtrado en su primer valor. Las
 * dimensiones que definen la medida siempre se filtran (un indicador o una unidad por vez).
 */
export function defaultSelection(op: OperationResult): ViewSelection {
  const free = freeDimensions(op)
  const temporal = temporalDimension(op)
  const x = temporal && free.includes(temporal) ? temporal : (free[0] ?? op.dimensions[0])
  const others = free.filter((d) => d !== x)
  const series = others.length ? [...others].sort((a, b) => dimensionValues(op, a).length - dimensionValues(op, b).length)[0] : null
  const filters: Record<string, string> = {}
  for (const d of op.dimensions) {
    if (d !== x && d !== series) filters[d] = dimensionValues(op, d)[0]
  }
  return normalizeSelection(op, { x, series, filters, seriesValues: [] })
}

/** Ajusta una selección (por ejemplo, después de cambiar el eje) para que siempre sea válida. */
export function normalizeSelection(op: OperationResult, selection: ViewSelection): ViewSelection {
  const x = op.dimensions.includes(selection.x) ? selection.x : op.dimensions[0]
  const series = selection.series && selection.series !== x && freeDimensions(op).includes(selection.series) ? selection.series : null
  // Filtros encadenados: cada uno ofrece solo valores que existen con los anteriores
  // (por ejemplo, al elegir otro indicador, la unidad pasa a la de ese indicador).
  const filters: Record<string, string> = {}
  for (const d of op.dimensions) {
    if (d === x || d === series) continue
    const index = op.dimensions.indexOf(d)
    const values = [...new Set(filteredRows(op, filters).map((r) => r.keys[index]))]
    filters[d] = values.includes(selection.filters[d]) ? selection.filters[d] : values[0]
  }
  let seriesValues: string[] = []
  if (series) {
    const visible = filteredRows(op, filters)
    const available = new Set(visible.map((r) => r.keys[op.dimensions.indexOf(series)]))
    seriesValues = selection.seriesValues.filter((v) => available.has(v)).slice(0, MAX_SERIES)
    if (seriesValues.length === 0) seriesValues = topValues(op, series, visible, MAX_SERIES)
  }
  return { x, series, filters, seriesValues }
}

function filteredRows(op: OperationResult, filters: Record<string, string>): OperationResult['rows'] {
  const fixed = Object.entries(filters).map(([d, v]) => [op.dimensions.indexOf(d), v] as const)
  return op.rows.filter((r) => fixed.every(([i, v]) => i < 0 || r.keys[i] === v))
}

/**
 * Recorta un resultado multidimensional a la selección: filas de los valores filtrados y solo
 * las dimensiones X (y series). No calcula nada: cada celda sigue siendo un valor del motor.
 */
export function sliceOperation(op: OperationResult, selection: ViewSelection): OperationResult {
  const keep = [selection.x, ...(selection.series ? [selection.series] : [])]
  const positions = keep.map((d) => op.dimensions.indexOf(d))
  const seriesIndex = selection.series ? op.dimensions.indexOf(selection.series) : -1
  const rows = filteredRows(op, selection.filters)
    .filter((r) => seriesIndex < 0 || selection.seriesValues.includes(r.keys[seriesIndex]))
    .map((r) => ({ keys: positions.map((i) => r.keys[i]), values: r.values }))
  const temporal = temporalDimension(op)
  return {
    ...op,
    dimensions: keep,
    rows,
    period: temporal && keep[0] === temporal ? op.period : null,
    temporal_dimension: temporal && keep[0] === temporal ? temporal : null,
    split_dimensions: [],
  }
}

/** Texto que describe los filtros aplicados (va en el subtítulo del gráfico). */
export function selectionCaption(op: OperationResult, selection: ViewSelection): string {
  return Object.entries(selection.filters)
    .map(([d, v]) => `${dimensionName(op, d)}: ${v}`)
    .join(' · ')
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

/** Tipo de gráfico automático para una operación, o null si conviene solo la tabla o indicadores. */
function autoType(op: OperationResult): ChartType | null {
  if (FIXED_CHART[op.operation]) return FIXED_CHART[op.operation]
  if (op.dimensions.length === 0) return null
  if (freeDimensions(op).length === 0) return null // solo dimensiones que definen la medida: indicadores por categoría
  const x = isExplorable(op) ? defaultSelection(op).x : op.dimensions[0]
  return x === temporalDimension(op) ? 'line' : 'bar'
}

/** ¿Se puede construir este tipo con estos resultados? Devuelve el motivo si no. */
function incompatibility(op: OperationResult, type: string): string | null {
  const dims = op.dimensions.length
  const fixed = FIXED_CHART[op.operation]
  if (fixed) {
    // Histograma, dispersión y ROC tienen una sola representación válida (el histograma también acepta barras).
    return fixed === type || (fixed === 'histogram' && type === 'bar')
      ? null
      : `«${operationTitle(op)}» se representa como ${CHART_NAMES[fixed]}`
  }
  if (type === 'histogram' || type === 'scatter' || type === 'roc') {
    return `el gráfico de ${CHART_NAMES[type]} requiere la operación correspondiente en el plan`
  }
  const explorable = isExplorable(op)
  switch (type) {
    case 'line':
      return op.period ? null : 'un gráfico de líneas necesita una dimensión temporal (mes, trimestre o año)'
    case 'bar':
      return dims >= 1 && (dims <= 2 || explorable) ? null : 'un gráfico de barras necesita una o dos dimensiones'
    case 'pie': {
      if (dims !== 1 || splitDims(op).length > 0) return 'una torta necesita una sola dimensión y una única magnitud'
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
/** Dispersión: cada punto es un par (x, y) calculado por el motor; el eje X es numérico. */
function scatterChart(op: OperationResult, title?: string): Chart {
  const [x, y] = op.measures
  const pearson = op.stats?.pearson
  return {
    id: `c${(chartSeq += 1)}`,
    type: 'scatter',
    title: title ?? operationTitle(op),
    description: `${y.column} según ${x.column}${typeof pearson === 'number' ? ` · r de Pearson = ${pearson.toFixed(3)}` : ''} · correlación no implica causalidad`,
    xKey: 'x',
    xLabel: x.unit ? `${x.column} (${x.unit})` : x.column,
    xUnit: x.unit ?? undefined,
    yLabel: y.unit ? `${y.column} (${y.unit})` : y.column,
    series: [{ key: 'y', label: y.column, unit: y.unit ?? undefined }],
    data: op.rows.map((r) => ({ x: r.values[0], y: r.values[1] })),
    animated: false,
  }
}

/** ROC: tasa de falsos positivos (X) contra verdaderos positivos (Y), con la diagonal de referencia. */
function rocChart(op: OperationResult, title?: string): Chart {
  const auc = op.stats?.auc
  return {
    id: `c${(chartSeq += 1)}`,
    type: 'roc',
    title: title ?? operationTitle(op),
    description: `Clase positiva: «${op.stats?.positive_label}»${typeof auc === 'number' ? ` · AUC = ${auc.toFixed(3)}` : ''} · diagonal = azar`,
    xKey: 'x',
    xLabel: 'Tasa de falsos positivos',
    yLabel: 'Tasa de verdaderos positivos',
    series: [{ key: 'tpr', label: 'Tasa de verdaderos positivos' }],
    data: op.rows.map((r) => ({ x: r.values[0], tpr: r.values[1] })),
    animated: false,
  }
}

export function operationCharts(op: OperationResult, type: ChartType, title?: string): { charts: Chart[]; notice: string | null } {
  const charts: Chart[] = []
  if (op.operation === 'scatter') return { charts: [scatterChart(op, title)], notice: null }
  if (op.operation === 'roc_curve') return { charts: [rocChart(op, title)], notice: null }
  if (op.operation === 'histogram') type = 'histogram'
  if (type === 'pie') {
    const m = op.measures[0]
    charts.push({
      id: `c${(chartSeq += 1)}`,
      type: 'pie',
      title: title ?? operationTitle(op),
      description: `${measureLabel(m, op)} por ${dimensionLabel(op, 0)}`,
      xKey: 'x',
      animated: false,
      xLabel: dimensionLabel(op, 0),
      series: [{ key: 's0', label: measureLabel(m, op), unit: m.unit ?? undefined }],
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
        description: `${group.indexes.map((i) => measureLabel(op.measures[i], op)).join(', ')} por ${dimensionLabel(op, 0)}`,
        xKey: 'x',
      animated: false,
        xLabel: dimensionLabel(op, 0),
        yLabel: group.unit ?? undefined,
        series: group.indexes.map((i) => ({ key: `s${i}`, label: measureLabel(op.measures[i], op), unit: op.measures[i].unit ?? undefined })),
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
      description: `${measureLabel(op.measures[measure], op)} por ${dimensionLabel(op, 0)} y ${op.dimensions[1]}`,
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

function statKpi(op: OperationResult, key: string, label: string): DashboardKpi[] {
  const value = op.stats?.[key]
  return typeof value === 'number' ? [{ id: `${op.operation}-${key}`, label, value, unit: null, description: operationTitle(op) }] : []
}

/** Resultado cuyas únicas dimensiones definen la medida (por ejemplo, el total de cada indicador). */
function splitOnlyKpis(op: OperationResult): DashboardKpi[] {
  if (op.dimensions.length === 0 || freeDimensions(op).length > 0 || op.rows.length > 12) return []
  return op.rows.flatMap((row, r) =>
    op.measures.flatMap((m, i) => {
      const value = row.values[i]
      if (value === null || m.aggregate === 'share_pct') return []
      return [{ id: `${op.operation}-${r}-${i}`, label: `${measureLabel(m, op)} · ${row.keys.join(' · ')}`, value, unit: m.unit, description: operationTitle(op) }]
    }),
  )
}

function kpisFor(op: OperationResult): DashboardKpi[] {
  // Indicadores de los estadísticos calculados por el motor (no de las filas del gráfico).
  if (op.operation === 'scatter') {
    return [...statKpi(op, 'pearson', 'Correlación de Pearson (r)'), ...statKpi(op, 'spearman', 'Correlación de Spearman (ρ)'), ...statKpi(op, 'n', 'Pares de valores')]
  }
  if (op.operation === 'roc_curve') {
    return [...statKpi(op, 'auc', 'AUC (área bajo la curva ROC)'), ...statKpi(op, 'positives', 'Casos positivos'), ...statKpi(op, 'negatives', 'Casos negativos')]
  }
  if (op.operation === 'histogram') return []
  if (op.dimensions.length !== 0) return splitOnlyKpis(op)
  if (op.rows.length === 0) return []
  return op.measures.flatMap((m, i) => {
    const value = op.rows[0].values[i]
    return value === null ? [] : [{ id: `${op.operation}-${i}-${m.column}`, label: measureLabel(m, op), value, unit: m.unit, description: operationTitle(op) }]
  })
}

/** ¿Este pedido del plan corresponde a esta operación (mismos ejes)? */
function matches(request: ChartRequest, op: OperationResult): boolean {
  if (FIXED_CHART[op.operation]) {
    // Histograma, dispersión y ROC se identifican por sus columnas, no por dimensiones.
    const cols = op.columns
    return (!request.x || cols.includes(request.x)) && (!request.y || cols.includes(request.y))
  }
  const xOk = !request.x || op.dimensions.includes(request.x) || op.columns.includes(request.x)
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
    views: [],
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
    addView(dashboard, target, request.type as ChartType, request.title)
    covered.add(target)
  }

  // 2) Las demás operaciones con resultados: un gráfico automático si corresponde.
  for (const op of ok) {
    if (covered.has(op)) continue
    const type = autoType(op)
    if (!type) {
      if (op.dimensions.length > 0 && freeDimensions(op).length === 0 && op.rows.length > 12) {
        dashboard.notices.push(`«${operationTitle(op)}» tiene ${op.rows.length} categorías distintas de medida: se muestra como tabla.`)
      }
      continue
    }
    addView(dashboard, op, type)
  }
  return dashboard
}

let viewSeq = 0

/** Gráficos de una vista con su selección (los mismos que ve el componente al abrir el dashboard). */
export function viewCharts(view: Pick<ChartView, 'op' | 'type' | 'title'>, selection: ViewSelection | null): { charts: Chart[]; notice: string | null } {
  if (!selection) return operationCharts(view.op, view.type, view.title)
  const sliced = sliceOperation(view.op, selection)
  const caption = selectionCaption(view.op, selection)
  const type = view.type === 'line' && !sliced.period ? 'bar' : view.type
  const built = operationCharts(sliced, type, view.title)
  const total = selection.series ? dimensionValues(filteredLike(view.op, selection), selection.series).length : 0
  const extra = selection.series && total > selection.seriesValues.length
    ? `Se muestran ${selection.seriesValues.length} de ${total} categorías de «${selection.series}» (las de mayor valor); elegí otras en «Series».`
    : null
  for (const chart of built.charts) {
    chart.description = [chart.description, caption].filter(Boolean).join(' · ')
  }
  return { charts: built.charts, notice: built.notice ?? extra }
}

function filteredLike(op: OperationResult, selection: ViewSelection): OperationResult {
  return { ...op, rows: filteredRows(op, selection.filters) }
}

function addView(dashboard: PlanDashboard, op: OperationResult, type: ChartType, title?: string) {
  const explorable = isExplorable(op)
  const selection = explorable ? defaultSelection(op) : null
  const view: ChartView = { id: `v${(viewSeq += 1)}`, op, type, title, explorable, selection }
  const built = viewCharts(view, selection)
  dashboard.views.push(view)
  dashboard.charts.push(...built.charts)
  if (built.notice) dashboard.notices.push(built.notice)
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

export interface RunSummary {
  /** complete: todo calculado · partial: algunas operaciones fallaron · empty: nada que mostrar. */
  status: 'complete' | 'partial' | 'empty'
  computed: number
  total: number
  plans: number
}

/** Estado global de una ejecución, para el encabezado de la sección de resultados. */
export function runSummary(run: ExecutionResponse): RunSummary {
  const operations = run.results.flatMap((r) => r.operations)
  const computed = operations.filter((op) => op.status === 'ok').length
  const status = computed === 0 ? 'empty' : computed === operations.length ? 'complete' : 'partial'
  return { status, computed, total: operations.length, plans: run.results.length }
}
