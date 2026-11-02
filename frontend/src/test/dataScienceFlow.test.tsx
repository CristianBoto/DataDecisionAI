/**
 * Fase 5 — exploración, flujo simplificado, análisis sin IA y nuevas operaciones en el dashboard.
 * Datos sintéticos; frontera de IA falsa: no hay red, ni OpenAI, ni consumo.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { PdfCustomizer } from '@/components/report/PdfCustomizer'
import { NumericSummary, QualityDiagnosis } from '@/components/upload/QualityDiagnosis'
import { AppProviders } from '@/context/AppProviders'
import type { AIContextPayload } from '@/lib/aiContext'
import { approvedObjective } from '@/lib/analysisRequest'
import { planDashboard } from '@/lib/dashboard'
import { defaultCustomization, readLogo } from '@/lib/pdfCustomization'
import { routes } from '@/routes'
import type { AIAuthorizeResult, AIGatewayClient } from '@/services/aiGateway'
import type { OperationResult, PlanResult } from '@/services/analysisEngine'
import { createDemoService } from '@/services/demoProvider'
import type { ColumnProfile, QualityFinding } from '@/types/domain'
import { goToReview } from './reviewHelpers'

const csv = (name: string, text: string) => new File([text], name, { type: 'text/csv' })
const ventas = () => csv('ventas.csv', 'fecha,sector,ventas\n2026-01-05,Comercio,1200\n2026-02-05,Industria,3400\n')
const USAGE = { model: 'gpt-6-luna', input_tokens: 900, output_tokens: 300, cost_usd: 0.0003, remaining_usd: 0.04 }

describe('exploración: diagnóstico de calidad', () => {
  it('muestra cada problema con su severidad e impacto, y aclara que nada se corrige', () => {
    const findings: QualityFinding[] = [
      { severity: 'alta', column: 'fecha', kind: 'invalid_dates', message: '2 fechas o períodos no se pueden leer.', impact: 'En las evoluciones en el tiempo quedan en el grupo «(sin dato)».' },
      { severity: 'baja', column: null, kind: 'logical_duplicates', message: '1 filas iguales a otra salvo mayúsculas, tildes o espacios.', impact: 'No se eliminan automáticamente.' },
    ]
    render(<QualityDiagnosis findings={findings} />)
    const panel = screen.getByRole('region', { name: 'Diagnóstico de calidad' })
    expect(within(panel).getByText('Alta')).toBeInTheDocument()
    expect(within(panel).getByText('2 fechas o períodos no se pueden leer.')).toBeInTheDocument()
    expect(within(panel).getByText(/quedan en el grupo «\(sin dato\)»/)).toBeInTheDocument()
    expect(panel).toHaveTextContent('Nada se corrige automáticamente')
  })

  it('resume las estadísticas descriptivas de las columnas numéricas', () => {
    const columns = [
      { name: 'monto', stats: { count: 13, mean: 7798.62, std: 27696.1, min: 120, median: 128, max: 99999, conversionErrors: 1, outliers: 1 } },
      { name: 'zona', stats: null },
    ] as unknown as ColumnProfile[]
    render(<NumericSummary columns={columns} />)
    const table = screen.getByRole('region', { name: 'Estadísticas descriptivas' })
    const row = within(table).getByRole('row', { name: /monto/ })
    expect(row).toHaveTextContent('7.798,62')
    expect(row).toHaveTextContent('99.999')
    expect(within(table).queryByText('zona')).not.toBeInTheDocument()
  })
})

function gateway() {
  let last: AIContextPayload | null = null
  const proposal: AIAuthorizeResult = {
    reply: {
      message: 'Propuesta.', interpreted_objective: 'Comparar las ventas por sector para decidir dónde reforzar.', feasibility: 'partial',
      missing_data: ['costos por sector'], decisions: ['Dónde reforzar el seguimiento comercial'], source_relationship: 'single',
      questions: [], warnings: [],
      plans: [{ source_alias: 'A', title: 'Ventas por sector', rationale: 'r', columns_needed: ['sector', 'ventas'], operations: [{ operation: 'sum', columns: ['ventas'], group_by: ['sector'], description: 'Total' }], charts: [], limitations: [] }],
    },
    plan_ids: ['plan-1'],
    usage: USAGE,
  }
  const g = {
    status: vi.fn(async () => ({
      ai_enabled: true, provider_configured: true, external_calls_implemented: true, model: 'gpt-6-luna',
      budget_usd: 0.05, spent_usd: 0, remaining_usd: 0.05, requests_used: 0, max_requests: 25, max_output_tokens: 2500,
      conversation_ttl_minutes: 30, conversation_max_messages: 20,
    })),
    prepare: vi.fn(async (payload: AIContextPayload) => {
      last = payload
      return { request_id: 'r1', payload, payload_sha256: 'a'.repeat(64), expires_in_seconds: 300, ai_enabled: true, external_calls_implemented: true, estimated_input_tokens: 900, estimated_max_cost_usd: 0.001 }
    }),
    authorize: vi.fn(async (): Promise<unknown> => proposal),
    cancel: vi.fn(async () => undefined),
    approvePlan: vi.fn(async (planId: string) => ({ plan_id: planId, status: 'approved', executed: false })),
    descriptivePlan: vi.fn(async (): Promise<AIAuthorizeResult> => ({
      ...proposal,
      reply: { ...proposal.reply, message: 'Propuesta descriptiva automática, armada sin IA.', interpreted_objective: 'Describir los datos.' },
      plan_ids: ['desc-1'],
      usage: { model: 'reglas (sin IA)', input_tokens: 0, output_tokens: 0, cost_usd: 0, remaining_usd: 0.05 },
    })),
    lastPayload: () => last,
  }
  return g satisfies AIGatewayClient & { lastPayload: () => AIContextPayload | null }
}

async function reachAssistantWithoutObjective(ai: ReturnType<typeof gateway>) {
  const user = userEvent.setup()
  const router = createMemoryRouter(routes, { initialEntries: ['/analisis/cargar'] })
  render(
    <AppProviders service={createDemoService({ delayMs: 0 })} aiGateway={ai}>
      <RouterProvider router={router} />
    </AppProviders>,
  )
  await user.upload(await screen.findByTestId('file-input'), [ventas()])
  const list = await screen.findByRole('list', { name: 'Fuentes del análisis' })
  await waitFor(() => expect(within(list).getAllByLabelText('Archivo listo')).toHaveLength(1))
  await goToReview(user)
  // Sin escribir el objetivo: se define conversando.
  await user.click(screen.getByRole('button', { name: /Confirmar revisión y continuar/ }))
  await waitFor(() => expect(router.state.location.pathname).toBe('/analisis/asistente'))
  await screen.findByText(/IA real · gpt-6-luna/)
  return { user, router }
}

describe('flujo simplificado: el objetivo se cuenta una sola vez', () => {
  it('el asistente saluda con la estructura de los datos y el primer mensaje pasa a ser el objetivo', async () => {
    const ai = gateway()
    const { user } = await reachAssistantWithoutObjective(ai)
    const greeting = await screen.findByRole('region', { name: 'Saludo del asistente' })
    expect(greeting).toHaveTextContent(/Revisé tu archivo: contiene 2 filas con fechas o períodos \(fecha\)/)
    expect(greeting).toHaveTextContent('¿Qué decisión te gustaría tomar con esta información?')
    expect(greeting).toHaveTextContent('todavía no se envió nada a la IA')
    expect(screen.queryByRole('button', { name: 'Comenzar conversación' })).not.toBeInTheDocument()
    expect(ai.prepare).not.toHaveBeenCalled()

    const composer = screen.getByRole('textbox', { name: /Mensaje/i })
    await waitFor(() => expect(composer).toBeEnabled())
    await user.type(composer, 'Quiero saber qué sector conviene reforzar{Enter}')
    // El panel de autorización muestra qué se envía y qué no, antes de enviar nada.
    const panel = await screen.findByRole('region', { name: 'Autorizar envío a OpenAI' })
    const consent = within(panel).getByRole('group', { name: 'Resumen del envío' })
    expect(consent).toHaveTextContent('Nunca se envía')
    expect(consent).toHaveTextContent('Los archivos, sus filas y los valores de las celdas')
    expect(consent).toHaveTextContent(/Nombres de columnas: fecha, sector, ventas/)
    expect(consent).toHaveTextContent('Análisis descriptivo sin IA')
    await waitFor(() => expect(ai.lastPayload()?.objective).toBe('Quiero saber qué sector conviene reforzar'))
    expect(ai.authorize).not.toHaveBeenCalled()

    await user.click(await within(panel).findByRole('button', { name: 'Autorizar solo este mensaje' }))
    // La propuesta informa viabilidad, decisiones y datos faltantes.
    const feasibility = await screen.findByRole('region', { name: 'Viabilidad del análisis' })
    expect(feasibility).toHaveTextContent('Parcialmente viable')
    expect(feasibility).toHaveTextContent('Dónde reforzar el seguimiento comercial')
    expect(feasibility).toHaveTextContent('costos por sector')
  }, 15_000)

  it('el análisis descriptivo sin IA arma una propuesta confirmable sin enviar nada a OpenAI', async () => {
    const ai = gateway()
    const { user, router } = await reachAssistantWithoutObjective(ai)
    const card = await screen.findByRole('region', { name: 'Análisis descriptivo sin IA' })
    await user.click(within(card).getByRole('button', { name: 'Análisis descriptivo sin IA' }))
    expect(await screen.findByText('Propuesta descriptiva automática, armada sin IA.')).toBeInTheDocument()
    expect(screen.getByText(/Generado por reglas, sin IA · No se envió nada a OpenAI/)).toBeInTheDocument()
    const [shared] = ai.descriptivePlan.mock.calls[0] as unknown as [AIContextPayload['sources']]
    expect(shared[0].columns.map((c) => c.name)).toEqual(['fecha', 'sector', 'ventas'])
    expect(JSON.stringify(shared)).not.toMatch(/Comercio|1200|ventas\.csv/)
    expect(ai.prepare).not.toHaveBeenCalled()
    expect(ai.authorize).not.toHaveBeenCalled()

    const ready = await screen.findByRole('region', { name: 'Propuesta lista' })
    await user.click(within(ready).getByRole('button', { name: 'Confirmar análisis' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/analisis/confirmar'))
    expect(ai.approvePlan).toHaveBeenCalledWith('desc-1')
  }, 15_000)
})

function op(partial: Partial<OperationResult>): OperationResult {
  return { operation: 'group_by', description: '', columns: [], group_by: [], status: 'ok', dimensions: [], measures: [], rows: [], period: null, rows_used: 10, warnings: [], error: null, ...partial } as OperationResult
}

const plan = (operations: OperationResult[]): PlanResult => ({ plan_id: 'p', source_alias: 'A', title: 'Plan', status: 'ok', operations, charts: [], warnings: [] })

describe('dashboard: nuevas operaciones', () => {
  it('la variación grafica el cambio de cada período (no el valor) y el cociente solo el cociente', () => {
    const variation = op({
      operation: 'variation', dimensions: ['fecha'], temporal_dimension: 'fecha', period: 'month',
      measures: [{ column: 'monto', aggregate: 'sum', unit: 'ARS' }, { column: 'monto', aggregate: 'change', unit: 'ARS' }, { column: 'monto', aggregate: 'change_pct', unit: '%' }],
      rows: [{ keys: ['2025-01'], values: [100, null, null] }, { keys: ['2025-02'], values: [120, 20, 20] }],
    })
    const ratio = op({
      operation: 'ratio', dimensions: ['nivel'],
      measures: [{ column: 'gastos', aggregate: 'sum', unit: 'ARS' }, { column: 'matricula', aggregate: 'sum', unit: null }, { column: 'gastos por matricula', aggregate: 'ratio', unit: 'ARS' }],
      rows: [{ keys: ['Primario'], values: [1000, 10, 100] }, { keys: ['Superior'], values: [3000, 20, 150] }],
    })
    const dashboard = planDashboard(plan([variation, ratio]))
    const [changeChart, ratioChart] = dashboard.charts
    expect(changeChart.type).toBe('bar')
    expect(changeChart.series.map((s) => s.label)).toEqual(['Variación de monto'])
    expect(changeChart.data[1]).toMatchObject({ x: '2025-02', s1: 20 })
    expect(ratioChart.series.map((s) => s.label)).toEqual(['gastos por matricula'])
    expect(ratioChart.description).toMatch(/Fuente A · calculado con Pandas/)
  })

  it('la torta solo se usa con sumas y conteos', () => {
    const std = op({ operation: 'std', dimensions: ['canal'], measures: [{ column: 'monto', aggregate: 'std', unit: 'ARS' }], rows: [{ keys: ['Local'], values: [5] }, { keys: ['Online'], values: [7] }] })
    const dashboard = planDashboard({ ...plan([std]), charts: [{ type: 'pie', x: 'canal', y: 'monto', title: 'Torta' }] })
    expect(dashboard.notices.join(' ')).toMatch(/solo las sumas y los conteos forman partes de un total/)
  })
})

describe('resultados e informe', () => {
  it('la interpretación recibe el objetivo interpretado y aprobado, no todo el pedido original', () => {
    const long = 'Texto largo del pedido original. '.repeat(30)
    const plans = [{ reply: { interpreted_objective: 'Comparar ventas por sector.', decisions: ['Dónde reforzar'] } }] as never
    expect(approvedObjective(plans, long)).toBe('Comparar ventas por sector. Decisiones a evaluar: Dónde reforzar')
    expect(approvedObjective([], long)).toBe(long.trim())
  })

  it('el logo también se puede soltar sobre el área de identidad', async () => {
    const onChange = vi.fn()
    const fake = vi.fn(async () => ({ ok: true as const, logo: { dataUrl: 'data:image/png;base64,AA', format: 'PNG' as const, width: 40, height: 20, fileName: 'logo.png' } }))
    render(<PdfCustomizer value={defaultCustomization()} defaultTitle="Informe" onChange={onChange} readLogoFile={fake as unknown as typeof readLogo} />)
    const file = new File([new Uint8Array([0x89, 0x50])], 'logo.png', { type: 'image/png' })
    fireEvent.drop(screen.getByTestId('pdf-logo-dropzone'), { dataTransfer: { files: [file] } })
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ logo: expect.objectContaining({ fileName: 'logo.png' }) })))
    expect(fake).toHaveBeenCalledWith(file)
  })
})
