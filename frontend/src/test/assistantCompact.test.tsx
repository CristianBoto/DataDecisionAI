import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { AppProviders } from '@/context/AppProviders'
import { routes } from '@/routes'
import { ApiError } from '@/services'
import type { AIGatewayClient } from '@/services/aiGateway'
import { createDemoService } from '@/services/demoProvider'
import { completeReview, goToReview } from './reviewHelpers'

const csv = (name: string, text: string) => new File([text], name, { type: 'text/csv' })
const ventas = () => csv('ventas.csv', 'pais,codigo,monto\nAR,001,10\nNA,002,20\n')
const regiones = () => csv('regiones.csv', 'region,poblacion\nNorte,1000\nSur,2000\n')

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

/** Carga, revisa (dejando `codigo` sin compartir) y entra al asistente. */
async function reachAssistant(aiGateway: AIGatewayClient | null, files = [ventas(), regiones()]) {
  const user = userEvent.setup()
  const router = createMemoryRouter(routes, { initialEntries: ['/analisis/cargar'] })
  render(
    <AppProviders service={createDemoService({ delayMs: 0 })} aiGateway={aiGateway}>
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
  return { user, router, composer }
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
    const { user, composer } = await reachAssistant(null, [ventas()])
    expect(screen.queryByText(/Enviar a la IA real/)).not.toBeInTheDocument()
    await user.type(composer, '{Enter}')
    expect(await screen.findByText(/Entiendo tu objetivo/)).toBeInTheDocument()
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })
})

describe('autorización individual de cada mensaje (con backend)', () => {
  it('el contenido incluye el mensaje y las columnas autorizadas; cada cambio invalida y el permiso es de un uso', async () => {
    const gateway = fakeGateway()
    const { user, composer } = await reachAssistant(gateway)
    await user.clear(composer)
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

  it('con AI_ENABLED=false avisa que es una prueba y termina en un estado final claro, sin borrar nada', async () => {
    const gateway = fakeGateway()
    vi.mocked(gateway.authorize).mockRejectedValue(
      new ApiError('La IA externa está deshabilitada (AI_ENABLED=false). No se envió nada.', { status: 403 }),
    )
    const { user, composer } = await reachAssistant(gateway, [ventas()])
    // Una conversación previa con el asistente DEMO.
    await user.type(composer, '{Enter}')
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
    expect(within(box).queryByText(/no habrá respuesta de IA/)).not.toBeInTheDocument()
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

  it('el rechazo 501 (conexión no implementada) también es un estado final sin envío', async () => {
    const gateway = fakeGateway()
    vi.mocked(gateway.status).mockResolvedValue({ ai_enabled: true, provider_configured: true, external_calls_implemented: false })
    vi.mocked(gateway.authorize).mockRejectedValue(new ApiError('No implementado', { status: 501 }))
    const { user } = await reachAssistant(gateway, [ventas()])
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
    await user.type(composer, '{Enter}')
    expect(await screen.findByText(/Entiendo tu objetivo/)).toBeInTheDocument()
    expect(gateway.prepare).not.toHaveBeenCalled()
    expect(gateway.authorize).not.toHaveBeenCalled()
  })
})

describe('objetivo inicial preparado como primer mensaje', () => {
  const READY = /Tu objetivo está preparado\. Enviá para comenzar la conversación\./

  it('llega precargado, con una indicación clara, y no se envía solo', async () => {
    const gateway = fakeGateway()
    const { composer } = await reachAssistant(gateway, [ventas()])
    expect(composer).toHaveValue('Comparar montos por país')
    expect(screen.getByText(READY)).toBeInTheDocument()
    // Nada se envió: ni al asistente (no hay burbuja con el objetivo) ni a la IA.
    expect(screen.queryByText('Comparar montos por país', { ignore: 'textarea' })).not.toBeInTheDocument()
    expect(gateway.prepare).not.toHaveBeenCalled()
  })

  it('se puede editar antes de enviarlo y la indicación desaparece al enviar', async () => {
    const { user, composer } = await reachAssistant(null, [ventas()])
    await user.type(composer, ' en el último año')
    expect(screen.getByText(READY)).toBeInTheDocument()
    await user.type(composer, '{Enter}')
    expect(await screen.findByText('Comparar montos por país en el último año')).toBeInTheDocument()
    expect(screen.queryByText(READY)).not.toBeInTheDocument()
  })

  it('si el usuario borra el texto, la indicación no se muestra', async () => {
    const { user, composer } = await reachAssistant(null, [ventas()])
    await user.clear(composer)
    expect(screen.queryByText(READY)).not.toBeInTheDocument()
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
