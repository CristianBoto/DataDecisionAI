/**
 * Fase 4B — Dashboard de resultados reales.
 *
 * `fixtures/dashboardResponse.json` es la respuesta REAL de `analysis_engine.py`
 * para el CSV obligatorio (fuente A) y un archivo independiente (fuente B):
 * los gráficos deben mostrar exactamente esos números, sin inventar ni duplicar.
 */
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AnalysisResults } from '@/components/analysis/AnalysisResults'
import { buildDashboard, operationCharts, planDashboard } from '@/lib/dashboard'
import type { ExecutionResponse, OperationResult, PlanResult } from '@/services/analysisEngine'
import dashboardFixture from './fixtures/dashboardResponse.json'

const run = dashboardFixture as ExecutionResponse

function sourceA() {
  return buildDashboard(run).find((s) => s.alias === 'A')!.plans[0]
}

function op(partial: Partial<OperationResult>): OperationResult {
  return {
    operation: 'group_by', description: '', columns: [], group_by: [], status: 'ok', dimensions: [], measures: [],
    rows: [], period: null, rows_used: 1, warnings: [], error: null, ...partial,
  }
}

function plan(operations: OperationResult[], charts: PlanResult['charts'] = []): PlanResult {
  return { plan_id: 'p', source_alias: 'A', title: 'Plan', status: 'ok', operations, charts, warnings: [] }
}

describe('de resultados de Pandas a datos de Recharts', () => {
  it('evolución mensual por sector: una serie por sector con los valores exactos del motor', () => {
    const chart = sourceA().charts.find((c) => c.title === 'Evolución mensual de ventas por sector')!
    expect(chart.type).toBe('line') // tipo pedido por el plan
    expect(chart.series.map((s) => s.label)).toEqual(['Indumentaria', 'Tecnologia'])
    expect(chart.series.every((s) => s.unit === 'ARS')).toBe(true)
    expect(chart.yLabel).toBe('ARS')
    expect(chart.data).toEqual([
      { x: '2026-01', s0: 8000, s1: 15000 },
      { x: '2026-02', s0: 9500, s1: 18000 },
      { x: '2026-03', s0: 11000, s1: 21000 },
    ])
    // Sin duplicar: cada mes suma lo mismo que el total mensual del motor, y cada serie suma su total por sector.
    const monthly = chart.data.map((row) => (row.s0 as number) + (row.s1 as number))
    expect(monthly).toEqual([23000, 27500, 32000])
    expect(chart.data.reduce((a, r) => a + (r.s1 as number), 0)).toBe(54000)
    expect(chart.data.reduce((a, r) => a + (r.s0 as number), 0)).toBe(28500)
  })

  it('total mensual en líneas, comparación por sector en torta (pedida por el plan) y total como indicador', () => {
    const dashboard = sourceA()
    const monthly = dashboard.charts.find((c) => c.title.includes('Ventas totales por mes'))!
    expect(monthly.type).toBe('line')
    expect(monthly.data).toEqual([{ x: '2026-01', s0: 23000 }, { x: '2026-02', s0: 27500 }, { x: '2026-03', s0: 32000 }])
    const pie = dashboard.charts.find((c) => c.title === 'Participación de cada sector')!
    expect(pie.type).toBe('pie')
    expect(pie.data).toEqual([{ x: 'Indumentaria', s0: 28500 }, { x: 'Tecnologia', s0: 54000 }])
    expect(dashboard.kpis).toEqual([
      expect.objectContaining({ label: 'Suma de ventas', value: 82500, unit: 'ARS', description: 'Suma · Total general' }),
    ])
    // Un gráfico por operación graficable: no se muestran todos los tipos siempre.
    expect(dashboard.charts.map((c) => c.type).sort()).toEqual(['line', 'line', 'pie'])
  })

  it('un gráfico pedido que no se puede construir se explica y no se fabrica', () => {
    const dashboard = sourceA()
    expect(dashboard.charts.some((c) => c.title === 'Dispersión de ventas')).toBe(false)
    expect(dashboard.notices).toEqual([
      expect.stringMatching(/gráfico de dispersión \(«Dispersión de ventas»\), pero no se puede construir porque .*requiere la operación correspondiente/),
    ])
  })

  it('errores parciales: la operación inválida se informa y el resto se grafica', () => {
    const dashboard = sourceA()
    expect(dashboard.status).toBe('partial')
    expect(dashboard.errors).toEqual([
      { title: 'Suma · Suma inválida', message: expect.stringContaining('«sector» es una columna categórica') },
    ])
    expect(dashboard.tables).toHaveLength(4)
  })

  it('las fuentes independientes no se mezclan', () => {
    const [a, b] = buildDashboard(run)
    expect([a.alias, b.alias]).toEqual(['A', 'B'])
    expect(a.rows).toBe(6)
    expect(b.rows).toBe(3)
    const bChart = b.plans[0].charts[0]
    expect(bChart.title).toBe('CIF importado por año')
    expect(bChart.type).toBe('bar') // el plan pidió barras y hay una dimensión
    expect(bChart.data).toEqual([{ x: '2020', s0: 150 }, { x: '2021', s0: 70 }])
    expect(bChart.series[0].unit).toBe('USD')
    const aValues = JSON.stringify(a.plans.flatMap((p) => p.charts.map((c) => c.data)))
    expect(aValues).not.toMatch(/2020|2021|"s0":150/)
  })

  it('torta solo con proporciones válidas: no con promedios ni con valores negativos', () => {
    const mean = op({ dimensions: ['sector'], measures: [{ column: 'ventas', aggregate: 'mean', unit: 'ARS' }], rows: [{ keys: ['A'], values: [10] }, { keys: ['B'], values: [20] }] })
    const result = planDashboard(plan([mean], [{ type: 'pie', x: 'sector', y: 'ventas', title: 'Torta de promedios' }]))
    expect(result.charts.some((c) => c.type === 'pie')).toBe(false)
    expect(result.notices[0]).toMatch(/promedios o medianas no forman partes de un total/)

    const negative = op({ dimensions: ['sector'], measures: [{ column: 'saldo', aggregate: 'sum', unit: null }], rows: [{ keys: ['A'], values: [-5] }, { keys: ['B'], values: [20] }] })
    expect(planDashboard(plan([negative], [{ type: 'pie', x: 'sector', y: 'saldo', title: 'T' }])).notices[0]).toMatch(/no negativos/)
  })

  it('un gráfico de líneas pedido sobre categorías no se construye: se explica', () => {
    const bySector = op({ dimensions: ['sector'], measures: [{ column: 'ventas', aggregate: 'sum', unit: 'ARS' }], rows: [{ keys: ['A'], values: [1] }, { keys: ['B'], values: [2] }] })
    const result = planDashboard(plan([bySector], [{ type: 'line', x: 'sector', y: 'ventas', title: 'Líneas por sector' }]))
    expect(result.charts.some((c) => c.type === 'line')).toBe(false)
    expect(result.notices[0]).toMatch(/necesita una dimensión temporal/)
    expect(result.charts.map((c) => c.type)).toEqual(['bar']) // visualización estándar, anunciada en el aviso
  })

  it('no mezcla unidades distintas en un mismo gráfico', () => {
    const mixed = op({
      dimensions: ['sector'],
      measures: [{ column: 'ventas', aggregate: 'sum', unit: 'ARS' }, { column: 'peso', aggregate: 'sum', unit: 'kg' }],
      rows: [{ keys: ['A'], values: [100, 5] }, { keys: ['B'], values: [200, 7] }],
    })
    const { charts } = operationCharts(mixed, 'bar')
    expect(charts.map((c) => c.yLabel)).toEqual(['ARS', 'kg'])
    expect(charts.map((c) => c.data)).toEqual([
      [{ x: 'A', s0: 100 }, { x: 'B', s0: 200 }],
      [{ x: 'A', s1: 5 }, { x: 'B', s1: 7 }],
    ])
  })

  it('demasiadas categorías: solo la tabla, con explicación', () => {
    const many = op({
      dimensions: ['producto'],
      measures: [{ column: 'registros', aggregate: 'count', unit: null }],
      rows: Array.from({ length: 40 }, (_, i) => ({ keys: [`P${i}`], values: [1] })),
    })
    const result = planDashboard(plan([many]))
    expect(result.charts).toHaveLength(0)
    expect(result.notices[0]).toMatch(/40 grupos: se muestra solo la tabla/)
  })

  it('un plan sin operaciones válidas no genera gráficos ni indicadores', () => {
    const failed = op({ status: 'error', error: 'La operación «std» todavía no está disponible.', rows: [] })
    const result = planDashboard({ ...plan([failed]), status: 'error' })
    expect(result.charts).toEqual([])
    expect(result.kpis).toEqual([])
    expect(result.tables).toEqual([])
    expect(result.errors).toHaveLength(1)
  })
})

describe('dashboard en pantalla', () => {
  it('una sección por fuente, con indicadores, gráficos, avisos y tablas exactas', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const user = userEvent.setup()
    render(<AnalysisResults run={run} fileNames={{ A: 'ventas.csv', B: 'siacam.csv' }} />)

    const a = screen.getByRole('region', { name: 'Fuente A' })
    const b = screen.getByRole('region', { name: 'Fuente B' })
    expect(a).toHaveTextContent('ventas.csv')
    expect(a).toHaveTextContent('6 filas')
    expect(b).toHaveTextContent('siacam.csv')

    const kpi = within(a).getByRole('group', { name: 'Indicador: Suma de ventas' })
    expect(kpi).toHaveTextContent('82.500ARS')
    expect(within(a).getByRole('note', { name: 'Gráficos no generados' })).toHaveTextContent('Dispersión de ventas')
    expect(within(a).getByText(/No se pudo calcular: «sector» es una columna categórica/)).toBeInTheDocument()
    expect(within(a).getByText('Parcial')).toBeInTheDocument()

    // Valores exactos del gráfico (vista de tabla del gráfico, con unidad).
    const evolution = within(a).getByRole('group', { name: 'Vista de Evolución mensual de ventas por sector' })
    await user.click(within(evolution).getByRole('button', { name: 'Tabla' }))
    const card = evolution.closest('div.flex.flex-col') as HTMLElement
    for (const value of ['8.000 ARS', '15.000 ARS', '9.500 ARS', '18.000 ARS', '11.000 ARS', '21.000 ARS']) {
      expect(card).toHaveTextContent(value)
    }

    // Tablas detalladas: los totales del caso obligatorio.
    const monthly = within(a).getByRole('group', { name: 'Resultado: Serie temporal · Ventas totales por mes' })
    for (const value of ['23.000 ARS', '27.500 ARS', '32.000 ARS']) expect(monthly).toHaveTextContent(value)
    const bySector = within(a).getByRole('group', { name: 'Resultado: Comparación entre grupos · Ventas acumuladas por sector' })
    expect(bySector).toHaveTextContent('54.000 ARS')
    expect(bySector).toHaveTextContent('28.500 ARS')
    expect(bySector).toHaveTextContent('65,45 %')

    // La fuente B solo muestra lo suyo.
    expect(b).toHaveTextContent('CIF importado por año')
    expect(b).not.toHaveTextContent('ARS')
    expect(a).not.toHaveTextContent('CIF')
    expect(fetchSpy).not.toHaveBeenCalled() // mostrar resultados no consulta a nadie (ni a OpenAI)
    fetchSpy.mockRestore()
  })

  it('sin resultados válidos muestra un estado vacío claro', () => {
    const empty: ExecutionResponse = {
      ...run,
      results: [{ ...run.results[1], status: 'error', operations: [{ ...run.results[1].operations[0], status: 'error', rows: [], error: 'Sin datos.' }] }],
    }
    render(<AnalysisResults run={empty} />)
    expect(screen.getByText('Sin resultados para mostrar')).toBeInTheDocument()
    expect(screen.getByText('Este plan no produjo resultados para mostrar')).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: /^Vista de/ })).not.toBeInTheDocument()
  })
})
