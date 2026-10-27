/**
 * Motor generalista en el frontend: revisión de las medidas, dashboard con varias
 * dimensiones (ejes, series y filtros), indicadores separados por magnitud y datos
 * sintéticos de prueba. Sin red ni OpenAI: la IA y el perfilado se simulan solo acá.
 */
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { ChartViewCard } from '@/components/analysis/ChartView'
import { AppProviders } from '@/context/AppProviders'
import {
  buildDashboard,
  defaultSelection,
  MAX_SERIES,
  normalizeSelection,
  planDashboard,
  runSummary,
  sliceOperation,
} from '@/lib/dashboard'
import { SAMPLE_DATASETS } from '@/lib/sampleDatasets'
import { routes } from '@/routes'
import type { AIGatewayClient } from '@/services/aiGateway'
import type { ExecutionResponse, OperationResult, PlanResult } from '@/services/analysisEngine'
import { adaptBackendProfile, type BackendProfileResponse } from '@/services/backendProfile'
import { createDemoService } from '@/services/demoProvider'
import { completeReview, goToReview } from './reviewHelpers'

function op(partial: Partial<OperationResult>): OperationResult {
  return {
    operation: 'sum', description: 'd', columns: [], group_by: [], status: 'ok', dimensions: [], measures: [],
    rows: [], period: null, rows_used: 1, warnings: [], error: null, ...partial,
  }
}

// Resultado de tres dimensiones (mes × región × canal), tal como lo devuelve el motor.
const CUBE = op({
  operation: 'sum', columns: ['unidades'], group_by: ['mes', 'region', 'canal'],
  dimensions: ['mes', 'region', 'canal'], period: 'month', temporal_dimension: 'mes',
  measures: [{ column: 'unidades', aggregate: 'sum', unit: null }],
  rows: ['2024-01', '2024-02', '2024-03'].flatMap((mes, m) =>
    [['Norte', 1], ['Sur', 2], ['Centro', 3]].flatMap(([region, r]) =>
      [['Online', 10], ['Local', 20]].map(([canal, c]) => ({ keys: [mes, region as string, canal as string], values: [(r as number) * (c as number) + m] })),
    ),
  ),
})

// Formato largo: indicadores con unidades distintas por año y zona.
const LONG = op({
  operation: 'time_series', columns: ['periodo', 'dato'], group_by: ['zona'],
  dimensions: ['periodo', 'zona', 'serie', 'unidad'], period: 'year', temporal_dimension: 'periodo', split_dimensions: ['serie', 'unidad'],
  measures: [{ column: 'dato', aggregate: 'value', unit: null }],
  rows: [
    { keys: ['2022', 'Este', 'desocupacion', '%'], values: [7] },
    { keys: ['2022', 'Oeste', 'desocupacion', '%'], values: [8] },
    { keys: ['2023', 'Este', 'desocupacion', '%'], values: [7.5] },
    { keys: ['2023', 'Oeste', 'desocupacion', '%'], values: [8.5] },
    { keys: ['2022', 'Este', 'ventas externas', 'millones USD'], values: [100] },
    { keys: ['2022', 'Oeste', 'ventas externas', 'millones USD'], values: [200] },
    { keys: ['2023', 'Este', 'ventas externas', 'millones USD'], values: [110] },
    { keys: ['2023', 'Oeste', 'ventas externas', 'millones USD'], values: [210] },
  ],
})

function plan(...operations: OperationResult[]): PlanResult {
  return { plan_id: 'p', source_alias: 'A', title: 'Plan', status: 'ok', operations, charts: [], warnings: [] }
}

describe('dashboard con varias dimensiones', () => {
  it('eje temporal, la dimensión con menos categorías como series y las demás filtradas', () => {
    const selection = defaultSelection(CUBE)
    expect(selection).toEqual({ x: 'mes', series: 'canal', filters: { region: 'Norte' }, seriesValues: ['Online', 'Local'] })
    const slice = sliceOperation(CUBE, selection)
    expect(slice.dimensions).toEqual(['mes', 'canal'])
    // Cada valor es una celda del motor (Norte: 1 × 10 + mes, 1 × 20 + mes), sin sumar regiones.
    expect(slice.rows.map((r) => [r.keys.join('/'), r.values[0]])).toEqual([
      ['2024-01/Online', 10], ['2024-01/Local', 20], ['2024-02/Online', 11], ['2024-02/Local', 21], ['2024-03/Online', 12], ['2024-03/Local', 22],
    ])
    const dashboard = planDashboard(plan(CUBE))
    expect(dashboard.charts).toHaveLength(1)
    expect(dashboard.charts[0].type).toBe('line')
    expect(dashboard.charts[0].description).toMatch(/region: Norte/)
    expect(dashboard.notices).toEqual([])
  })

  it('cambiar el eje o el filtro produce otra vista válida', () => {
    const byRegion = normalizeSelection(CUBE, { ...defaultSelection(CUBE), x: 'region', series: null })
    expect(byRegion.filters).toEqual({ mes: '2024-01', canal: 'Online' })
    expect(sliceOperation(CUBE, byRegion).rows.map((r) => r.values[0])).toEqual([10, 20, 30])
    const otherMonth = normalizeSelection(CUBE, { ...byRegion, filters: { ...byRegion.filters, mes: '2024-03' } })
    expect(sliceOperation(CUBE, otherMonth).rows.map((r) => r.values[0])).toEqual([12, 22, 32])
  })

  it('la dimensión temporal se reconoce aunque no sea la primera', () => {
    const swapped = op({ ...CUBE, dimensions: ['region', 'canal', 'mes'], rows: CUBE.rows.map((r) => ({ ...r, keys: [r.keys[1], r.keys[2], r.keys[0]] })) })
    const selection = defaultSelection(swapped)
    expect(selection.x).toBe('mes')
    expect(planDashboard(plan(swapped)).charts[0].xLabel).toBe('mes (mes)')
  })

  it('las dimensiones que definen la medida nunca se mezclan: un indicador y una unidad por vez', () => {
    const selection = defaultSelection(LONG)
    expect(selection.x).toBe('periodo')
    expect(selection.series).toBe('zona')
    expect(selection.filters).toEqual({ serie: 'desocupacion', unidad: '%' })
    // Aunque se pida, una dimensión de medida no puede ser eje ni series.
    expect(normalizeSelection(LONG, { ...selection, series: 'serie' }).series).toBeNull()
    const [chart] = planDashboard(plan(LONG)).charts
    expect(chart.description).toMatch(/serie: desocupacion · unidad: %/)
    expect(chart.data).toEqual([{ x: '2022', s0: 7, s1: 8 }, { x: '2023', s0: 7.5, s1: 8.5 }])
  })

  it('un total por indicador se muestra como indicadores separados, no como una suma', () => {
    const totals = op({
      dimensions: ['serie', 'unidad'], split_dimensions: ['serie', 'unidad'],
      measures: [{ column: 'dato', aggregate: 'sum', unit: null }],
      rows: [{ keys: ['desocupacion', '%'], values: [7.5] }, { keys: ['ventas externas', 'millones USD'], values: [620] }],
    })
    const dashboard = planDashboard(plan(totals))
    expect(dashboard.charts).toEqual([])
    expect(dashboard.kpis.map((k) => [k.label, k.value])).toEqual([
      ['Suma de dato · desocupacion · %', 7.5],
      ['Suma de dato · ventas externas · millones USD', 620],
    ])
  })

  it('con muchas categorías muestra las de mayor valor y lo explica', () => {
    const many = op({
      dimensions: ['mes', 'producto'], period: 'month', temporal_dimension: 'mes',
      measures: [{ column: 'unidades', aggregate: 'sum', unit: null }],
      rows: Array.from({ length: 10 }, (_, i) => ({ keys: ['2024-01', `P${i}`], values: [i] })),
    })
    const selection = defaultSelection(many)
    expect(selection.seriesValues).toHaveLength(MAX_SERIES)
    expect(selection.seriesValues).not.toContain('P0')
    expect(planDashboard(plan(many)).notices.join(' ')).toMatch(/Se muestran 6 de 10 categorías de «producto»/)
  })

  it('estado global de la ejecución', () => {
    const run = (ops: OperationResult[]): ExecutionResponse => ({ engine: 'pandas', executed_at: '', sources: [], results: [plan(...ops)], notes: [] })
    expect(runSummary(run([CUBE])).status).toBe('complete')
    expect(runSummary(run([CUBE, op({ status: 'error', error: 'x' })]))).toMatchObject({ status: 'partial', computed: 1, total: 2 })
    expect(runSummary(run([op({ status: 'error', error: 'x' })])).status).toBe('empty')
    expect(buildDashboard(run([CUBE]))[0].plans[0].views[0].explorable).toBe(true)
  })

  it('en pantalla: elegir otro filtro cambia el gráfico', async () => {
    const user = userEvent.setup()
    const [view] = planDashboard(plan(LONG)).views
    render(<ChartViewCard view={view} />)
    expect(screen.getByText(/serie: desocupacion · unidad: %/)).toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText(/Filtro serie de/), 'ventas externas')
    // La unidad se ajusta sola: no existe «ventas externas» en %.
    expect(screen.getByText(/serie: ventas externas · unidad: millones USD/)).toBeInTheDocument()
  })
})

// --- Revisión de las medidas (perfil del backend simulado) ----------------------------------

const PROFILE: BackendProfileResponse = {
  filename: 'indicadores.csv', format: 'csv', encoding: 'utf-8-sig', sheet_name: null, row_count: 24, column_count: 5,
  duplicate_rows: 0, completeness: 1, suspected_missing_cells: 0, preview: [], warnings: [],
  columns: [
    { name: 'periodo', missing: 0, non_empty: 24, distinct: 2, examples: ['2022-01-01'], value_kind: 'date', semantic_type: 'temporal', semantic_confidence: 'high' },
    { name: 'zona', missing: 0, non_empty: 24, distinct: 2, examples: ['Este'], value_kind: 'text', semantic_type: 'categorical', semantic_confidence: 'medium' },
    { name: 'serie', missing: 0, non_empty: 24, distinct: 3, examples: ['desocupacion'], value_kind: 'text', semantic_type: 'categorical', semantic_confidence: 'medium' },
    { name: 'unidad', missing: 0, non_empty: 24, distinct: 3, examples: ['%'], value_kind: 'text', semantic_type: 'categorical', semantic_confidence: 'medium' },
    {
      name: 'dato', missing: 0, non_empty: 24, distinct: 10, examples: ['7'], value_kind: 'numeric', semantic_type: 'quantitative', semantic_confidence: 'high',
      unit_suggestion: null, additivity_suggestion: 'additive', additivity_reason: 'Se asume que se puede sumar.',
      split_by_suggestion: ['serie', 'unidad'], split_reason: '«unidad» indica unidades distintas', missing_value_suggestions: ['-99'],
    },
  ],
}

function gateway() {
  return {
    status: vi.fn(async () => ({
      ai_enabled: true, provider_configured: true, external_calls_implemented: true, model: 'gpt-6-luna',
      budget_usd: 0.1, spent_usd: 0, remaining_usd: 0.1, requests_used: 0, max_requests: 15, max_output_tokens: 2500,
    })),
    prepare: vi.fn(async (payload) => ({
      request_id: 'r1', payload, payload_sha256: '1'.repeat(64), expires_in_seconds: 300,
      ai_enabled: true, external_calls_implemented: true, estimated_input_tokens: 1500, estimated_max_cost_usd: 0.0016,
    })),
    authorize: vi.fn(async (): Promise<unknown> => { throw new Error('no se usa') }),
    cancel: vi.fn(async () => undefined),
    approvePlan: vi.fn(async (planId: string) => ({ plan_id: planId, status: 'approved', executed: false })),
  } satisfies AIGatewayClient
}

describe('revisión de las medidas', () => {
  it('propone unidad, aditividad y dependencia; la persona corrige y la IA recibe solo metadatos', async () => {
    const user = userEvent.setup()
    const ai = gateway()
    const profiler = { profile: vi.fn(async (_file: File, id: string) => adaptBackendProfile(PROFILE, id)) }
    const router = createMemoryRouter(routes, { initialEntries: ['/analisis/cargar'] })
    render(
      <AppProviders service={createDemoService({ delayMs: 0, profiler })} aiGateway={ai} analysisEngine={null}>
        <RouterProvider router={router} />
      </AppProviders>,
    )
    // Datos sintéticos de prueba disponibles con backend; acá se carga un archivo propio (simulado).
    expect(screen.getByRole('group', { name: 'Datos sintéticos de prueba' })).toBeInTheDocument()
    await user.upload(await screen.findByTestId('file-input'), [new File(['x'], 'indicadores.csv', { type: 'text/csv' })])
    await waitFor(() => expect(screen.getAllByLabelText('Archivo listo')).toHaveLength(1))
    await goToReview(user)

    const measure = screen.getByRole('group', { name: 'Medida dato (fuente A)' })
    expect(within(measure).getByLabelText('dato depende de serie (fuente A)')).toBeChecked()
    expect(within(measure).getByLabelText('dato depende de unidad (fuente A)')).toBeChecked()
    expect(within(measure).getByLabelText('¿Se puede sumar dato? (fuente A)')).toHaveValue('additive')
    // Corrección explícita: la medida depende solo de «serie» y su unidad es mixta (sin unidad única).
    await user.click(within(measure).getByLabelText('dato depende de unidad (fuente A)'))
    // El marcador sugerido se aplica solo si la persona lo elige.
    await user.click(within(measure).getByRole('button', { name: 'Tratar -99 como faltante' }))
    expect(within(measure).getByLabelText('Valores faltantes de dato (fuente A)')).toHaveValue('-99')

    await completeReview(user, 'Comparar indicadores por zona')
    await screen.findByText(/IA real · gpt-6-luna/)
    await user.click(await screen.findByRole('button', { name: 'Comenzar conversación' }))
    await waitFor(() => expect(ai.prepare).toHaveBeenCalled())
    const sent = ai.prepare.mock.calls[0][0]
    const dato = sent.sources[0].columns.find((c: { name: string }) => c.name === 'dato')
    expect(dato).toMatchObject({ unit: null, additivity: 'additive', split_by: ['serie'] })
    // Las columnas que no son medidas no llevan esos campos, y ningún valor del dataset viaja a la IA.
    expect(sent.sources[0].columns.find((c: { name: string }) => c.name === 'zona')).not.toHaveProperty('split_by')
    expect(JSON.stringify(sent)).not.toMatch(/-99|desocupacion|Este/)
  })
})

describe('datos sintéticos de prueba', () => {
  it('son CSV determinísticos, identificados como datos de prueba, de temáticas distintas', () => {
    expect(SAMPLE_DATASETS.map((d) => d.key)).toEqual(['ventas', 'indicadores', 'clasificacion'])
    for (const sample of SAMPLE_DATASETS) {
      expect(sample.fileName).toMatch(/^datos-sinteticos-de-prueba-/)
      expect(sample.csv()).toBe(sample.csv())
    }
    expect(SAMPLE_DATASETS[1].csv().split('\n')[0]).toBe('periodo,region,indicador,unidad,valor')
    const roc = SAMPLE_DATASETS[2].csv().trim().split('\n').slice(1).map((l) => l.split(',')[1])
    expect(new Set(roc)).toEqual(new Set(['si', 'no']))
  })
})
