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
  await waitFor(() => expect(composer).toBeEnabled())
  return { user, router, composer, service }
}

async function openAuthorization(user: ReturnType<typeof userEvent.setup>) {
  const box = screen.getByRole('group', { name: 'Envío a la IA real' })
  await user.click(within(box).getByText(/Enviar a la IA real/))
  return box
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
    const gateway = fakeGateway()
    const { composer } = await reachAssistant(gateway, [ventas()])
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

describe('prueba de autorización con la IA deshabilitada (backend sin OpenAI)', () => {
  it('el contenido incluye el mensaje y las columnas autorizadas; cada cambio invalida y el permiso es de un uso', async () => {
    const gateway = fakeGateway()
    const { user, composer } = await reachAssistant(gateway)
    await user.type(composer, '¿Cómo varía el monto por país?')

    const box = await openAuthorization(user)
    const shown = JSON.parse(within(box).getByTestId('message-payload-preview').textContent ?? '{}')
    expect(shown.message).toBe('¿Cómo varía el monto por país?')
    expect(shown.objective).toBe('Comparar montos por país')
    expect(shown.sources[0].columns.map((c: { name: string }) => c.name)).toEqual(['pais', 'monto'])

    await user.click(within(box).getByRole('button', { name: 'Validar este mensaje' }))
    expect(gateway.prepare).toHaveBeenCalledTimes(1)
    expect(await within(box).findByRole('button', { name: 'Autorizar este envío' })).toBeInTheDocument()

    // Cambiar el mensaje invalida la validación anterior.
    await user.type(composer, ' Y por año')
    await waitFor(() => expect(gateway.cancel).toHaveBeenCalledWith('req1'))
    expect(within(box).queryByRole('button', { name: 'Autorizar este envío' })).not.toBeInTheDocument()

    // Validar y autorizar este mensaje: un solo uso.
    await user.click(within(box).getByRole('button', { name: 'Validar este mensaje' }))
    await user.click(await within(box).findByRole('button', { name: 'Autorizar este envío' }))
    expect(await within(box).findByText(/Prueba finalizada/)).toBeInTheDocument()
    expect(gateway.authorize).toHaveBeenCalledTimes(1)
    expect(gateway.authorize).toHaveBeenCalledWith('req2', '2'.repeat(64))
  })

  it('avisa que es una prueba y termina en un estado final claro, sin borrar nada', async () => {
    const gateway = fakeGateway()
    vi.mocked(gateway.authorize).mockRejectedValue(
      new ApiError('La IA externa está deshabilitada (AI_ENABLED=false). No se envió nada.', { status: 403 }),
    )
    const { user, composer } = await reachAssistant(gateway, [ventas()])
    // Una conversación previa con el asistente DEMO.
    await startConversation(user)
    expect(await screen.findByText(/Entiendo tu objetivo/)).toBeInTheDocument()
    await waitFor(() => expect(composer).toBeEnabled())
    await user.type(composer, '¿Qué país tiene más ventas?')

    const box = await openAuthorization(user)
    expect(within(box).getByText(/no habrá respuesta de IA ni se enviará ningún dato/)).toBeInTheDocument()

    await user.click(within(box).getByRole('button', { name: 'Validar este mensaje' }))
    await user.click(await within(box).findByRole('button', { name: 'Autorizar este envío' }))
    expect(
      await within(box).findByText(/Prueba finalizada\. La IA está deshabilitada y no se envió ningún dato\./),
    ).toBeInTheDocument()

    // Estado final: no se invita a repetir el proceso para conseguir una respuesta.
    expect(within(box).queryByRole('button', { name: 'Validar este mensaje' })).not.toBeInTheDocument()
    expect(within(box).queryByRole('button', { name: 'Autorizar este envío' })).not.toBeInTheDocument()
    // Se conserva todo: conversación, mensaje escrito, objetivo y decisiones.
    expect(screen.getByText(/Entiendo tu objetivo/)).toBeInTheDocument()
    expect(screen.getByText('Comparar montos por país')).toBeInTheDocument()
    expect(composer).toHaveValue('¿Qué país tiene más ventas?')
    expect(screen.getByRole('region', { name: 'Resumen de la revisión de datos' })).toHaveTextContent('2 de 3 columnas autorizadas')
    expect(gateway.authorize).toHaveBeenCalledTimes(1)

    // Otro mensaje es otro envío y empieza de cero.
    await user.type(composer, ' ¿Y por mes?')
    expect(within(box).getByRole('button', { name: 'Validar este mensaje' })).toBeInTheDocument()
    expect(within(box).queryByText(/Prueba finalizada/)).not.toBeInTheDocument()
  })

  it('el rechazo 501 (sin proveedor) también es un estado final sin envío', async () => {
    const gateway = fakeGateway()
    vi.mocked(gateway.status).mockResolvedValue({ ai_enabled: true, provider_configured: true, external_calls_implemented: false })
    vi.mocked(gateway.authorize).mockRejectedValue(new ApiError('No implementado', { status: 501 }))
    const { user, composer } = await reachAssistant(gateway, [ventas()])
    await user.type(composer, 'Hola')
    const box = await openAuthorization(user)
    await user.click(within(box).getByRole('button', { name: 'Validar este mensaje' }))
    await user.click(await within(box).findByRole('button', { name: 'Autorizar este envío' }))
    expect(await within(box).findByText(/todavía no está implementada y no se envió ningún dato/)).toBeInTheDocument()
    expect(within(box).queryByRole('button', { name: 'Validar este mensaje' })).not.toBeInTheDocument()
  })

  it('panel compacto: acciones antes del JSON, JSON con altura máxima y fuera de la tarjeta del chat', async () => {
    const { user } = await reachAssistant(fakeGateway(), [ventas()])
    const box = await openAuthorization(user)
    const validate = within(box).getByRole('button', { name: 'Validar este mensaje' })
    const preview = within(box).getByTestId('message-payload-preview')
    expect(validate.compareDocumentPosition(preview) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(preview.className).toMatch(/max-h-/)
    expect(preview.className).toMatch(/overflow-auto/)
    expect(preview).toHaveAttribute('tabindex', '0')
    // No está dentro de la tarjeta del chat, que tiene altura fija y recorta su contenido.
    expect(box.closest('.overflow-hidden')).toBeNull()
  })

  it('«Enviar» usa el asistente DEMO y no valida ni autoriza nada por su cuenta', async () => {
    const gateway = fakeGateway()
    const { user, composer } = await reachAssistant(gateway)
    expect(screen.getByText('«Enviar» conversa con el asistente DEMO, en este equipo. No usa OpenAI.')).toBeInTheDocument()
    await startConversation(user)
    expect(await screen.findByText(/Entiendo tu objetivo/)).toBeInTheDocument()
    await waitFor(() => expect(composer).toBeEnabled())
    await user.type(composer, 'Por país{Enter}')
    await waitFor(() => expect(screen.getAllByText('Por país').length).toBeGreaterThan(0))
    expect(gateway.prepare).not.toHaveBeenCalled()
    expect(gateway.authorize).not.toHaveBeenCalled()
  })
})

describe('IA real (proveedor falso, sin consumo)', () => {
  async function startReal() {
    const gateway = realGateway()
    const ctx = await reachAssistant(gateway)
    await screen.findByText(/IA real · gpt-6-luna/)
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
