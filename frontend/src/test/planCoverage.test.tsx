/**
 * Mejora de experiencia: cobertura del pedido (Confirmar y Resultados) y resumen en lenguaje natural
 * del envío para interpretar resultados. Todo se calcula en el navegador: ninguna prueba usa red ni IA.
 */
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { ReportSection } from '@/components/report/ReportSection'
import { AppProviders } from '@/context/AppProviders'
import { summarizeInterpretationPayload } from '@/lib/interpretationSummary'
import { measureLabel, planDashboard } from '@/lib/dashboard'
import { adjustmentMessage, planCoverage, type CoverageColumn } from '@/lib/planCoverage'
import { routes } from '@/routes'
import type { AIAuthorizeResult, AIGatewayClient } from '@/services/aiGateway'
import type { ExecutionResponse } from '@/services/analysisEngine'
import { createDemoService } from '@/services/demoProvider'
import salesFixture from './fixtures/salesReportResponse.json'
import { completeReview, goToReview, startConversation } from './reviewHelpers'

const op = (operation: string, columns: string[], group_by: string[] = []) => ({ operation, columns, group_by })
const COLUMNS = ['fecha', 'sector', 'ventas', 'canal']

describe('cobertura del pedido (local, conservadora)', () => {
  it('detecta columnas nombradas y análisis pedidos que ningún plan calcula', () => {
    const { missing } = planCoverage(
      ['Quiero ver la evolución de las ventas por sector, cómo se distribuyen y su relación con el canal'],
      COLUMNS,
      [op('group_by', ['ventas'], ['sector'])],
    )
    expect(missing.map((m) => m.label)).toEqual([
      'La columna «canal»',
      'Evolución en el tiempo',
      'Distribución de los valores',
      'Relación entre dos variables',
    ])
  })

  it('no advierte cuando el plan cubre el pedido ni ante pedidos generales', () => {
    const covered = planCoverage(
      ['Quiero ver la evolución de las ventas por sector, cómo se distribuyen y su relación con el canal'],
      COLUMNS,
      [op('time_series', ['fecha', 'ventas'], ['sector']), op('histogram', ['ventas']), op('scatter', ['ventas', 'canal'])],
    )
    expect(covered.missing).toEqual([])
    expect(planCoverage(['Quiero un resumen general de mis datos'], COLUMNS, [op('count', [])])).toEqual({ missing: [], notObtainable: [] })
  })

  it('reconoce tildes, plurales y agrupaciones por fecha', () => {
    const { missing } = planCoverage(['Evolución mensual de los rubros'], ['fecha', 'rubro', 'monto_ars'], [op('group_by', ['monto_ars'], ['fecha'])])
    expect(missing.map((m) => m.label)).toEqual(['La columna «rubro»'])  // la evolución sí está (agrupa por fecha)
  })

  it('informa lo que no se puede concluir: causas, pronósticos y cruces de archivos', () => {
    const { notObtainable } = planCoverage(['¿Por qué bajaron las ventas? Quiero proyectar el próximo año y cruzar los archivos'], COLUMNS, [])
    expect(notObtainable.map((m) => m.label)).toEqual(['Causas o motivos', 'Pronósticos o proyecciones', 'Unir o cruzar archivos'])
  })

  it('sugiere un mensaje para el asistente, en palabras simples', () => {
    expect(adjustmentMessage([{ label: 'La columna «canal»', detail: '' }, { label: 'Evolución en el tiempo', detail: '' }])).toBe(
      'Quisiera ajustar el plan: también necesito la columna «canal», evolución en el tiempo.',
    )
  })
})

// Contenido como el que prepara el backend: una agrupación, una dispersión, una agrupación retenida y una fallida.
const CATEGORIES = Array.from({ length: 15 }, (_, i) => `Región ${i + 1}`)
const PAYLOAD = {
  version: 1,
  objective: 'Comparar las ventas por región',
  sources: [{ alias: 'A', rows: 72, columns: 4 }],
  operations: [
    { ref: 'P1.O1', description: 'Ventas por región', operation: 'group_by', status: 'ok', dimensions: ['region'],
      rows: CATEGORIES.map((c, i) => ({ keys: [c], values: [i] })), rows_total: 15 },
    { ref: 'P1.O2', description: 'Relación precio y monto', operation: 'scatter', status: 'ok', dimensions: [], rows: [], stats: { pearson: 0.4, n: 72 } },
    { ref: 'P1.O3', description: 'Compras por cliente', operation: 'group_by', status: 'ok', dimensions: ['cliente'], rows: [], rows_withheld: true },
    { ref: 'P1.O4', description: 'Suma inválida', operation: 'sum', status: 'error', error: '«rubro» es categórica' },
  ],
  descriptive_summary: [{ ref: 'P1.O1', facts: ['Ventas en 15 grupos.'] }],
}

describe('resumen del envío para interpretar', () => {
  it('describe en palabras simples lo que viaja, sin omitir categorías', () => {
    const summary = summarizeInterpretationPayload(PAYLOAD)
    expect(summary.calculated.map((c) => c.ref)).toEqual(['P1.O1', 'P1.O2', 'P1.O3'])
    expect(summary.failed).toEqual([{ ref: 'P1.O4', title: 'Suma inválida', reason: '«rubro» es categórica' }])
    expect(summary.sent[0].content).toBe('15 filas de resultados agregados, con sus cifras')
    expect(summary.sent[0].values).toEqual([{ dimension: 'region', values: CATEGORIES }])  // las 15, completas
    expect(summary.sent[1].content).toBe('solo estadísticos (correlación de Pearson, cantidad de pares), sin puntos individuales')
    expect(summary.sent[2].content).toMatch(/^sin filas de resultados: cada grupo correspondería a un registro individual/)
    expect(summary.sent[3].content).toMatch(/^el motivo por el que no se pudo calcular/)
    expect(summary.includesDataValues).toBe(true)
  })
})

const run = salesFixture as unknown as ExecutionResponse

function gateway(payload: Record<string, unknown> = PAYLOAD) {
  return {
    status: vi.fn(async () => ({ ai_enabled: true, provider_configured: true, external_calls_implemented: true, model: 'gpt-6-luna' })),
    prepare: vi.fn(),
    authorize: vi.fn(),
    cancel: vi.fn(async () => undefined),
    prepareInterpretation: vi.fn(async () => ({
      request_id: 'int-1', payload, payload_sha256: 'a'.repeat(64), expires_in_seconds: 300,
      ai_enabled: true, external_calls_implemented: true, estimated_input_tokens: 2300, estimated_max_cost_usd: 0.0021,
    })),
    authorizeInterpretation: vi.fn(),
    cancelInterpretation: vi.fn(async () => undefined),
  } satisfies AIGatewayClient
}

function renderReport(ai = gateway()) {
  const router = createMemoryRouter([{ path: '/', element: <ReportSection run={run} fileNames={{}} /> }])
  render(
    <AppProviders service={createDemoService({ delayMs: 0 })} aiGateway={ai} analysisEngine={null}>
      <RouterProvider router={router} />
    </AppProviders>,
  )
  return userEvent.setup()
}

describe('pantallas para personas sin conocimientos técnicos', () => {
  it('la autorización muestra primero un resumen en lenguaje natural y deja el JSON en «Ver detalles técnicos»', async () => {
    const ai = gateway()
    const user = renderReport(ai)
    await user.click(await screen.findByRole('button', { name: 'Interpretar resultados con IA' }))
    const panel = await screen.findByRole('region', { name: 'Autorizar interpretación con IA' })
    expect(within(panel).getByText('Qué se calculó')).toBeInTheDocument()
    expect(within(panel).getByText(/3 de 4 operaciones tienen resultados/)).toBeInTheDocument()
    expect(within(panel).getByText(/Sin resultados: Suma inválida/)).toBeInTheDocument()
    // Principales cifras: del resumen descriptivo ya calculado (local), no de la IA.
    expect(within(panel).getByText('Suma de monto_ars: 69.060 ARS.')).toBeInTheDocument()
    expect(within(panel).getByText(/Tu objetivo, tal como lo escribiste: «Comparar las ventas por región»/)).toBeInTheDocument()
    expect(within(panel).getByText(`Valores de «region» que se envían (15): ${CATEGORIES.join(', ')}`)).toBeInTheDocument()
    expect(within(panel).getByText(/no se anonimizan/)).toBeInTheDocument()
    expect(within(panel).getByText(/USD 0\.0021/)).toBeInTheDocument()
    // El contenido exacto sigue disponible, plegado.
    const details = within(panel).getByText(/Ver detalles técnicos/).closest('details')!
    expect(details.open).toBe(false)
    expect(within(panel).getByLabelText('Contenido exacto de la interpretación').textContent).toBe(JSON.stringify(PAYLOAD, null, 2))
    expect(ai.authorizeInterpretation).not.toHaveBeenCalled()
  })

  it('Resultados separa lo calculado, lo pendiente y lo que no se puede concluir', async () => {
    renderReport()
    const status = await screen.findByRole('region', { name: 'Estado del análisis' })
    expect(within(within(status).getByRole('group', { name: 'Resultados calculados' })).getByText('Total vendido')).toBeInTheDocument()
    expect(within(within(status).getByRole('group', { name: 'Cuestiones pendientes' })).getByText(/Suma inválida: no se pudo calcular/)).toBeInTheDocument()
    expect(within(within(status).getByRole('group', { name: 'Conclusiones que todavía no pueden obtenerse' })).getByText(/Causas/)).toBeInTheDocument()
    await screen.findByRole('button', { name: 'Interpretar resultados con IA' })
  })

  it('ninguna de estas pantallas envía nada a la IA por sí sola', async () => {
    const ai = gateway()
    renderReport(ai)
    await screen.findByRole('region', { name: 'Estado del análisis' })
    await screen.findByRole('button', { name: 'Interpretar resultados con IA' })
    expect(ai.prepareInterpretation).not.toHaveBeenCalled()
    expect(ai.authorizeInterpretation).not.toHaveBeenCalled()
    expect(ai.authorize).not.toHaveBeenCalled()
  })
})

// --- Flujo completo hasta «Confirmar» (IA falsa) ------------------------------------------

const CSV = 'fecha,sector,ventas\n2026-01-01,Tecnologia,15000\n2026-01-01,Indumentaria,8000\n2026-02-01,Tecnologia,18000\n2026-02-01,Indumentaria,9500\n'
const PLAN: AIAuthorizeResult['reply']['plans'][number] = {
  source_alias: 'A', title: 'Ventas por sector', rationale: 'Compara sectores.', columns_needed: ['sector', 'ventas'],
  operations: [{ operation: 'group_by', columns: ['ventas'], group_by: ['sector'], description: 'Ventas por sector' }],
  charts: [], limitations: [],
}

function conversationGateway() {
  return {
    status: vi.fn(async () => ({
      ai_enabled: true, provider_configured: true, external_calls_implemented: true, model: 'gpt-6-luna',
      budget_usd: 0.1, spent_usd: 0, remaining_usd: 0.1, requests_used: 0, max_requests: 15, max_output_tokens: 2500,
    })),
    prepare: vi.fn(async (payload) => ({
      request_id: 'req1', payload, payload_sha256: '1'.repeat(64), expires_in_seconds: 300,
      ai_enabled: true, external_calls_implemented: true, estimated_input_tokens: 1500, estimated_max_cost_usd: 0.0014,
    })),
    authorize: vi.fn(async (): Promise<unknown> => ({
      reply: { message: 'Propongo un plan.', interpreted_objective: 'Ventas', source_relationship: 'single', questions: [], plans: [PLAN], warnings: [] },
      plan_ids: ['plan-1'],
      usage: { model: 'gpt-6-luna', input_tokens: 1000, output_tokens: 300, cost_usd: 0.0003, remaining_usd: 0.0997 },
    })),
    cancel: vi.fn(async () => undefined),
    approvePlan: vi.fn(async (planId: string) => ({ plan_id: planId, status: 'approved', executed: false })),
  } satisfies AIGatewayClient
}

async function reachConfirm(objective: string) {
  const ai = conversationGateway()
  const user = userEvent.setup()
  const router = createMemoryRouter(routes, { initialEntries: ['/analisis/cargar'] })
  render(
    <AppProviders service={createDemoService({ delayMs: 0 })} aiGateway={ai} analysisEngine={null}>
      <RouterProvider router={router} />
    </AppProviders>,
  )
  await user.upload(await screen.findByTestId('file-input'), [new File([CSV], 'ventas.csv', { type: 'text/csv' })])
  const list = await screen.findByRole('list', { name: 'Fuentes del análisis' })
  await waitFor(() => expect(within(list).getAllByLabelText('Archivo listo')).toHaveLength(1))
  await goToReview(user)
  await user.selectOptions(screen.getByLabelText('Significado de fecha (fuente A)'), 'temporal')
  await user.selectOptions(screen.getByLabelText('Significado de sector (fuente A)'), 'categorical')
  await user.selectOptions(screen.getByLabelText('Significado de ventas (fuente A)'), 'quantitative')
  await completeReview(user, objective)
  await screen.findByText(/IA real · gpt-6-luna/)
  await startConversation(user)
  const panel = await screen.findByRole('region', { name: 'Autorizar envío a OpenAI' })
  await user.click(await within(panel).findByRole('button', { name: 'Autorizar solo este mensaje' }))
  const plan = await screen.findByRole('region', { name: 'Plan propuesto: Ventas por sector' })
  await user.click(within(plan).getByRole('button', { name: 'Aprobar este plan' }))
  await user.click(await screen.findByRole('button', { name: /Continuar a Confirmar/ }))
  await screen.findByRole('region', { name: 'Plan aprobado: Ventas por sector' })
  return { user, ai, router }
}

describe('«Confirmar» advierte si el plan no cubre el pedido', () => {
  it('muestra qué falta y vuelve al asistente con un mensaje sugerido, sin enviarlo', async () => {
    const { user, ai, router } = await reachConfirm('Quiero ver la evolución mensual de las ventas por sector y cómo se distribuyen')
    const warning = screen.getByRole('region', { name: 'Partes del pedido sin cubrir' })
    expect(within(warning).getByText('Puede que el plan no cubra todo lo que pediste')).toBeInTheDocument()
    expect(within(warning).getByText('Evolución en el tiempo:')).toBeInTheDocument()
    expect(within(warning).getByText('Distribución de los valores:')).toBeInTheDocument()
    // No bloquea: se puede confirmar igual.
    expect(screen.getByRole('checkbox', { name: /Revisé los planes aprobados/ })).toBeEnabled()

    const sent = ai.authorize.mock.calls.length
    await user.click(within(warning).getByRole('button', { name: 'Volver al asistente para ajustar el plan' }))
    expect(router.state.location.pathname).toBe('/analisis/asistente')
    const composer = await screen.findByLabelText('Mensaje para el asistente')
    await waitFor(() =>
      expect(composer).toHaveValue('Quisiera ajustar el plan: también necesito evolución en el tiempo, distribución de los valores.'),
    )
    expect(ai.authorize.mock.calls.length).toBe(sent)  // el mensaje sugerido no se envía solo
  })

  it('no advierte cuando el plan responde lo pedido', async () => {
    await reachConfirm('Comparar las ventas por sector')
    expect(screen.queryByRole('region', { name: 'Partes del pedido sin cubrir' })).not.toBeInTheDocument()
  })

  it('aclara lo que no se puede concluir, sin bloquear', async () => {
    await reachConfirm('¿Por qué las ventas por sector son distintas?')
    const notice = screen.getByRole('region', { name: 'Conclusiones que no se pueden obtener' })
    expect(within(notice).getByText('Causas o motivos:')).toBeInTheDocument()
  })
})

// --- Escenario: movimientos financieros (datos ficticios) ------------------------------------

describe('escenario financiero: gasto, categorías y una persona por separado', () => {
  const GOAL = 'Quiero saber cuántas transacciones hice, cuánto gasté, en qué categorías gasté y cuánto corresponde a una persona específica por separado.'
  const FINANCE: CoverageColumn[] = [
    { name: 'fecha', semanticType: 'temporal' },
    { name: 'categoria', semanticType: 'categorical' },
    { name: 'modalidad', semanticType: 'categorical' },
    { name: 'contraparte', semanticType: 'categorical' },
    { name: 'importe', semanticType: 'quantitative', valueSign: 'mixed' },
  ]
  const labels = (gaps: { label: string }[]) => gaps.map((g) => g.label)

  it('1 y 3: una suma neta no responde «cuánto gasté» ni separa a una persona', () => {
    const { missing, notObtainable } = planCoverage([GOAL], FINANCE, [op('sum', ['importe'])])
    expect(labels(missing)).toEqual(['La columna «categoria»', 'Cantidad de registros', 'Separar por persona o entidad'])
    expect(missing[2].detail).toContain('«contraparte»')
    expect(labels(notObtainable)).toContain('Gastos e ingresos por separado («importe»)')
    expect(notObtainable.find((g) => g.label.startsWith('Gastos'))!.detail).toMatch(/total neto.*no se pueden distinguir ingresos de egresos/)
  })

  it('2: agrupar por modalidad de pago no cuenta como categorías', () => {
    const { missing } = planCoverage([GOAL], FINANCE, [op('count', []), op('group_by', ['importe'], ['modalidad'])])
    expect(labels(missing)).toEqual(['La columna «categoria»', 'Separar por persona o entidad'])
    expect(missing[1].detail).toContain('el plan agrupa por «modalidad»')
  })

  it('cubierto: conteo, categorías y contraparte; la suma neta se sigue aclarando', () => {
    const { missing, notObtainable } = planCoverage([GOAL], FINANCE, [
      op('count', []), op('group_by', ['importe'], ['categoria']), op('group_by', ['importe'], ['contraparte']),
    ])
    expect(missing).toEqual([])
    expect(labels(notObtainable)).toEqual(['Filtrar una persona o entidad en particular', 'Gastos e ingresos por separado («importe»)'])
  })

  it('4: sin columnas adecuadas indica que falta información, sin inventarla', () => {
    const { missing, notObtainable } = planCoverage([GOAL], [{ name: 'tipo_pago', semanticType: 'categorical' }, { name: 'importe', semanticType: 'quantitative', valueSign: 'mixed' }],
      [op('count', []), op('group_by', ['importe'], ['tipo_pago'])])
    expect(missing).toEqual([])  // «tipo de pago» no se toma como categoría ni como persona
    expect(labels(notObtainable)).toEqual([
      'Falta información: separar por persona o entidad',
      'Falta información: separar por categoría',
      'Filtrar una persona o entidad en particular',
      'Gastos e ingresos por separado («importe»)',
    ])
    expect(planCoverage(['Quiero ver la evolución mensual'], [{ name: 'importe', semanticType: 'quantitative' }], [op('sum', ['importe'])]).notObtainable[0].label)
      .toBe('Falta información: fecha o período')
  })

  it('3: una persona en particular no promete un filtro individual: sugiere agrupar y buscarla en el resultado', () => {
    const filter = planCoverage([GOAL], FINANCE, [op('group_by', ['importe'], ['contraparte'])]).notObtainable.find((g) => g.label === 'Filtrar una persona o entidad en particular')!
    expect(filter.detail).toContain('El motor todavía no filtra por un valor concreto')
    expect(filter.detail).toContain('agrupe por esa columna («contraparte»)')
    expect(filter.detail).not.toMatch(/podés filtrar|se filtra/)
    // Sin pedir un caso concreto, no aparece.
    expect(labels(planCoverage(['Cuánto gasté por cliente'], FINANCE, [op('group_by', ['importe'], ['contraparte'])]).notObtainable))
      .not.toContain('Filtrar una persona o entidad en particular')
  })

  it('una medida solo positiva no genera el aviso de suma neta', () => {
    const positive = FINANCE.map((c) => (c.name === 'importe' ? { ...c, valueSign: 'positive' as const } : c))
    expect(labels(planCoverage([GOAL], positive, [op('sum', ['importe'])]).notObtainable)).not.toContain('Gastos e ingresos por separado («importe»)')
  })

  it('5: el mensaje sugerido para el asistente es texto simple', () => {
    const { missing } = planCoverage([GOAL], FINANCE, [op('sum', ['importe'])])
    expect(adjustmentMessage(missing)).toBe(
      'Quisiera ajustar el plan: también necesito la columna «categoria», cantidad de registros, separar por persona o entidad.',
    )
  })

  it('los indicadores y tablas llaman «suma neta» a una suma de positivos y negativos', () => {
    const net = { operation: 'sum', description: 'Total', columns: ['importe'], group_by: [], status: 'ok' as const, dimensions: [],
      measures: [{ column: 'importe', aggregate: 'sum', unit: 'ARS' }], rows: [{ keys: [], values: [-1500] }], period: null,
      rows_used: 48, warnings: [], error: null, signed_measures: ['importe'] }
    const plan = planDashboard({ plan_id: 'p', source_alias: 'A', title: 'Plan', status: 'ok', operations: [net], charts: [], warnings: [] })
    expect(plan.kpis.map((k) => k.label)).toEqual(['Suma neta de importe'])
    expect(measureLabel(net.measures[0], net)).toBe('Suma neta de importe')
    expect(measureLabel(net.measures[0])).toBe('Suma de importe')
  })

  it('6: el panel de autorización destaca los posibles nombres de personas que viajarían', async () => {
    const payload = {
      version: 1, objective: GOAL, sources: [{ alias: 'A', rows: 48, columns: 5 }],
      operations: [{ ref: 'P1.O1', description: 'Por contraparte', operation: 'group_by', status: 'ok', dimensions: ['contraparte'],
        rows: ['Ana Ficticia', 'Beto Inventado', 'Comercio Ejemplo'].map((n, i) => ({ keys: [n], values: [i] })), rows_total: 3 }],
      descriptive_summary: [],
    }
    expect(summarizeInterpretationPayload(payload).personDimensions).toEqual([{ dimension: 'contraparte', values: ['Ana Ficticia', 'Beto Inventado', 'Comercio Ejemplo'] }])
    const user = renderReport(gateway(payload))
    await user.click(await screen.findByRole('button', { name: 'Interpretar resultados con IA' }))
    const note = await screen.findByRole('note', { name: 'Posibles nombres de personas' })
    expect(note).toHaveTextContent('«contraparte» parece identificar personas o entidades. Se enviarían estos 3 valores tal cual: Ana Ficticia, Beto Inventado, Comercio Ejemplo.')
    expect(note).toHaveTextContent('no autorices el envío sin su consentimiento')
  })
})
