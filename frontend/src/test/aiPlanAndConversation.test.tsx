/**
 * Fase 3B.2 — plan aprobado en «Confirmar» y autorización por conversación.
 * Frontera de IA falsa: no hay red, no hay OpenAI y no se consumen créditos.
 */
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { AppProviders } from '@/context/AppProviders'
import { routes } from '@/routes'
import { ApiError } from '@/services'
import type { AIAuthorizeResult, AIAuthorizationScope, AIGatewayClient } from '@/services/aiGateway'
import { createDemoService } from '@/services/demoProvider'
import { completeReview, goToReview, startConversation } from './reviewHelpers'

const csv = (name: string, text: string) => new File([text], name, { type: 'text/csv' })
const ventas = () => csv('ventas.csv', 'fecha,sector,ventas\n2026-01-05,Comercio,1200\n2026-02-05,Industria,3400\n')
const OBJECTIVE = 'Comparar las ventas por sector'

function reply(n: number): AIAuthorizeResult {
  return {
    reply: {
      message: `Respuesta ${n} de la IA.`,
      interpreted_objective: `Ventas por sector (v${n})`,
      source_relationship: 'single',
      questions: n === 1 ? [{ question: '¿Las ventas están en ARS?', reason: 'Cambia la lectura.', source_alias: 'A', column: 'ventas' }] : [],
      plans: [
        {
          source_alias: 'A', title: `Ventas totales por sector (v${n})`, rationale: `Compara sectores (v${n}).`,
          columns_needed: ['sector', 'ventas'],
          operations: [{ operation: 'sum', columns: ['ventas'], group_by: ['sector'], description: 'Total por sector' }],
          charts: [{ type: 'bar', x: 'sector', y: 'ventas', title: 'Ventas por sector' }],
          limitations: [`Solo dos meses (v${n}).`],
        },
        {
          source_alias: 'A', title: `Evolución mensual (v${n})`, rationale: 'Muestra la tendencia.',
          columns_needed: ['fecha', 'ventas'],
          operations: [{ operation: 'time_series', columns: ['ventas'], group_by: ['fecha'], description: 'Ventas por mes' }],
          charts: [{ type: 'line', x: 'fecha', y: 'ventas', title: 'Ventas por mes' }],
          limitations: [],
        },
      ],
      warnings: [`Las ventas se interpretan en ARS (v${n}).`],
    },
    plan_ids: [`plan-${n}a`, `plan-${n}b`],
    usage: { model: 'gpt-6-luna', input_tokens: 1265, output_tokens: 493, cost_usd: 0.0004, remaining_usd: 0.0496 },
  }
}

function fakeRealGateway() {
  let prepared = 0
  let replies = 0
  const gateway = {
    status: vi.fn(async () => ({
      ai_enabled: true, provider_configured: true, external_calls_implemented: true, model: 'gpt-6-luna',
      budget_usd: 0.05, spent_usd: 0, remaining_usd: 0.05, requests_used: 0, max_requests: 25, max_output_tokens: 2500,
      conversation_ttl_minutes: 30, conversation_max_messages: 20,
    })),
    prepare: vi.fn(async (payload) => ({
      request_id: `req${(prepared += 1)}`, payload, payload_sha256: String(prepared % 10).repeat(64), expires_in_seconds: 300,
      ai_enabled: true, external_calls_implemented: true, estimated_input_tokens: 1500, estimated_max_cost_usd: 0.0014,
    })),
    authorize: vi.fn(async (_id: string, _sha: string, scope?: AIAuthorizationScope): Promise<unknown> => {
      const result = reply((replies += 1))
      return scope === 'conversation'
        ? { ...result, conversation: { conversation_id: 'conv-1', expires_in_seconds: 1800, max_messages: 20 } }
        : result
    }),
    cancel: vi.fn(async () => undefined),
    approvePlan: vi.fn(async (planId: string) => ({ plan_id: planId, status: 'approved', executed: false })),
    sendInConversation: vi.fn(async (): Promise<AIAuthorizeResult> => reply((replies += 1))),
    revokeConversation: vi.fn(async () => undefined),
  }
  return gateway satisfies AIGatewayClient
}

async function reachRealAssistant(gateway = fakeRealGateway()) {
  const user = userEvent.setup()
  const service = createDemoService({ delayMs: 0 })
  const router = createMemoryRouter(routes, { initialEntries: ['/analisis/cargar'] })
  render(
    <AppProviders service={service} aiGateway={gateway}>
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
  await waitFor(() => expect(composer).toBeEnabled())
  return { user, router, composer, gateway, service }
}

const panel = () => screen.findByRole('region', { name: 'Autorizar envío a OpenAI' })

async function authorizeMessage(user: ReturnType<typeof userEvent.setup>, scope: 'message' | 'conversation' = 'message') {
  const box = await panel()
  const label = scope === 'message' ? 'Autorizar solo este mensaje' : 'Autorizar esta conversación'
  await user.click(await within(box).findByRole('button', { name: label }))
  await waitFor(() => expect(screen.queryByRole('region', { name: 'Autorizar envío a OpenAI' })).not.toBeInTheDocument())
}

async function sendMessage(user: ReturnType<typeof userEvent.setup>, composer: HTMLElement, text: string) {
  await waitFor(() => expect(composer).toBeEnabled())
  await user.type(composer, `${text}{Enter}`)
}

describe('plan aprobado y paso «Confirmar»', () => {
  it('el plan aprobado llega completo a «Confirmar», sin consultar de nuevo a la IA ni calcular', async () => {
    const { user, router, composer, gateway, service } = await reachRealAssistant()
    const runSpy = vi.spyOn(service, 'runAnalysis')
    await startConversation(user)
    await authorizeMessage(user)
    expect(await screen.findByText('Respuesta 1 de la IA.')).toBeInTheDocument()

    // Segunda propuesta, con una aclaración: no borra la primera.
    await sendMessage(user, composer, 'Las ventas están en ARS, una fila por sector y mes.')
    await authorizeMessage(user)
    expect(await screen.findByText('Respuesta 2 de la IA.')).toBeInTheDocument()
    expect(screen.getByText('Respuesta 1 de la IA.')).toBeInTheDocument()
    expect(screen.getByText(/4 planes propuestos · 0 aprobados/)).toBeInTheDocument()

    // Aprobar un plan de la SEGUNDA propuesta marca exactamente ese plan.
    const target = screen.getByRole('region', { name: 'Plan propuesto: Ventas totales por sector (v2)' })
    await user.click(within(target).getByRole('button', { name: 'Aprobar este plan' }))
    expect(gateway.approvePlan).toHaveBeenCalledWith('plan-2a')
    expect(await within(target).findByText('Aprobado')).toBeInTheDocument()
    const older = screen.getByRole('region', { name: 'Plan propuesto: Ventas totales por sector (v1)' })
    expect(within(older).queryByText('Aprobado')).not.toBeInTheDocument()
    expect(screen.getByText(/4 planes propuestos · 1 aprobado/)).toBeInTheDocument()

    // Aviso inmediato con el acceso al paso siguiente (una sola vez).
    const banner = screen.getByRole('region', { name: 'Plan aprobado' })
    expect(banner).toHaveTextContent('Plan aprobado correctamente.')
    expect(banner).toHaveTextContent('Tu propuesta está lista para revisar en el siguiente paso.')
    expect(screen.getAllByRole('button', { name: /Continuar a Confirmar/ })).toHaveLength(1)

    const calls = { prepare: gateway.prepare.mock.calls.length, authorize: gateway.authorize.mock.calls.length }
    await user.click(within(banner).getByRole('button', { name: /Continuar a Confirmar/ }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/analisis/confirmar'))

    // «Confirmar» muestra el plan estructurado aprobado, completo.
    const approved = await screen.findByRole('region', { name: 'Plan aprobado: Ventas totales por sector (v2)' })
    expect(approved).toHaveTextContent('Fuente A · ventas.csv')
    expect(approved).toHaveTextContent('Compara sectores (v2).')
    expect(approved).toHaveTextContent('sector, ventas')
    expect(approved).toHaveTextContent('Suma de ventas por sector')
    expect(approved).toHaveTextContent('Barras — Ventas por sector')
    expect(approved).toHaveTextContent('Solo dos meses (v2).')
    expect(screen.queryByRole('region', { name: /Plan aprobado: .*\(v1\)/ })).not.toBeInTheDocument()
    expect(screen.getByText(OBJECTIVE)).toBeInTheDocument()
    expect(screen.getByText('Las ventas están en ARS, una fila por sector y mes.')).toBeInTheDocument()
    expect(screen.getByText('Las ventas se interpretan en ARS (v2).')).toBeInTheDocument()
    expect(screen.getByText('Todavía no se ejecuta ningún cálculo')).toBeInTheDocument()

    // Confirmación final: requiere marcar la revisión; no calcula nada.
    const confirm = screen.getByRole('button', { name: 'Confirmar propuesta' })
    expect(confirm).toBeDisabled()
    await user.click(screen.getByRole('checkbox', { name: /Revisé los planes aprobados/ }))
    await user.click(confirm)
    expect(await screen.findByText('Propuesta confirmada')).toBeInTheDocument()

    // Volver al asistente conserva planes y aprobación; ir y venir no consulta a la IA.
    await act(() => router.navigate('/analisis/asistente'))
    const again = await screen.findByRole('region', { name: 'Plan propuesto: Ventas totales por sector (v2)' })
    expect(within(again).getByText('Aprobado')).toBeInTheDocument()
    expect(screen.getByText(/4 planes propuestos · 1 aprobado/)).toBeInTheDocument()
    await act(() => router.navigate('/analisis/confirmar'))
    expect(await screen.findByRole('region', { name: 'Plan aprobado: Ventas totales por sector (v2)' })).toBeInTheDocument()

    expect(gateway.prepare.mock.calls.length).toBe(calls.prepare)
    expect(gateway.authorize.mock.calls.length).toBe(calls.authorize)
    expect(gateway.sendInConversation).not.toHaveBeenCalled()
    expect(gateway.approvePlan).toHaveBeenCalledTimes(1)
    expect(runSpy).not.toHaveBeenCalled()
  }, 15_000) // recorrido largo de punta a punta: con la suite completa en paralelo supera los 5 s por defecto

  it('el paso del encabezado también lleva al plan aprobado', async () => {
    const { user, router } = await reachRealAssistant()
    await startConversation(user)
    await authorizeMessage(user)
    const plan = await screen.findByRole('region', { name: 'Plan propuesto: Evolución mensual (v1)' })
    await user.click(within(plan).getByRole('button', { name: 'Aprobar este plan' }))
    await within(plan).findByText('Aprobado')
    await user.click(within(screen.getByRole('navigation', { name: 'Pasos del análisis' })).getByRole('link', { name: /Confirmar/ }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/analisis/confirmar'))
    expect(await screen.findByRole('region', { name: 'Plan aprobado: Evolución mensual (v1)' })).toBeInTheDocument()
  })

  it('«Seguir conversando» cierra el aviso y deja el chat listo', async () => {
    const { user, composer } = await reachRealAssistant()
    await startConversation(user)
    await authorizeMessage(user)
    const plan = await screen.findByRole('region', { name: 'Plan propuesto: Evolución mensual (v1)' })
    await user.click(within(plan).getByRole('button', { name: 'Aprobar este plan' }))
    await user.click(await screen.findByRole('button', { name: 'Seguir conversando' }))
    expect(screen.queryByRole('region', { name: 'Plan aprobado' })).not.toBeInTheDocument()
    expect(composer).toHaveFocus()
  })

  it('sin planes aprobados, «Confirmar» muestra un estado vacío y no permite confirmar', async () => {
    const { user, router } = await reachRealAssistant()
    await startConversation(user)
    await authorizeMessage(user)
    await screen.findByText('Respuesta 1 de la IA.')
    await act(() => router.navigate('/analisis/confirmar'))
    expect(await screen.findByText('Todavía no aprobaste ningún plan')).toBeInTheDocument()
    expect(screen.getByText(/El asistente propuso 2 planes/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Confirmar propuesta' })).not.toBeInTheDocument()
  })
})

describe('autorización por conversación', () => {
  it('la primera solicitud pide consentimiento explícito con las dos opciones y su alcance', async () => {
    const { user, gateway } = await reachRealAssistant()
    expect(screen.getByRole('status', { name: 'Estado de la autorización' })).toHaveTextContent('Autorización por mensaje')
    await startConversation(user)
    const box = await panel()
    expect(await within(box).findByRole('button', { name: 'Autorizar solo este mensaje' })).toBeInTheDocument()
    expect(within(box).getByRole('button', { name: 'Autorizar esta conversación' })).toBeInTheDocument()
    expect(box).toHaveTextContent(/comparte tu nuevo mensaje y un historial limitado de la conversación, además del objetivo y los metadatos ya autorizados/)
    expect(box).toHaveTextContent(/Vence a los 30 minutos o tras 20 mensajes/)
    // El JSON queda plegado: no ocupa la pantalla.
    expect(within(box).getByText('Ver el contenido exacto (JSON)').closest('details')).not.toHaveAttribute('open')
    expect(gateway.authorize).not.toHaveBeenCalled()
  })

  it('con «solo este mensaje», cada mensaje vuelve a pedir autorización', async () => {
    const { user, composer, gateway } = await reachRealAssistant()
    await startConversation(user)
    await authorizeMessage(user, 'message')
    await screen.findByText('Respuesta 1 de la IA.')
    expect(gateway.authorize).toHaveBeenLastCalledWith('req1', expect.any(String), 'message')

    await sendMessage(user, composer, 'Sí, en ARS')
    expect(await panel()).toBeInTheDocument()
    expect(gateway.sendInConversation).not.toHaveBeenCalled()
  })

  it('con la conversación autorizada, los mensajes siguientes van directo y se ven como un chat normal', async () => {
    const { user, composer, gateway } = await reachRealAssistant()
    await startConversation(user)
    await authorizeMessage(user, 'conversation')
    expect(gateway.authorize).toHaveBeenCalledWith('req1', expect.any(String), 'conversation')
    const status = screen.getByRole('status', { name: 'Estado de la autorización' })
    expect(status).toHaveTextContent('Conversación autorizada')
    expect(status).toHaveTextContent(/vence a las/)

    await sendMessage(user, composer, 'Las ventas están en ARS.')
    expect(await screen.findByText('Respuesta 2 de la IA.')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Autorizar envío a OpenAI' })).not.toBeInTheDocument()
    expect(gateway.prepare).toHaveBeenCalledTimes(1) // sin nueva validación visual
    expect(gateway.sendInConversation).toHaveBeenCalledTimes(1)
    const [conversationId, payload] = gateway.sendInConversation.mock.calls[0] as unknown as [string, { message: string; history: { role: string }[] }]
    expect(conversationId).toBe('conv-1')
    expect(payload.message).toBe('Las ventas están en ARS.')
    expect(payload.history.map((t) => t.role)).toEqual(['user', 'assistant'])
    expect(JSON.stringify(payload)).not.toMatch(/ventas\.csv|Comercio|1200/)
    // Consumo visible en cada respuesta.
    expect(screen.getAllByText(/1265 tokens de entrada y 493 de salida · USD 0\.0004/)).toHaveLength(2)

    await sendMessage(user, composer, 'Agregá la evolución mensual.')
    expect(await screen.findByText('Respuesta 3 de la IA.')).toBeInTheDocument()
    expect(gateway.sendInConversation).toHaveBeenCalledTimes(2)
  })

  it('revocar el permiso bloquea los envíos directos hasta una nueva autorización', async () => {
    const { user, composer, gateway } = await reachRealAssistant()
    await startConversation(user)
    await authorizeMessage(user, 'conversation')
    await user.click(screen.getByRole('button', { name: 'Desactivar autorización de conversación' }))
    await waitFor(() => expect(gateway.revokeConversation).toHaveBeenCalledWith('conv-1'))
    expect(screen.getByRole('status', { name: 'Estado de la autorización' })).toHaveTextContent('Autorización por mensaje')

    await sendMessage(user, composer, '¿Seguimos?')
    expect(await panel()).toBeInTheDocument()
    expect(gateway.sendInConversation).not.toHaveBeenCalled()
  })

  it('si el backend rechaza el permiso (configuración cambiada), se pide una nueva autorización sin reintentar solo', async () => {
    const { user, composer, gateway } = await reachRealAssistant()
    await startConversation(user)
    await authorizeMessage(user, 'conversation')
    gateway.sendInConversation.mockRejectedValueOnce(
      new ApiError('Cambió la configuración de privacidad: se requiere una nueva autorización. No se envió nada.', { status: 409 }),
    )
    await sendMessage(user, composer, 'Otra pregunta')
    const box = await panel()
    expect(within(box).getByText(/Cambió la configuración de privacidad/)).toBeInTheDocument()
    expect(box).toHaveTextContent('Otra pregunta')
    expect(gateway.sendInConversation).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('status', { name: 'Estado de la autorización' })).toHaveTextContent('Se requiere nueva autorización')
  })

  it('los límites siguen aplicándose: un 402 se informa, el texto vuelve al chat y el permiso sigue vigente', async () => {
    const { user, composer, gateway } = await reachRealAssistant()
    await startConversation(user)
    await authorizeMessage(user, 'conversation')
    gateway.sendInConversation.mockRejectedValueOnce(
      new ApiError('Presupuesto local insuficiente: quedan USD 0.0003. No se envió nada.', { status: 402 }),
    )
    await sendMessage(user, composer, 'Otra pregunta')
    expect(await screen.findByText(/Presupuesto local insuficiente/)).toBeInTheDocument()
    await waitFor(() => expect(composer).toHaveValue('Otra pregunta'))
    expect(gateway.sendInConversation).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('status', { name: 'Estado de la autorización' })).toHaveTextContent('Conversación autorizada')
  })

  it('un permiso vencido no se usa: el envío vuelve a pedir autorización', async () => {
    const { user, composer, gateway } = await reachRealAssistant()
    await startConversation(user)
    await authorizeMessage(user, 'conversation')
    const later = Date.now() + 31 * 60 * 1000
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(later)
    await sendMessage(user, composer, 'Hola de nuevo')
    const box = await panel()
    expect(box).toHaveTextContent(/venció/)
    expect(gateway.sendInConversation).not.toHaveBeenCalled()
    nowSpy.mockRestore()
  })

  it('cambiar la configuración de datos anula el permiso y lo revoca en el backend', async () => {
    const { user, gateway } = await reachRealAssistant()
    await startConversation(user)
    await authorizeMessage(user, 'conversation')
    await user.click(screen.getByRole('link', { name: /Modificar configuración de datos/ }))
    await screen.findByRole('heading', { name: /Revisá tus datos y la privacidad/ })
    await user.selectOptions(screen.getByLabelText('Significado de ventas (fuente A)'), 'categorical')
    await waitFor(() => expect(gateway.revokeConversation).toHaveBeenCalledWith('conv-1'))
    await user.click(screen.getByRole('button', { name: /Confirmar revisión y continuar/ }))
    await screen.findByText(/IA real · gpt-6-luna/)
    expect(screen.getByRole('status', { name: 'Estado de la autorización' })).toHaveTextContent('Autorización por mensaje')
    // La conversación anterior dependía de la configuración anterior: empieza de nuevo.
    expect(screen.queryByText('Respuesta 1 de la IA.')).not.toBeInTheDocument()
  })
})
