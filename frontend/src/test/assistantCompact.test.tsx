import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { AppProviders } from '@/context/AppProviders'
import { routes } from '@/routes'
import { ApiError } from '@/services'
import type { AIAuthorizeResult, AIGatewayClient } from '@/services/aiGateway'
import { createDemoService } from '@/services/demoProvider'
import { completeReview, goToReview, startConversation } from './reviewHelpers'

const csv = (name: string, text: string) => new File([text], name, { type: 'text/csv' })
const ventas = () => csv('ventas.csv', 'pais,codigo,monto\nAR,001,10\nNA,002,20\n')
const regiones = () => csv('regiones.csv', 'region,poblacion\nNorte,1000\nSur,2000\n')

/** Backend con la IA deshabilitada (prueba de autorización). */
function fakeGateway() {
  let n = 0
  const gateway = {
    status: vi.fn(async () => ({ ai_enabled: false, provider_configured: false, external_calls_implemented: false })),
    prepare: vi.fn(async (payload) => ({
      request_id: `req${(n += 1)}`, payload, payload_sha256: String(n).repeat(64), expires_in_seconds: 300, ai_enabled: false, external_calls_implemented: false,
    })),
    authorize: vi.fn(async () => {
      throw new Error('La IA externa está deshabilitada (AI_ENABLED=false). No se envió nada.')
    }),
    cancel: vi.fn(async () => undefined),
  }
  return gateway satisfies AIGatewayClient
}

function realReply(n: number): AIAuthorizeResult {
  return {
    reply: {
      message: n === 1 ? 'Voy a analizar cada fuente por separado.' : 'Perfecto, ajusto el plan por año.',
      interpreted_objective: 'Comparar montos por país',
      source_relationship: 'independent',
      questions: n === 1 ? [{ question: '¿Los NA de pais son faltantes o un país válido?', reason: 'Cambia el conteo.', source_alias: 'A', column: 'pais' }] : [],
      plans: [
        { source_alias: 'A', title: `Montos por país (v${n})`, rationale: 'Muestra dónde se concentran.', columns_needed: ['pais', 'monto'],
          operations: [{ operation: 'sum', columns: ['monto'], group_by: ['pais'], description: 'Total por país' }],
          charts: [{ type: 'bar', x: 'pais', y: 'monto', title: 'Monto por país' }], limitations: [] },
        { source_alias: 'B', title: `Población por región (v${n})`, rationale: 'Describe la fuente B por separado.', columns_needed: ['region', 'poblacion'],
          operations: [{ operation: 'sum', columns: ['poblacion'], group_by: ['region'], description: 'Total por región' }],
          charts: [], limitations: [] },
      ],
      warnings: [],
    },
    plan_ids: [`plan-a${n}`, `plan-b${n}`],
    usage: { model: 'gpt-6-luna', input_tokens: 1500, output_tokens: 420, cost_usd: 0.00036, remaining_usd: 0.99964 },
  }
}

/** Backend con la IA real habilitada, pero con un proveedor falso: no hay red ni consumo. */
function realGateway() {
  let n = 0
  let replies = 0
  const gateway = {
    status: vi.fn(async () => ({
      ai_enabled: true, provider_configured: true, external_calls_implemented: true, model: 'gpt-6-luna',
      budget_usd: 1, spent_usd: 0, remaining_usd: 1, requests_used: 0, max_requests: 25, max_output_tokens: 2500,
    })),
    prepare: vi.fn(async (payload) => ({
      request_id: `real${(n += 1)}`, payload, payload_sha256: String(n).repeat(64), expires_in_seconds: 300,
      ai_enabled: true, external_calls_implemented: true, estimated_input_tokens: 1600, estimated_max_cost_usd: 0.00141,
    })),
    authorize: vi.fn(async (): Promise<unknown> => realReply((replies += 1))),
    cancel: vi.fn(async () => undefined),
    approvePlan: vi.fn(async (planId: string) => ({ plan_id: planId, status: 'approved', executed: false })),
  }
  return gateway satisfies AIGatewayClient
}

/** Carga, revisa (dejando `codigo` sin compartir) y entra al asistente. */
async function reachAssistant(aiGateway: AIGatewayClient | null, files = [ventas(), regiones()]) {
  const user = userEvent.setup()
  const service = createDemoService({ delayMs: 0 })
  const router = createMemoryRouter(routes, { initialEntries: ['/analisis/cargar'] })
  render(
    <AppProviders service={service} aiGateway={aiGateway}>
      <RouterProvider router={router} />
    </AppProviders>,
  )
  await user.upload(await screen.findByTestId('file-input'), files)
  const list = await screen.findByRole('list', { name: 'Fuentes del análisis' })
  await waitFor(() => expect(within(list).getAllByLabelText('Archivo listo')).toHaveLength(files.length))
  await goToReview(user)
  await user.click(screen.getByRole('checkbox', { name: 'Compartir la columna codigo de la fuente A' }))
  await completeReview(user, 'Comparar montos por país')
  await waitFor(() => expect(router.state.location.pathname).toBe('/analisis/asistente'))
  const composer = await screen.findByRole('textbox', { name: /Mensaje/i })
  if (!aiGateway) await waitFor(() => expect(composer).toBeEnabled())
  return { user, router, composer, service }
}

describe('paso 3: resumen compacto en lugar del formulario completo', () => {
  it('muestra el estado de la revisión sin selectores ni JSON de configuración', async () => {
    await reachAssistant(null)
    const summary = screen.getByRole('region', { name: 'Resumen de la revisión de datos' })
    expect(summary).toHaveTextContent('Datos revisados')
    expect(summary).toHaveTextContent('2 fuentes')
    expect(summary).toHaveTextContent('Fuente A · ventas.csv: 2 de 3 columnas autorizadas para la IA')
    expect(summary).toHaveTextContent('Fuente B · regiones.csv: 2 de 2 columnas autorizadas para la IA')
    expect(summary).toHaveTextContent('Ninguna información se envía automáticamente a OpenAI.')

    // Nada de la configuración del paso 2 se repite acá.
    expect(screen.queryAllByRole('combobox')).toHaveLength(0)
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0)
    expect(screen.queryByLabelText('¿Qué necesitás analizar?')).not.toBeInTheDocument()
    expect(screen.queryByTestId('ai-payload-preview')).not.toBeInTheDocument()
    // Un único control para volver a la configuración.
    expect(screen.getAllByRole('link', { name: /configuración de datos|revisar datos/i })).toHaveLength(1)
  })

  it('«Modificar configuración de datos» vuelve al paso 2 sin perder nada', async () => {
    const { user } = await reachAssistant(null)
    await user.click(screen.getByRole('link', { name: /Modificar configuración de datos/ }))
    await screen.findByRole('heading', { name: /Revisá tus datos y la privacidad/ })
    expect(screen.getByRole('checkbox', { name: 'Compartir la columna codigo de la fuente A' })).not.toBeChecked()
    expect(screen.getByLabelText('¿Qué necesitás analizar?')).toHaveValue('Comparar montos por país')

    // Modificar una variable invalida la confirmación anterior.
    await user.selectOptions(screen.getByLabelText('Significado de monto (fuente A)'), 'categorical')
    expect(screen.getByRole('button', { name: /Confirmar revisión y continuar/ })).toBeInTheDocument()
  })

  it('el asistente DEMO sigue respondiendo y la demo pública no hace solicitudes', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const { user } = await reachAssistant(null, [ventas()])
    expect(screen.queryByText(/Enviar a la IA real/)).not.toBeInTheDocument()
    expect(screen.queryByText(/IA real ·/)).not.toBeInTheDocument()
    await startConversation(user)
    expect(await screen.findByText(/Entiendo tu objetivo/)).toBeInTheDocument()
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })
})

describe('objetivo confirmado y «Comenzar conversación»', () => {
  it('muestra el objetivo como resumen, sin copiarlo en el chat ni enviarlo solo', async () => {
    const gateway = realGateway()
    const { composer } = await reachAssistant(gateway, [ventas()])
    await screen.findByText(/IA real · gpt-6-luna/)
    const card = screen.getByRole('region', { name: 'Objetivo confirmado' })
    expect(card).toHaveTextContent('Comparar montos por país')
    expect(within(card).getByRole('button', { name: 'Comenzar conversación' })).toBeInTheDocument()
    expect(composer).toHaveValue('')
    expect(gateway.prepare).not.toHaveBeenCalled()
    expect(screen.queryByText(/Tu objetivo está preparado/)).not.toBeInTheDocument()
  })

  it('en modo DEMO, «Comenzar conversación» envía el objetivo una vez y deja el chat libre', async () => {
    const { user, composer, service } = await reachAssistant(null, [ventas()])
    const sendSpy = vi.spyOn(service, 'sendMessage')
    await startConversation(user)
    expect(await screen.findByText(/Entiendo tu objetivo/)).toBeInTheDocument()
    expect(sendSpy).toHaveBeenCalledTimes(1)
    expect(sendSpy.mock.calls[0][1]).toEqual({ content: 'Comparar montos por país' })
    expect(screen.queryByRole('region', { name: 'Objetivo confirmado' })).not.toBeInTheDocument()
    await waitFor(() => expect(composer).toBeEnabled())
    expect(composer).toHaveValue('')
  })

  it('la revisión pide el objetivo en lenguaje simple, sin detalles técnicos', async () => {
    const user = userEvent.setup()
    const router = createMemoryRouter(routes, { initialEntries: ['/analisis/cargar'] })
    render(
      <AppProviders service={createDemoService({ delayMs: 0 })} aiGateway={null}>
        <RouterProvider router={router} />
      </AppProviders>,
    )
    await user.upload(await screen.findByTestId('file-input'), [ventas()])
    await waitFor(() => expect(screen.getAllByLabelText('Archivo listo')).toHaveLength(1))
    await goToReview(user)
    expect(screen.getByText(/no hace falta explicar cálculos, gráficos ni reportes/)).toBeInTheDocument()
  })
})

describe('modo real sin IA disponible: error claro, nunca respuestas simuladas', () => {
  /** El asistente DEMO no debe intervenir: ni saludo, ni respuestas, ni propuesta simulada. */
  function expectNoDemo(service: ReturnType<typeof createDemoService>, spies: { conv: unknown; send: unknown }) {
    expect(screen.queryByText('Conversación de demostración')).not.toBeInTheDocument()
    expect(screen.queryByText(/Asistente simulado/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Entiendo tu objetivo/)).not.toBeInTheDocument()
    expect(screen.queryByText(/«Enviar» conversa con el asistente DEMO/)).not.toBeInTheDocument()
    expect(spies.conv).not.toHaveBeenCalled()
    expect(spies.send).not.toHaveBeenCalled()
    void service
  }

  async function reachWith(status: Parameters<typeof vi.fn>[0]) {
    const gateway = fakeGateway()
    gateway.status.mockImplementation(status as never)
    const service = createDemoService({ delayMs: 0 })
    const spies = { conv: vi.spyOn(service, 'getConversation'), send: vi.spyOn(service, 'sendMessage') }
    const user = userEvent.setup()
    const router = createMemoryRouter(routes, { initialEntries: ['/analisis/cargar'] })
    render(
      <AppProviders service={service} aiGateway={gateway}>
        <RouterProvider router={router} />
      </AppProviders>,
    )
    await user.upload(await screen.findByTestId('file-input'), [ventas()])
    await waitFor(() => expect(screen.getAllByLabelText('Archivo listo')).toHaveLength(1))
    await goToReview(user)
    await completeReview(user, 'Comparar montos por país')
    await waitFor(() => expect(router.state.location.pathname).toBe('/analisis/asistente'))
    return { gateway, service, spies, user }
  }

  it.each([
    [{ ai_enabled: false, provider_configured: false, external_calls_implemented: true }, /AI_ENABLED=false/],
    [{ ai_enabled: true, provider_configured: false, external_calls_implemented: true }, /Falta configurar OPENAI_API_KEY/],
    [{ ai_enabled: true, provider_configured: true, external_calls_implemented: false }, /no tiene un proveedor de IA disponible/],
  ])('si el backend informa %o, muestra el motivo y no simula respuestas', async (status, message) => {
    const { gateway, service, spies, user } = await reachWith(async () => status)
    const alert = await screen.findByText('La IA no está disponible')
    expect(alert.closest('[role="alert"]')).toHaveTextContent(message)
    expect(alert.closest('[role="alert"]')).toHaveTextContent('No se muestran respuestas simuladas')
    expect(screen.getByText('IA no disponible')).toBeInTheDocument()
    const start = screen.getByRole('button', { name: 'Comenzar conversación' })
    expect(start).toBeDisabled()
    await user.click(start)
    expect(screen.getByRole('textbox', { name: /Mensaje/i })).toBeDisabled()
    expect(gateway.prepare).not.toHaveBeenCalled()
    expect(screen.queryByRole('group', { name: 'Envío a la IA real' })).not.toBeInTheDocument()
    expectNoDemo(service, spies)
  })

  it('si el backend no responde, lo informa y permite reintentar sin simular nada', async () => {
    let fail = true
    const { service, spies, user } = await reachWith(async () => {
      if (fail) throw new ApiError('No se pudo conectar con el backend en http://127.0.0.1:8000.', { status: null })
      return {
        ai_enabled: true, provider_configured: true, external_calls_implemented: true, model: 'gpt-6-luna',
        budget_usd: 1, spent_usd: 0, remaining_usd: 1, requests_used: 0, max_requests: 25, max_output_tokens: 2500,
      }
    })
    const alert = (await screen.findByText('La IA no está disponible')).closest('[role="alert"]') as HTMLElement
    expect(alert).toHaveTextContent('No se pudo consultar al backend')
    expectNoDemo(service, spies)

    fail = false
    await user.click(within(alert).getByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByText(/IA real · gpt-6-luna/)).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Comenzar conversación' })).toBeEnabled())
    expect(screen.queryByText('La IA no está disponible')).not.toBeInTheDocument()
  })

  it('mientras comprueba la IA, no habilita el chat ni muestra el asistente DEMO', async () => {
    const { service, spies } = await reachWith(() => new Promise(() => undefined))
    expect(await screen.findByText('Comprobando la conexión con la IA…')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Comenzar conversación' })).toBeDisabled()
    expect(screen.getByRole('textbox', { name: /Mensaje/i })).toBeDisabled()
    expectNoDemo(service, spies)
  })
})

describe('IA real (proveedor falso, sin consumo)', () => {
  async function startReal() {
    const gateway = realGateway()
    const ctx = await reachAssistant(gateway)
    await screen.findByText(/IA real · gpt-6-luna/)
    await waitFor(() => expect(ctx.composer).toBeEnabled())
    return { gateway, ...ctx }
  }

  it('se diferencia del DEMO y no muestra la prueba de autorización', async () => {
    const { service } = await startReal()
    expect(screen.getByText('Asistente con IA real (OpenAI)')).toBeInTheDocument()
    expect(screen.queryByText('Conversación de demostración')).not.toBeInTheDocument()
    expect(screen.getByText(/«Enviar» prepara el envío a OpenAI: nada sale sin tu autorización\./)).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Envío a la IA real' })).not.toBeInTheDocument()
    expect(screen.getByText(/Presupuesto local disponible: USD 1\.0000 de 1\.00/)).toBeInTheDocument()
    const sendSpy = vi.spyOn(service, 'sendMessage')
    expect(sendSpy).not.toHaveBeenCalled()
  })

  it('«Comenzar conversación» pasa por la autorización; la respuesta llega solo después de autorizar', async () => {
    const { user, gateway, service } = await startReal()
    const sendSpy = vi.spyOn(service, 'sendMessage')
    await startConversation(user)

    const panel = await screen.findByRole('region', { name: 'Autorizar envío a OpenAI' })
    await waitFor(() => expect(gateway.prepare).toHaveBeenCalledTimes(1))
    // El objetivo no se envía duplicado como mensaje.
    const sent = gateway.prepare.mock.calls[0][0]
    expect(sent.objective).toBe('Comparar montos por país')
    expect(sent.message).toBeUndefined()
    expect(sent.history).toBeUndefined()
    expect(JSON.stringify(sent)).not.toMatch(/ventas\.csv|regiones\.csv|codigo|001|Norte/)
    expect(await within(panel).findByText(/Costo máximo estimado:/)).toHaveTextContent('USD 0.0014')
    expect(gateway.authorize).not.toHaveBeenCalled()
    expect(screen.queryByTestId('ai-reply')).not.toBeInTheDocument()

    await user.click(within(panel).getByRole('button', { name: 'Autorizar solo este mensaje' }))
    const reply = await screen.findByTestId('ai-reply')
    expect(gateway.authorize).toHaveBeenCalledWith('real1', '1'.repeat(64), 'message')
    expect(within(reply).getByText('Voy a analizar cada fuente por separado.')).toBeInTheDocument()
    expect(within(reply).getByRole('region', { name: 'Preguntas del asistente' })).toHaveTextContent('¿Los NA de pais')
    expect(within(reply).getByRole('region', { name: /Plan propuesto: Montos por país/ })).toHaveTextContent('Fuente A')
    expect(within(reply).getByRole('region', { name: /Plan propuesto: Población por región/ })).toHaveTextContent('Fuente B')
    expect(within(reply).getByText(/gpt-6-luna · 1500 tokens de entrada y 420 de salida · USD 0\.0004/)).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Autorizar envío a OpenAI' })).not.toBeInTheDocument()
    expect(sendSpy).not.toHaveBeenCalled() // el asistente DEMO no participa
  })

  it('los mensajes siguientes llevan el historial, necesitan su propia autorización y la conversación se conserva', async () => {
    const { user, gateway, composer } = await startReal()
    await startConversation(user)
    await user.click(await screen.findByRole('button', { name: 'Autorizar solo este mensaje' }))
    await screen.findByTestId('ai-reply')

    await user.type(composer, 'Los NA son faltantes. Quiero ver por año.{Enter}')
    const panel = await screen.findByRole('region', { name: 'Autorizar envío a OpenAI' })
    await waitFor(() => expect(gateway.prepare).toHaveBeenCalledTimes(2))
    const second = gateway.prepare.mock.calls[1][0]
    expect(second.message).toBe('Los NA son faltantes. Quiero ver por año.')
    expect(second.history?.map((t: { role: string }) => t.role)).toEqual(['user', 'assistant'])
    expect(second.history?.[1].content).toContain('¿Los NA de pais son faltantes o un país válido?')
    // El historial lleva las operaciones de cada plan: la IA puede ajustarlo en lugar de repetirlo.
    expect(second.history?.[1].content).toContain('Operaciones: sum(monto por pais)')
    expect(gateway.authorize).toHaveBeenCalledTimes(1)

    await user.click(within(panel).getByRole('button', { name: 'Autorizar solo este mensaje' }))
    await waitFor(() => expect(screen.getAllByTestId('ai-reply')).toHaveLength(2))
    // La primera respuesta sigue visible.
    expect(screen.getByText('Voy a analizar cada fuente por separado.')).toBeInTheDocument()
    expect(screen.getByText('Perfecto, ajusto el plan por año.')).toBeInTheDocument()
    expect(gateway.authorize).toHaveBeenCalledTimes(2)
  })

  it('cancelar el envío no autoriza nada y devuelve el texto al chat', async () => {
    const { user, gateway, composer } = await startReal()
    await startConversation(user)
    await user.click(await screen.findByRole('button', { name: 'Autorizar solo este mensaje' }))
    await screen.findByTestId('ai-reply')
    await user.type(composer, 'Mejor por mes{Enter}')
    const panel = await screen.findByRole('region', { name: 'Autorizar envío a OpenAI' })
    await user.click(within(panel).getByRole('button', { name: 'Cancelar' }))
    expect(composer).toHaveValue('Mejor por mes')
    expect(gateway.authorize).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(gateway.cancel).toHaveBeenCalled())
  })

  it.each([
    [402, 'Presupuesto local insuficiente: quedan USD 0.0001. No se envió nada.'],
    [429, 'La cuenta de OpenAI no tiene saldo o cuota disponible.'],
    [502, 'OpenAI rechazó las credenciales. Revisá OPENAI_API_KEY en backend/.env.'],
    [504, 'OpenAI no respondió a tiempo. No se reintentó automáticamente.'],
    [502, 'La respuesta de la IA no superó la validación y se descartó.'],
  ])('muestra errores comprensibles (%i) sin reintentar ni perder la conversación', async (status, detail) => {
    const { user, gateway } = await startReal()
    gateway.authorize.mockRejectedValueOnce(new ApiError(detail, { status }))
    await startConversation(user)
    const panel = await screen.findByRole('region', { name: 'Autorizar envío a OpenAI' })
    await user.click(await within(panel).findByRole('button', { name: 'Autorizar solo este mensaje' }))
    expect(await within(panel).findByText(detail)).toBeInTheDocument()
    expect(gateway.authorize).toHaveBeenCalledTimes(1) // sin reintentos automáticos
    // El usuario decide: puede validar de nuevo (otra autorización) o cancelar.
    expect(within(panel).getByRole('button', { name: 'Validar de nuevo' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Resumen de la revisión de datos' })).toBeInTheDocument()
    expect(screen.queryByTestId('ai-reply')).not.toBeInTheDocument()
  })

  it('aprobar un plan lo registra en el backend sin ejecutar cálculos', async () => {
    const { user, gateway } = await startReal()
    await startConversation(user)
    await user.click(await screen.findByRole('button', { name: 'Autorizar solo este mensaje' }))
    const plan = await screen.findByRole('region', { name: /Plan propuesto: Montos por país/ })
    await user.click(within(plan).getByRole('button', { name: 'Aprobar este plan' }))
    expect(gateway.approvePlan).toHaveBeenCalledWith('plan-a1')
    expect(await within(plan).findByText('Aprobado')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Plan aprobado' })).toHaveTextContent('Plan aprobado correctamente.')
    expect(screen.getByText(/2 planes propuestos · 1 aprobado/)).toBeInTheDocument()
  })
})
