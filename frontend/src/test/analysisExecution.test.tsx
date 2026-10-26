/**
 * Fase 4A — «Ejecutar análisis» en el paso Confirmar.
 * Frontera de IA y motor de análisis falsos: no hay red, ni OpenAI, ni consumo.
 * La respuesta del motor es la que devuelve el backend real para el CSV
 * obligatorio (generada con `analysis_engine.py`: fixtures/analysisResponse.json).
 */
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { AppProviders } from '@/context/AppProviders'
import type { AnalysisReviewState } from '@/context/sessionContext'
import type { SessionAIPlan } from '@/lib/aiPlans'
import { buildExecution } from '@/lib/analysisRequest'
import type { AnalysisSource } from '@/lib/datasetCatalog'
import { routes } from '@/routes'
import { ApiError } from '@/services'
import type { AIAuthorizeResult, AIGatewayClient } from '@/services/aiGateway'
import type { AnalysisEngineClient, ExecutionResponse } from '@/services/analysisEngine'
import { createDemoService } from '@/services/demoProvider'
import analysisFixture from './fixtures/analysisResponse.json'
import { completeReview, goToReview, startConversation } from './reviewHelpers'

const CSV = [
  'fecha,sector,ventas',
  '2026-01-01,Tecnologia,15000',
  '2026-01-01,Indumentaria,8000',
  '2026-02-01,Tecnologia,18000',
  '2026-02-01,Indumentaria,9500',
  '2026-03-01,Tecnologia,21000',
  '2026-03-01,Indumentaria,11000',
].join('\n')

const PLAN: AIAuthorizeResult['reply']['plans'][number] = {
  source_alias: 'A',
  title: 'Ventas por mes y sector',
  rationale: 'Muestra la evolución y la comparación entre sectores.',
  columns_needed: ['fecha', 'sector', 'ventas'],
  operations: [
    { operation: 'time_series', columns: ['ventas'], group_by: ['fecha'], description: 'Ventas totales por mes' },
    { operation: 'group_by', columns: ['ventas'], group_by: ['sector'], description: 'Ventas totales por sector' },
    { operation: 'sum', columns: ['ventas'], group_by: [], description: 'Total general' },
    { operation: 'sum', columns: ['sector'], group_by: [], description: 'Suma inválida' },
  ],
  charts: [{ type: 'line', x: 'fecha', y: 'ventas', title: 'Ventas por mes' }],
  limitations: ['Datos sintéticos.'],
}

function gateway() {
  return {
    status: vi.fn(async () => ({
      ai_enabled: true, provider_configured: true, external_calls_implemented: true, model: 'gpt-6-luna',
      budget_usd: 0.05, spent_usd: 0, remaining_usd: 0.05, requests_used: 0, max_requests: 25, max_output_tokens: 2500,
    })),
    prepare: vi.fn(async (payload) => ({
      request_id: 'req1', payload, payload_sha256: '1'.repeat(64), expires_in_seconds: 300,
      ai_enabled: true, external_calls_implemented: true, estimated_input_tokens: 1500, estimated_max_cost_usd: 0.0014,
    })),
    authorize: vi.fn(async (): Promise<unknown> => ({
      reply: {
        message: 'Propongo un plan.', interpreted_objective: 'Ventas por mes y sector', source_relationship: 'single',
        questions: [], plans: [PLAN], warnings: [],
      },
      plan_ids: ['plan-1a'],
      usage: { model: 'gpt-6-luna', input_tokens: 1265, output_tokens: 493, cost_usd: 0.0004, remaining_usd: 0.0496 },
    })),
    cancel: vi.fn(async () => undefined),
    approvePlan: vi.fn(async (planId: string) => ({ plan_id: planId, status: 'approved', executed: false })),
  } satisfies AIGatewayClient
}

function engine(response: ExecutionResponse = analysisFixture as ExecutionResponse) {
  return { execute: vi.fn(async () => response) } satisfies AnalysisEngineClient
}

async function reachConfirm(analysisEngine: AnalysisEngineClient | null, ai = gateway()) {
  const user = userEvent.setup()
  const router = createMemoryRouter(routes, { initialEntries: ['/analisis/cargar'] })
  render(
    <AppProviders service={createDemoService({ delayMs: 0 })} aiGateway={ai} analysisEngine={analysisEngine}>
      <RouterProvider router={router} />
    </AppProviders>,
  )
  await user.upload(await screen.findByTestId('file-input'), [new File([CSV], 'ventas.csv', { type: 'text/csv' })])
  const list = await screen.findByRole('list', { name: 'Fuentes del análisis' })
  await waitFor(() => expect(within(list).getAllByLabelText('Archivo listo')).toHaveLength(1))
  await goToReview(user)
  // La vista previa local no detecta interpretaciones: se indican en la revisión (como haría el usuario).
  await user.selectOptions(screen.getByLabelText('Significado de fecha (fuente A)'), 'temporal')
  await user.selectOptions(screen.getByLabelText('Significado de sector (fuente A)'), 'categorical')
  await user.selectOptions(screen.getByLabelText('Significado de ventas (fuente A)'), 'quantitative')
  await completeReview(user, 'Ventas por mes y por sector')
  await screen.findByText(/IA real · gpt-6-luna/)
  await startConversation(user)
  const panel = await screen.findByRole('region', { name: 'Autorizar envío a OpenAI' })
  await user.click(await within(panel).findByRole('button', { name: 'Autorizar solo este mensaje' }))
  const plan = await screen.findByRole('region', { name: 'Plan propuesto: Ventas por mes y sector' })
  await user.click(within(plan).getByRole('button', { name: 'Aprobar este plan' }))
  await user.click(await screen.findByRole('button', { name: /Continuar a Confirmar/ }))
  await screen.findByRole('region', { name: 'Plan aprobado: Ventas por mes y sector' })
  return { user, router, ai }
}

async function confirm(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('checkbox', { name: /Revisé los planes aprobados/ }))
  await user.click(screen.getByRole('button', { name: 'Confirmar propuesta' }))
}

describe('«Ejecutar análisis» (motor Pandas)', () => {
  it('no aparece ni se ejecuta antes de la confirmación final', async () => {
    const motor = engine()
    await reachConfirm(motor)
    expect(screen.queryByRole('button', { name: 'Ejecutar análisis' })).not.toBeInTheDocument()
    expect(motor.execute).not.toHaveBeenCalled()
  })

  it('envía el archivo original y los planes aprobados, y muestra los valores de Pandas', async () => {
    const motor = engine()
    const { user, ai } = await reachConfirm(motor)
    const iaCalls = ai.authorize.mock.calls.length
    await confirm(user)

    await user.type(screen.getByLabelText('Unidad de ventas (fuente A)'), 'ARS')
    await user.click(screen.getByRole('button', { name: 'Ejecutar análisis' }))
    await waitFor(() => expect(motor.execute).toHaveBeenCalledTimes(1))

    const [request, files] = motor.execute.mock.calls[0] as unknown as Parameters<AnalysisEngineClient['execute']>
    expect(request.plan_ids).toEqual(['plan-1a'])
    expect(request.sources).toEqual([
      {
        alias: 'A',
        columns: [
          { name: 'fecha', original: 'fecha', semantic_type: 'temporal', missing_markers: null, unit: null },
          { name: 'sector', original: 'sector', semantic_type: 'categorical', missing_markers: null, unit: null },
          { name: 'ventas', original: 'ventas', semantic_type: 'quantitative', missing_markers: null, unit: 'ARS' },
        ],
      },
    ])
    expect(files.A).toBeInstanceOf(File)
    expect(files.A?.name).toBe('ventas.csv')
    expect(ai.authorize.mock.calls.length).toBe(iaCalls) // ejecutar no consulta a la IA

    const results = await screen.findByRole('region', { name: 'Resultados: Ventas por mes y sector' })
    const monthly = within(results).getByRole('group', { name: /^Resultado: Serie temporal · Ventas totales por mes/ })
    expect(monthly).toHaveTextContent('2026-01')
    expect(monthly).toHaveTextContent('23.000 ARS')
    expect(monthly).toHaveTextContent('27.500 ARS')
    expect(monthly).toHaveTextContent('32.000 ARS')
    expect(monthly).toHaveTextContent('fecha (mes)')
    const bySector = within(results).getByRole('group', { name: /^Resultado: Agrupación · Ventas totales por sector/ })
    expect(bySector).toHaveTextContent('Tecnologia')
    expect(bySector).toHaveTextContent('54.000 ARS')
    expect(bySector).toHaveTextContent('28.500 ARS')
    expect(within(results).getByRole('group', { name: /^Resultado: Suma · Total general/ })).toHaveTextContent('82.500 ARS')
    // Operación incompatible: se informa, no se reemplaza.
    const failed = within(results).getByRole('group', { name: /^Resultado: Suma · Suma inválida/ })
    expect(failed).toHaveTextContent('No se pudo calcular: «sector» es una columna categórica')
    expect(within(results).getByText('Parcial')).toBeInTheDocument()
    expect(screen.getByText('La IA no participó del cálculo ni recibió los datos.')).toBeInTheDocument()
  })

  it('los resultados se conservan al ir al asistente y volver, sin recalcular', async () => {
    const motor = engine()
    const { user, router } = await reachConfirm(motor)
    await confirm(user)
    await user.click(screen.getByRole('button', { name: 'Ejecutar análisis' }))
    await screen.findByRole('region', { name: 'Resultados: Ventas por mes y sector' })
    await act(() => router.navigate('/analisis/asistente'))
    await act(() => router.navigate('/analisis/confirmar'))
    expect(await screen.findByRole('region', { name: 'Resultados: Ventas por mes y sector' })).toBeInTheDocument()
    expect(motor.execute).toHaveBeenCalledTimes(1)
  })

  it('muestra los errores del backend de forma comprensible', async () => {
    const motor = engine()
    motor.execute.mockRejectedValueOnce(
      new ApiError('Un plan ya no está disponible (por ejemplo, se reinició el backend). Pedí la propuesta de nuevo y aprobala.', { status: 404 }),
    )
    const { user } = await reachConfirm(motor)
    await confirm(user)
    await user.click(screen.getByRole('button', { name: 'Ejecutar análisis' }))
    expect(await screen.findByText(/se reinició el backend/)).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: /Resultados:/ })).not.toBeInTheDocument()
  })

  it('sin backend (demo pública) no hay motor de análisis', async () => {
    const { user } = await reachConfirm(null)
    await confirm(user)
    expect(screen.getByText('El cálculo requiere el backend local')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Ejecutar análisis' })).not.toBeInTheDocument()
  })
})

describe('pedido de ejecución (correspondencia de columnas)', () => {
  const profile = {
    datasetId: 'ds1', origin: 'backend', isComplete: true, rowCount: 6, rowCountIsEstimate: false, columnCount: 3,
    duplicateRowCount: 0, previewRows: [], issues: [],
    columns: [
      { name: 'sector', inferredType: 'text', semanticType: 'categorical', nullCount: 0, nonNullCount: 6, uniqueCount: 2 },
      { name: 'ventas', inferredType: 'numeric', semanticType: 'quantitative', nullCount: 0, nonNullCount: 6, uniqueCount: 6, suspectedMissing: 1 },
      { name: 'cuit', inferredType: 'text', semanticType: 'identifier', nullCount: 0, nonNullCount: 6, uniqueCount: 6 },
    ],
  }
  const dataset = { id: 'ds1', name: 'ventas', fileName: 'ventas.csv', format: 'csv', sizeBytes: 10, uploadedAt: '', source: 'upload', status: 'ready' }
  const review: AnalysisReviewState = {
    objective: 'x',
    sources: [{
      alias: 'A',
      includeSize: false,
      columns: {
        sector: { include: true, name: 'rubro' },
        ventas: { include: true, name: 'ventas', semanticType: 'quantitative', markers: 'treat_as_missing' },
        cuit: { include: false, name: 'cuit' },
      },
    }],
  } as unknown as AnalysisReviewState
  const plans = [{ planId: 'p1', plan: { ...PLAN, columns_needed: ['rubro', 'ventas'] } }] as unknown as SessionAIPlan[]

  it('usa el nombre compartido con la IA, la columna real, las decisiones de la revisión y excluye lo no compartido', () => {
    const file = new File(['x'], 'ventas.csv')
    const sources = [{ dataset, profile, file }] as unknown as AnalysisSource[]
    const prepared = buildExecution(sources, review, plans, { 'A:ventas': 'ARS' })
    expect(prepared.problem).toBeNull()
    expect(prepared.files.A).toBe(file)
    expect(prepared.request.sources[0].columns).toEqual([
      { name: 'rubro', original: 'sector', semantic_type: 'categorical', missing_markers: null, unit: null },
      { name: 'ventas', original: 'ventas', semantic_type: 'quantitative', missing_markers: 'treat_as_missing', unit: 'ARS' },
    ])
  })

  it('sin el archivo original en memoria, pide volver a cargarlo', () => {
    const sources = [{ dataset, profile }] as unknown as AnalysisSource[]
    const prepared = buildExecution(sources, review, plans)
    expect(prepared.problem).toMatch(/Falta el archivo original de la fuente A \(ventas\.csv\)/)
  })
})
