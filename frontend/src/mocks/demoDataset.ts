import type { AnalysisResults, Chart, Dataset, DatasetProfile, Finding, Indicator } from '@/types/domain'

/**
 * ⚠️ DATOS FICTICIOS DE DEMOSTRACIÓN ⚠️
 *
 * Todo lo que hay en este archivo fue inventado para mostrar la interfaz.
 * No proviene de ningún archivo real ni de ningún cálculo. Se usa únicamente
 * cuando VITE_DEMO_MODE=true y el usuario elige el dataset de ejemplo.
 */

export const DEMO_DATASET_ID = 'demo_tienda_ficticia'

export const DEMO_SOURCE_NOTE =
  'Resultados DEMOSTRATIVOS generados a partir de un dataset ficticio («Tienda Ficticia»). No representan datos reales.'

export function createDemoDataset(): Dataset {
  return {
    id: DEMO_DATASET_ID,
    name: 'Tienda Ficticia — ventas 2025 (DEMO)',
    fileName: 'ventas_tienda_ficticia_demo.csv',
    format: 'csv',
    sizeBytes: 96_512,
    uploadedAt: new Date().toISOString(),
    source: 'demo',
    status: 'ready',
  }
}

const previewRows: Record<string, string>[] = [
  { fecha: '2025-01-03', producto: 'Agua mineral 1,5 L', categoria: 'Bebidas', region: 'Centro', canal: 'Local', unidades: '24', precio_unitario: '850', ingreso: '20400' },
  { fecha: '2025-01-03', producto: 'Galletitas surtidas', categoria: 'Almacén', region: 'Norte', canal: 'Online', unidades: '12', precio_unitario: '1200', ingreso: '14400' },
  { fecha: '2025-01-04', producto: 'Detergente 750 ml', categoria: 'Limpieza', region: 'Sur', canal: 'Local', unidades: '8', precio_unitario: '2100', ingreso: '16800' },
  { fecha: '2025-01-04', producto: 'Yerba 1 kg', categoria: 'Almacén', region: 'Centro', canal: 'Local', unidades: '15', precio_unitario: '3900', ingreso: '58500' },
  { fecha: '2025-01-05', producto: 'Gaseosa 2,25 L', categoria: 'Bebidas', region: 'Oeste', canal: 'Online', unidades: '18', precio_unitario: '2300', ingreso: '41400' },
  { fecha: '2025-01-05', producto: 'Jabón líquido', categoria: 'Higiene', region: 'Norte', canal: 'Local', unidades: '', precio_unitario: '1750', ingreso: '' },
  { fecha: '2025-01-06', producto: 'Arroz 1 kg', categoria: 'Almacén', region: 'Sur', canal: 'Online', unidades: '20', precio_unitario: '1450', ingreso: '29000' },
  { fecha: '2025-01-06', producto: 'Jugo en polvo', categoria: 'Bebidas', region: 'Centro', canal: 'Local', unidades: '40', precio_unitario: '450', ingreso: '18000' },
]

export function createDemoProfile(): DatasetProfile {
  return {
    datasetId: DEMO_DATASET_ID,
    origin: 'demo',
    isComplete: true,
    rowCount: 1440,
    rowCountIsEstimate: false,
    columnCount: 8,
    columns: [
      { name: 'fecha', inferredType: 'date', nonNullCount: 1440, nullCount: 0, uniqueCount: 362, sampleValues: ['2025-01-03', '2025-01-04'] },
      { name: 'producto', inferredType: 'text', nonNullCount: 1440, nullCount: 0, uniqueCount: 48, sampleValues: ['Agua mineral 1,5 L', 'Yerba 1 kg'] },
      { name: 'categoria', inferredType: 'text', nonNullCount: 1440, nullCount: 0, uniqueCount: 5, sampleValues: ['Bebidas', 'Almacén', 'Limpieza'] },
      { name: 'region', inferredType: 'text', nonNullCount: 1440, nullCount: 0, uniqueCount: 4, sampleValues: ['Centro', 'Norte', 'Sur'] },
      { name: 'canal', inferredType: 'text', nonNullCount: 1440, nullCount: 0, uniqueCount: 2, sampleValues: ['Local', 'Online'] },
      { name: 'unidades', inferredType: 'numeric', nonNullCount: 1418, nullCount: 22, uniqueCount: 61, sampleValues: ['24', '12', '8'] },
      { name: 'precio_unitario', inferredType: 'numeric', nonNullCount: 1440, nullCount: 0, uniqueCount: 48, sampleValues: ['850', '1200'] },
      { name: 'ingreso', inferredType: 'numeric', nonNullCount: 1418, nullCount: 22, uniqueCount: 702, sampleValues: ['20400', '14400'] },
    ],
    previewRows,
    issues: [
      { severity: 'warning', column: 'unidades', message: '22 filas sin valor en «unidades» (1,5 %).' },
      { severity: 'warning', column: 'ingreso', message: '22 filas sin valor en «ingreso»; coinciden con los faltantes de «unidades».' },
      { severity: 'info', message: 'No se detectaron filas duplicadas.' },
      { severity: 'info', message: 'El dataset no incluye información de stock ni de costos.' },
    ],
    note: 'Perfil de un dataset FICTICIO incluido para demostrar la plataforma.',
  }
}

// ---------------------------------------------------------------------------
// Resultados ficticios
// ---------------------------------------------------------------------------

const months = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
const monthlyRevenue = [3.1, 3.0, 3.4, 3.6, 3.5, 3.8, 4.1, 4.0, 4.3, 4.6, 4.9, 5.9]
const monthlyLocal = [820, 790, 860, 880, 850, 900, 940, 910, 950, 980, 1010, 1180]
const monthlyOnline = [410, 420, 470, 510, 520, 570, 640, 660, 710, 760, 820, 990]

export const DEMO_CHARTS: Chart[] = [
  {
    id: 'chart_ingresos_mensuales',
    type: 'line',
    title: 'Ingresos mensuales',
    description: 'Evolución de la suma de «ingreso» por mes (millones de pesos).',
    xKey: 'mes',
    series: [{ key: 'ingresos', label: 'Ingresos (M$)', format: 'number' }],
    data: months.map((mes, i) => ({ mes, ingresos: monthlyRevenue[i] })),
  },
  {
    id: 'chart_ingresos_categoria',
    type: 'bar',
    title: 'Ingresos por categoría',
    description: 'Suma de «ingreso» agrupada por «categoria» (millones de pesos).',
    xKey: 'categoria',
    series: [{ key: 'ingresos', label: 'Ingresos (M$)', format: 'number' }],
    data: [
      { categoria: 'Bebidas', ingresos: 14.9 },
      { categoria: 'Almacén', ingresos: 13.2 },
      { categoria: 'Limpieza', ingresos: 9.1 },
      { categoria: 'Higiene', ingresos: 6.8 },
      { categoria: 'Congelados', ingresos: 4.2 },
    ],
  },
  {
    id: 'chart_unidades_canal',
    type: 'area',
    title: 'Unidades vendidas por canal',
    description: 'Suma mensual de «unidades» separada por «canal».',
    xKey: 'mes',
    series: [
      { key: 'local', label: 'Local', format: 'number' },
      { key: 'online', label: 'Online', format: 'number' },
    ],
    data: months.map((mes, i) => ({ mes, local: monthlyLocal[i], online: monthlyOnline[i] })),
  },
  {
    id: 'chart_distribucion_ticket',
    type: 'histogram',
    title: 'Distribución del ingreso por venta',
    description: 'Frecuencia de ventas según rango de «ingreso» (miles de pesos).',
    xKey: 'rango',
    xLabel: 'Ingreso por venta (miles $)',
    series: [{ key: 'ventas', label: 'Cantidad de ventas', format: 'number' }],
    data: [
      { rango: '0–10', ventas: 182 },
      { rango: '10–20', ventas: 356 },
      { rango: '20–30', ventas: 401 },
      { rango: '30–40', ventas: 248 },
      { rango: '40–50', ventas: 131 },
      { rango: '50–60', ventas: 64 },
      { rango: '60+', ventas: 36 },
    ],
  },
  {
    id: 'chart_ingresos_region',
    type: 'bar',
    title: 'Ingresos por región',
    description: 'Suma de «ingreso» agrupada por «region» (millones de pesos).',
    xKey: 'region',
    series: [{ key: 'ingresos', label: 'Ingresos (M$)', format: 'number' }],
    data: [
      { region: 'Centro', ingresos: 17.6 },
      { region: 'Norte', ingresos: 12.1 },
      { region: 'Sur', ingresos: 10.4 },
      { region: 'Oeste', ingresos: 8.1 },
    ],
  },
]

export const DEMO_INDICATORS: Indicator[] = [
  {
    id: 'kpi_ingresos_totales',
    label: 'Ingresos totales',
    value: 48_200_000,
    format: 'currency',
    change: 0.214,
    changeLabel: '2.º semestre vs. 1.º',
    description: 'Suma de «ingreso» en todo el período.',
  },
  {
    id: 'kpi_unidades',
    label: 'Unidades vendidas',
    value: 18_940,
    format: 'number',
    change: 0.168,
    changeLabel: '2.º semestre vs. 1.º',
    description: 'Suma de «unidades».',
  },
  {
    id: 'kpi_ticket_promedio',
    label: 'Ingreso promedio por venta',
    value: 33_990,
    format: 'currency',
    change: 0.041,
    changeLabel: '2.º semestre vs. 1.º',
    description: 'Promedio de «ingreso» por fila.',
  },
  {
    id: 'kpi_participacion_online',
    label: 'Participación online',
    value: 0.396,
    format: 'percent',
    change: 0.072,
    changeLabel: 'Dic vs. Ene (puntos)',
    description: 'Unidades del canal online sobre el total.',
  },
]

export const DEMO_FINDINGS: Finding[] = [
  {
    id: 'finding_crecimiento',
    title: 'Los ingresos crecen de forma sostenida',
    detail:
      'Los ingresos mensuales pasan de 3,1 M$ en enero a 5,9 M$ en diciembre. Diciembre concentra un pico estacional.',
    evidence: 'strong',
    relatedChartId: 'chart_ingresos_mensuales',
    recommendation: 'Planificar compras con mayor anticipación para el último trimestre.',
  },
  {
    id: 'finding_categorias',
    title: 'Bebidas y Almacén explican más de la mitad de los ingresos',
    detail: 'Entre ambas categorías suman 28,1 M$ de 48,2 M$ (58 %).',
    evidence: 'strong',
    relatedChartId: 'chart_ingresos_categoria',
    recommendation: 'Priorizar la disponibilidad de productos de estas categorías.',
  },
  {
    id: 'finding_online',
    title: 'El canal online gana participación',
    detail:
      'Las unidades online crecen más rápido que las del local. Con un solo año de datos no es posible confirmar si la tendencia se mantendrá.',
    evidence: 'moderate',
    relatedChartId: 'chart_unidades_canal',
  },
  {
    id: 'finding_region',
    title: 'La región Oeste tiene el menor nivel de ventas',
    detail:
      'Oeste registra 8,1 M$. El dataset no informa cantidad de clientes ni de sucursales por región, por lo que no se puede atribuir la diferencia a la demanda.',
    evidence: 'weak',
    relatedChartId: 'chart_ingresos_region',
  },
]

export const DEMO_LIMITATIONS: string[] = [
  'Los datos son ficticios y cubren un solo año: no permiten comparar estacionalidad entre años.',
  'No hay información de stock ni de costos: no se pueden calcular márgenes ni cantidades óptimas de compra.',
  '22 filas sin «unidades» ni «ingreso» quedaron excluidas de los totales.',
]

/** Arma resultados ficticios filtrando los gráficos e indicadores incluidos en el plan. */
export function createDemoResults(
  projectId: string,
  chartIds?: string[],
  indicatorIds?: string[],
): AnalysisResults {
  const charts = chartIds ? DEMO_CHARTS.filter((c) => chartIds.includes(c.id)) : DEMO_CHARTS
  const indicators = indicatorIds
    ? DEMO_INDICATORS.filter((k) => indicatorIds.includes(k.id))
    : DEMO_INDICATORS
  const visibleCharts = new Set(charts.map((c) => c.id))
  return {
    projectId,
    status: 'available',
    generatedAt: new Date().toISOString(),
    isDemo: true,
    sourceNote: DEMO_SOURCE_NOTE,
    indicators,
    charts,
    findings: DEMO_FINDINGS.filter((f) => !f.relatedChartId || visibleCharts.has(f.relatedChartId)),
    limitations: DEMO_LIMITATIONS,
  }
}
