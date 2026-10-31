/**
 * Conversación que no llegaba a la propuesta: la IA preguntaba «¿entendí bien?», la persona
 * respondía «sí», la IA preguntaba «¿querés este análisis?», otra vez «sí»… y nunca había planes
 * ni forma de avanzar. Frontera de IA falsa: no hay red, ni OpenAI, ni consumo.
 */
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { AppProviders } from '@/context/AppProviders'
import type { AIContextPayload } from '@/lib/aiContext'
import { aiConversationStage, isAffirmative, isPureAcceptance, routeMessage, type AIConversationStage } from '@/lib/conversationFlow'
import { routes } from '@/routes'
import type { AIAuthorizeResult, AIGatewayClient, AIPlan } from '@/services/aiGateway'
import { createDemoService } from '@/services/demoProvider'
import { completeReview, goToReview, startConversation } from './reviewHelpers'

const csv = (name: string, text: string) => new File([text], name, { type: 'text/csv' })
const ventas = () => csv('ventas.csv', 'fecha,sector,ventas\n2026-01-05,Comercio,1200\n2026-02-05,Industria,3400\n')
const OBJECTIVE = 'Comparar las ventas por sector'
const USAGE = { model: 'gpt-6-luna', input_tokens: 900, output_tokens: 300, cost_usd: 0.0003, remaining_usd: 0.04 }

const PLAN: AIPlan = {
  source_alias: 'A', title: 'Ventas totales por sector', rationale: 'Compara los sectores.',
  columns_needed: ['sector', 'ventas'],
  operations: [{ operation: 'sum', columns: ['ventas'], group_by: ['sector'], description: 'Total por sector' }],
  charts: [{ type: 'bar', x: 'sector', y: 'ventas', title: 'Ventas por sector' }],
  limitations: ['No hay costos: no se puede calcular la rentabilidad.'],
}

function questionsOnly(n: number, question: string): AIAuthorizeResult {
  return {
    reply: {
      message: `Pregunta ${n} de la IA.`, interpreted_objective: 'Ventas por sector', source_relationship: 'single',
      questions: [{ question, reason: 'Para confirmar el enfoque.', source_alias: null, column: null }],
      plans: [], warnings: [],
    },
    plan_ids: [],
    usage: USAGE,
  }
}

function proposal(): AIAuthorizeResult {
  return {
    reply: {
      message: 'Propuesta lista.', interpreted_objective: 'Ventas por sector', source_relationship: 'single',
      questions: [], plans: [PLAN, { ...PLAN, title: 'Evolución mensual', operations: [{ operation: 'time_series', columns: ['ventas'], group_by: ['fecha'], description: 'Por mes' }] }],
      warnings: [],
    },
    plan_ids: ['plan-a', 'plan-b'],
    usage: USAGE,
  }
}

/**
 * IA «insistente», como la del error: mientras no se le pida explícitamente la propuesta,
 * responde con otra pregunta de confirmación. Con `request_proposal`, propone (o, si
 * `viable` es false, explica que no hay análisis posible y pide información).
 */
function stubbornGateway({ viable = true }: { viable?: boolean } = {}) {
  let n = 0
  const answer = (payload: AIContextPayload): AIAuthorizeResult => {
    n += 1
    if (payload.request_proposal) {
      return viable
        ? proposal()
        : { ...questionsOnly(n, '¿Tenés una columna con los costos?'), reply: { ...questionsOnly(n, '¿Tenés una columna con los costos?').reply, message: 'Con estas columnas no hay ningún análisis viable para la rentabilidad.' } }
    }
    return questionsOnly(n, n === 1 ? '¿Entendí bien tu objetivo?' : '¿Querés que analice las ventas por sector?')
  }
  let lastPayload: AIContextPayload | null = null
  const gateway = {
    status: vi.fn(async () => ({
      ai_enabled: true, provider_configured: true, external_calls_implemented: true, model: 'gpt-6-luna',
      budget_usd: 0.05, spent_usd: 0, remaining_usd: 0.05, requests_used: 0, max_requests: 25, max_output_tokens: 2500,
      conversation_ttl_minutes: 30, conversation_max_messages: 20,
    })),
    prepare: vi.fn(async (payload: AIContextPayload) => {
      lastPayload = payload
      return {
        request_id: 'req1', payload, payload_sha256: 'a'.repeat(64), expires_in_seconds: 300,
        ai_enabled: true, external_calls_implemented: true, estimated_input_tokens: 1500, estimated_max_cost_usd: 0.0014,
      }
    }),
    authorize: vi.fn(async (): Promise<unknown> => ({
      ...answer(lastPayload!),
      conversation: { conversation_id: 'conv-1', expires_in_seconds: 1800, max_messages: 20 },
    })),
    cancel: vi.fn(async () => undefined),
    approvePlan: vi.fn(async (planId: string) => ({ plan_id: planId, status: 'approved', executed: false })),
    sendInConversation: vi.fn(async (_id: string, payload: AIContextPayload): Promise<AIAuthorizeResult> => answer(payload)),
    revokeConversation: vi.fn(async () => undefined),
  }
  return gateway satisfies AIGatewayClient
}

async function reachAssistant(gateway: ReturnType<typeof stubbornGateway>) {
  const user = userEvent.setup()
  const router = createMemoryRouter(routes, { initialEntries: ['/analisis/cargar'] })
  render(
    <AppProviders service={createDemoService({ delayMs: 0 })} aiGateway={gateway}>
      <RouterProvider router={router} />
    </AppProviders>,
  )
  await user.upload(await screen.findByTestId('file-input'), [ventas()])
  const list = await screen.findByRole('list', { name: 'Fuentes del análisis' })
  await waitFor(() => expect(within(list).getAllByLabelText('Archivo listo')).toHaveLength(1))
  await goToReview(user)
  await completeReview(user, OBJECTIVE)
  await waitFor(() => expect(router.state.location.pathname).toBe('/analisis/asistente'))
  await screen.findByText(/IA real · gpt-6-luna/)
  const composer = await screen.findByRole('textbox', { name: /Mensaje/i })
  // Primer mensaje: se autoriza la conversación; los siguientes van directo.
  await startConversation(user)
  const box = await screen.findByRole('region', { name: 'Autorizar envío a OpenAI' })
  await user.click(await within(box).findByRole('button', { name: 'Autorizar esta conversación' }))
  await screen.findByText('Pregunta 1 de la IA.')
  return { user, router, composer }
}

async function say(user: ReturnType<typeof userEvent.setup>, composer: HTMLElement, text: string) {
  await waitFor(() => expect(composer).toBeEnabled())
  await user.type(composer, `${text}{Enter}`)
}

const lastPayload = (gateway: ReturnType<typeof stubbornGateway>) =>
  gateway.sendInConversation.mock.calls.at(-1)![1] as AIContextPayload

describe('reconocimiento de la aceptación', () => {
  it('distingue aceptaciones de pedidos de cambio', () => {
    for (const text of ['sí', 'Si', 'Sí, correcto', 'correcto', 'Confirmo', 'dale', 'De acuerdo.', 'ok', 'Perfecto, armalo', 'claro que sí', 'Exacto!']) {
      expect(isAffirmative(text)).toBe(true)
    }
    for (const text of ['no', '¿Seguimos?', '¿sí?', 'Sí, pero sin el canal', 'Sí, agregá la región', 'cambiá el gráfico', 'sin datos', 'Quiero ver las ventas', '']) {
      expect(isAffirmative(text)).toBe(false)
    }
    expect(isPureAcceptance('Sí, correcto')).toBe(true)
    expect(isPureAcceptance('Sí, en ARS')).toBe(false)
  })

  it('decide el paso según el estado, no solo según el texto', () => {
    const ready: AIConversationStage = { kind: 'proposal', planIds: ['p1'], openQuestions: false }
    const withQuestion: AIConversationStage = { kind: 'proposal', planIds: ['p1'], openQuestions: true }
    expect(routeMessage(ready, 'sí')).toEqual({ action: 'accept' })
    expect(routeMessage(withQuestion, 'sí')).toEqual({ action: 'accept' })
    // «Sí, en ARS» responde una pregunta abierta con un dato nuevo: va a la IA, pidiendo la propuesta.
    expect(routeMessage(withQuestion, 'Sí, en ARS')).toEqual({ action: 'send', requestProposal: true })
    expect(routeMessage({ kind: 'questions', rounds: 1 }, 'sí')).toEqual({ action: 'send', requestProposal: true })
    expect(routeMessage({ kind: 'questions', rounds: 1 }, 'Las ventas están en ARS')).toEqual({ action: 'send', requestProposal: false })
    expect(routeMessage(ready, 'Sí, pero agregá la región')).toEqual({ action: 'send', requestProposal: false })
    expect(aiConversationStage([], [])).toEqual({ kind: 'idle' })
  })
})

describe('de las preguntas a la propuesta y a «Confirmar»', () => {
  it('reproduce el error: «sí» a cada pregunta ya no deja la conversación atrapada', async () => {
    const gateway = stubbornGateway()
    const { user, router, composer } = await reachAssistant(gateway)

    // «¿Entendí bien tu objetivo?» → «sí»: se le pide explícitamente a la IA que proponga.
    await say(user, composer, 'sí')
    expect(await screen.findByRole('region', { name: 'Propuesta lista' })).toBeInTheDocument()
    expect(lastPayload(gateway)).toMatchObject({ message: 'sí', request_proposal: true })
    expect(screen.getByRole('region', { name: 'Plan propuesto: Ventas totales por sector' })).toHaveTextContent('No hay costos')

    // «sí» a la propuesta completa: no se vuelve a consultar a la IA; se ofrece la confirmación formal.
    const calls = gateway.sendInConversation.mock.calls.length
    await say(user, composer, 'sí')
    const ready = await screen.findByRole('region', { name: 'Propuesta lista' })
    expect(ready).toHaveTextContent('Entendido: aceptás la propuesta.')
    expect(gateway.sendInConversation).toHaveBeenCalledTimes(calls)
    expect(gateway.approvePlan).not.toHaveBeenCalled()

    // «Confirmar análisis» aprueba los planes en el backend, actualiza la sesión y avanza.
    await user.click(within(ready).getByRole('button', { name: 'Confirmar análisis' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/analisis/confirmar'))
    expect(gateway.approvePlan.mock.calls.map((c) => c[0])).toEqual(['plan-a', 'plan-b'])
    expect(await screen.findByRole('region', { name: 'Plan aprobado: Ventas totales por sector' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Plan aprobado: Evolución mensual' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Confirmar propuesta' })).toBeInTheDocument()
  }, 15_000)

  it('sin escribir «sí»: «Generar propuesta» pide la propuesta de forma explícita', async () => {
    const gateway = stubbornGateway()
    const { user, composer } = await reachAssistant(gateway)
    // Una respuesta con datos (no una aceptación) sigue la conversación normal.
    await say(user, composer, 'Las ventas están en pesos.')
    await screen.findByText('Pregunta 2 de la IA.')
    expect(lastPayload(gateway).request_proposal).toBeUndefined()
    // Tras dos rondas de preguntas, la opción se destaca.
    const generate = screen.getByRole('region', { name: 'Generar propuesta' })
    expect(generate).toHaveTextContent('El asistente ya hizo varias preguntas.')

    await user.click(within(generate).getByRole('button', { name: 'Generar propuesta' }))
    expect(await screen.findByRole('region', { name: 'Propuesta lista' })).toBeInTheDocument()
    expect(lastPayload(gateway)).toMatchObject({ request_proposal: true })
    expect(screen.queryByRole('region', { name: 'Generar propuesta' })).not.toBeInTheDocument()
  })

  it('«Modificar propuesta» prepara un pedido de cambio editable, sin enviarlo', async () => {
    const gateway = stubbornGateway()
    const { user, composer } = await reachAssistant(gateway)
    await say(user, composer, 'correcto')
    const ready = await screen.findByRole('region', { name: 'Propuesta lista' })
    const calls = gateway.sendInConversation.mock.calls.length
    await user.click(within(ready).getByRole('button', { name: 'Modificar propuesta' }))
    expect(composer).toHaveValue('Quisiera modificar: ')
    expect(composer).toHaveFocus()
    expect(gateway.sendInConversation).toHaveBeenCalledTimes(calls)
    expect(gateway.approvePlan).not.toHaveBeenCalled()
  })

  it('si ningún análisis es viable, explica el motivo, pide información y no ofrece confirmar', async () => {
    const gateway = stubbornGateway({ viable: false })
    const { user, composer, router } = await reachAssistant(gateway)
    await say(user, composer, 'confirmo')
    expect(await screen.findByText('Con estas columnas no hay ningún análisis viable para la rentabilidad.')).toBeInTheDocument()
    expect(screen.getByText('¿Tenés una columna con los costos?')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Propuesta lista' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Confirmar análisis' })).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Generar propuesta' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/analisis/asistente')
  })
})

describe('asistente DEMO', () => {
  it('«sí» a una propuesta lista no genera otra versión y vuelve a ofrecer la confirmación', async () => {
    const service = createDemoService({ delayMs: 0 })
    const dataset = await service.loadDemoDataset()
    const project = await service.createProject({ name: 'Proyecto demo', datasetId: dataset.id })
    await service.sendMessage(project.id, { content: 'Quiero ver cómo vienen las ventas' })
    const v1 = await service.sendMessage(project.id, { content: 'sí' })
    expect(v1.proposal?.version).toBe(1)
    const accepted = await service.sendMessage(project.id, { content: 'sí, correcto' })
    expect(accepted.proposal?.id).toBe(v1.proposal?.id)
    expect(accepted.proposal?.version).toBe(1)
    expect(accepted.messages[1].content).toMatch(/Confirmar análisis/)
    expect(accepted.messages[1].proposalId).toBe(v1.proposal?.id)
    // Un pedido de cambio sí genera una versión nueva.
    const v2 = await service.sendMessage(project.id, { content: 'Agregar comparación por región' })
    expect(v2.proposal?.version).toBe(2)
  })
})
