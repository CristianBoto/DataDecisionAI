import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { AppProviders } from '@/context/AppProviders'
import { stepAccess } from '@/lib/wizardSteps'
import { routes } from '@/routes'
import type { AIGatewayClient } from '@/services/aiGateway'
import { createDemoService } from '@/services/demoProvider'
import type { DataDecisionService } from '@/services/types'
import { completeReview, goToReview } from './reviewHelpers'

const csv = (name: string, text: string) => new File([text], name, { type: 'text/csv' })
const ventas = () => csv('ventas.csv', 'pais,codigo,monto\nAR,001,10\nNA,002,20\nBR,003,NA\n')
const regiones = () => csv('regiones.csv', 'region,poblacion\nNorte,1000\nSur,2000\n')

function renderApp(service: DataDecisionService, aiGateway: AIGatewayClient | null = null, path = '/analisis/cargar') {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  render(
    <AppProviders service={service} aiGateway={aiGateway}>
      <RouterProvider router={router} />
    </AppProviders>,
  )
  return router
}

async function upload(user: ReturnType<typeof userEvent.setup>, files: File[]) {
  await user.upload(await screen.findByTestId('file-input'), files)
  const list = await screen.findByRole('list', { name: 'Fuentes del análisis' })
  await waitFor(() => expect(within(list).getAllByLabelText('Archivo listo')).toHaveLength(files.length))
}

const steps = () => within(screen.getByRole('navigation', { name: 'Pasos del análisis' }))

describe('requisitos de cada paso', () => {
  it('solo habilita los pasos cuyos requisitos están cumplidos', () => {
    const none = stepAccess({ sources: [], reviewConfirmed: false, projectId: null })
    expect([none.cargar.available, none.revisar.available, none.asistente.available, none.confirmar.available]).toEqual([true, false, false, false])

    const loaded = stepAccess({ sources: [{} as never], reviewConfirmed: false, projectId: null })
    expect([loaded.revisar.available, loaded.asistente.available]).toEqual([true, false])
    expect(loaded.asistente.reason).toMatch(/confirmá la revisión/)

    const ready = stepAccess({ sources: [{} as never], reviewConfirmed: true, projectId: 'p1' })
    expect(Object.values(ready).every((s) => s.available)).toBe(true)
  })
})

describe('navegación del encabezado', () => {
  it('muestra pasos completados, activo y bloqueados, y no enlaza los bloqueados', async () => {
    const user = userEvent.setup()
    renderApp(createDemoService({ delayMs: 0 }))
    expect(steps().getByText('Cargar datos').closest('[aria-current="step"]')).not.toBeNull()
    expect(steps().queryByRole('link', { name: /Revisar/ })).toBeNull()
    expect(steps().getByText('Revisar').closest('[aria-disabled="true"]')).not.toBeNull()

    await upload(user, [ventas()])
    expect(steps().getByRole('link', { name: 'Revisar' })).toHaveAttribute('href', '/analisis/revisar')
    expect(steps().getByText('Conversar').closest('[aria-disabled="true"]')).toHaveAttribute('title', 'Primero confirmá la revisión de datos.')
  })

  it('los pasos alcanzados se abren con el teclado', async () => {
    const user = userEvent.setup()
    const router = renderApp(createDemoService({ delayMs: 0 }))
    await upload(user, [ventas()])
    await goToReview(user)
    const back = steps().getByRole('link', { name: 'Cargar datos (completado)' })
    back.focus()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(router.state.location.pathname).toBe('/analisis/cargar'))
  })
})

describe('volver atrás conserva el estado', () => {
  it('desde el asistente se vuelve a la revisión y a la carga sin perder nada', async () => {
    const user = userEvent.setup()
    const service = createDemoService({ delayMs: 0 })
    const createProject = vi.spyOn(service, 'createProject')
    const router = renderApp(service)
    await upload(user, [ventas(), regiones()])
    await goToReview(user)
    await user.selectOptions(screen.getByLabelText('Significado de codigo (fuente A)'), 'identifier')
    await user.click(screen.getByRole('checkbox', { name: 'Compartir la columna monto de la fuente A' }))
    await completeReview(user, 'Comparar regiones')
    await waitFor(() => expect(router.state.location.pathname).toBe('/analisis/asistente'))

    // Enviar el objetivo precargado (el editor se habilita al cargar la conversación).
    const composer = await screen.findByRole('textbox', { name: /Mensaje/i })
    await waitFor(() => expect(composer).toBeEnabled())
    await user.type(composer, '{Enter}')
    expect(await screen.findByText(/Entiendo tu objetivo/)).toBeInTheDocument()

    // "Modificar configuración de datos": las decisiones siguen ahí.
    await user.click(await screen.findByRole('link', { name: /Modificar configuración de datos/ }))
    await screen.findByRole('heading', { name: /Revisá tus datos y la privacidad/ })
    expect(screen.getByLabelText('Significado de codigo (fuente A)')).toHaveValue('identifier')
    expect(screen.getByRole('checkbox', { name: 'Compartir la columna monto de la fuente A' })).not.toBeChecked()
    expect(screen.getByLabelText('¿Qué necesitás analizar?')).toHaveValue('Comparar regiones')
    expect(screen.getByText('Esta revisión ya está confirmada')).toBeInTheDocument()

    // "Volver a cargar datos": las fuentes siguen cargadas.
    await user.click(screen.getByRole('link', { name: /Volver a cargar datos/ }))
    const list = await screen.findByRole('list', { name: 'Fuentes del análisis' })
    expect(within(list).getAllByLabelText('Archivo listo')).toHaveLength(2)

    // Avanzar otra vez sin cambios: misma conversación, sin crear otro proyecto.
    await goToReview(user)
    expect(screen.getByLabelText('Significado de codigo (fuente A)')).toHaveValue('identifier')
    await user.click(screen.getByRole('button', { name: 'Continuar con el asistente' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/analisis/asistente'))
    expect(await screen.findByText(/Entiendo tu objetivo/)).toBeInTheDocument()
    expect(createProject).toHaveBeenCalledTimes(1)
  })
})

describe('invalidación y bloqueo hacia adelante', () => {
  it('modificar una revisión confirmada exige confirmarla otra vez, también escribiendo la URL', async () => {
    const user = userEvent.setup()
    const service = createDemoService({ delayMs: 0 })
    const createProject = vi.spyOn(service, 'createProject')
    const router = renderApp(service)
    await upload(user, [ventas()])
    await goToReview(user)
    await completeReview(user)
    await waitFor(() => expect(router.state.location.pathname).toBe('/analisis/asistente'))

    await user.click(await screen.findByRole('link', { name: /Modificar configuración de datos/ }))
    await user.selectOptions(await screen.findByLabelText('Formato de monto (fuente A)'), 'decimal')
    expect(screen.queryByText('Esta revisión ya está confirmada')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Confirmar revisión y continuar/ })).toBeInTheDocument()
    expect(steps().queryByRole('link', { name: 'Conversar' })).toBeNull()

    for (const path of ['/analisis/asistente', '/analisis/confirmar']) {
      await act(() => router.navigate(path))
      expect(await screen.findByText('Primero revisá tus datos')).toBeInTheDocument()
    }

    await act(() => router.navigate('/analisis/revisar'))
    await user.click(await screen.findByRole('button', { name: /Confirmar revisión y continuar/ }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/analisis/asistente'))
    expect(createProject).toHaveBeenCalledTimes(2)
  })

  it('sin datos no se puede entrar por URL a revisar, conversar ni confirmar', async () => {
    const router = renderApp(createDemoService({ delayMs: 0 }), null, '/analisis/revisar')
    expect(await screen.findByText('Primero cargá tus datos')).toBeInTheDocument()
    await act(() => router.navigate('/analisis/asistente'))
    expect(await screen.findByText('Primero cargá un dataset')).toBeInTheDocument()
    await act(() => router.navigate('/analisis/confirmar'))
    expect(await screen.findByText('No hay un análisis en curso')).toBeInTheDocument()
  })
})

describe('volver atrás no crea ni reutiliza autorizaciones', () => {
  it('salir de la revisión cancela la solicitud preparada y no autoriza nada', async () => {
    const user = userEvent.setup()
    const gateway: AIGatewayClient = {
      status: async () => ({ ai_enabled: false, provider_configured: false, external_calls_implemented: false }),
      prepare: vi.fn(async (payload) => ({
        request_id: 'req-nav', payload, payload_sha256: 'd'.repeat(64), expires_in_seconds: 300, ai_enabled: false, external_calls_implemented: false,
      })),
      authorize: vi.fn(),
      cancel: vi.fn(async () => undefined),
    }
    renderApp(createDemoService({ delayMs: 0 }), gateway)
    await upload(user, [ventas()])
    await goToReview(user)
    await user.type(screen.getByLabelText('¿Qué necesitás analizar?'), 'Ver montos')
    await user.click(screen.getByRole('button', { name: 'Validar contenido' }))
    expect(await screen.findByRole('button', { name: 'Autorizar este envío' })).toBeInTheDocument()

    await user.click(screen.getByRole('link', { name: /Volver a cargar datos/ }))
    await waitFor(() => expect(gateway.cancel).toHaveBeenCalledWith('req-nav'))

    await goToReview(user)
    expect(screen.queryByRole('button', { name: 'Autorizar este envío' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Validar contenido' })).toBeInTheDocument()
    expect(gateway.authorize).not.toHaveBeenCalled()
  })
})
