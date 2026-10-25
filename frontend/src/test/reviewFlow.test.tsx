import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { AppProviders } from '@/context/AppProviders'
import { routes } from '@/routes'
import type { AIGatewayClient } from '@/services/aiGateway'
import { createDemoService } from '@/services/demoProvider'
import type { DataDecisionService } from '@/services/types'
import { completeReview, goToReview } from './reviewHelpers'

const csv = (name: string, text: string) => new File([text], name, { type: 'text/csv' })
const ventas = () => csv('ventas.csv', 'pais,codigo,monto\nAR,001,10\nNA,002,20\nBR,003,NA\n')
const regiones = () => csv('regiones.csv', 'region,poblacion\nNorte,1000\nSur,2000\n')
const notas = () => csv('notas.csv', 'curso,nota\n1A,8\n1B,6\n')

function renderApp(service: DataDecisionService, aiGateway: AIGatewayClient | null = null, path = '/analisis/cargar') {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  render(
    <AppProviders service={service} aiGateway={aiGateway}>
      <RouterProvider router={router} />
    </AppProviders>,
  )
  return router
}

// Las navegaciones de React Router son transiciones: act() espera a que se rendericen.
async function upload(user: ReturnType<typeof userEvent.setup>, files: File[]) {
  await user.upload(await screen.findByTestId('file-input'), files)
  const list = await screen.findByRole('list', { name: 'Fuentes del análisis' })
  await waitFor(() => expect(within(list).getAllByLabelText('Archivo listo')).toHaveLength(files.length))
}

const preview = () => JSON.parse(screen.getAllByTestId('ai-payload-preview').at(-1)!.textContent ?? '{}')

describe('revisión obligatoria antes de conversar', () => {
  it('no se llega al asistente sin cargar datos ni sin confirmar la revisión', async () => {
    const user = userEvent.setup()
    const router = renderApp(createDemoService({ delayMs: 0 }), null, '/analisis/revisar')
    expect(screen.getByText('Primero cargá tus datos')).toBeInTheDocument()

    await act(() => router.navigate('/analisis/cargar'))
    await upload(user, [ventas()])
    await act(() => router.navigate('/analisis/asistente'))
    expect(await screen.findByText('Primero revisá tus datos')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Ir a la revisión/ })).toHaveAttribute('href', '/analisis/revisar')
  })

  it('exige el objetivo y no crea el proyecto hasta confirmar', async () => {
    const user = userEvent.setup()
    const service = createDemoService({ delayMs: 0 })
    const createProject = vi.spyOn(service, 'createProject')
    const router = renderApp(service)
    await upload(user, [ventas()])
    await goToReview(user)

    await user.click(screen.getByRole('button', { name: /Confirmar revisión y continuar/ }))
    expect(screen.getByText('Falta completar la revisión')).toBeInTheDocument()
    expect(createProject).not.toHaveBeenCalled()
    expect(router.state.location.pathname).toBe('/analisis/revisar')
  })

  it('conserva las correcciones como decisiones del análisis y no modifica los datos originales', async () => {
    const user = userEvent.setup()
    const service = createDemoService({ delayMs: 0 })
    const router = renderApp(service)
    await upload(user, [ventas()])
    await goToReview(user)

    // Corregir solo lo necesario.
    await user.selectOptions(screen.getByLabelText('Formato de codigo (fuente A)'), 'text')
    await user.selectOptions(screen.getByLabelText('Significado de codigo (fuente A)'), 'identifier')
    await user.selectOptions(screen.getByLabelText('Marcadores de ausencia de pais (fuente A)'), 'valid_value')
    expect(screen.getByTestId('review-summary')).toHaveTextContent('1 columna corregida')

    const codigo = preview().sources[0].columns.find((c: { name: string }) => c.name === 'codigo')
    expect(codigo).toMatchObject({ format: 'text', semantic_type: 'identifier', user_corrected: true })
    expect(preview().sources[0].columns.find((c: { name: string }) => c.name === 'pais').missing_markers).toBe('valid_value')

    await completeReview(user, 'Comparar montos por país')
    await waitFor(() => expect(router.state.location.pathname).toBe('/analisis/asistente'))

    // El objetivo llega a la conversación como resumen, sin enviarse solo ni copiarse en el chat.
    expect(await screen.findByRole('region', { name: 'Objetivo confirmado' })).toHaveTextContent('Comparar montos por país')
    expect(screen.getByRole('textbox', { name: /Mensaje/i })).toHaveValue('')

    // Las decisiones se conservan: al volver a la configuración siguen aplicadas.
    await user.click(screen.getByRole('link', { name: /Modificar configuración de datos/ }))
    await screen.findByRole('heading', { name: /Revisá tus datos y la privacidad/ })
    const again = preview().sources[0].columns.find((c: { name: string }) => c.name === 'codigo')
    expect(again).toMatchObject({ format: 'text', semantic_type: 'identifier', user_corrected: true })
  })

  it('elegir y renombrar columnas actualiza el contexto que se validaría', async () => {
    const user = userEvent.setup()
    const prepare = vi.fn(async (payload) => ({
      request_id: 'r1', payload, payload_sha256: 'c'.repeat(64), expires_in_seconds: 300, ai_enabled: false, external_calls_implemented: false,
    }))
    const gateway: AIGatewayClient = {
      status: async () => ({ ai_enabled: false, provider_configured: false, external_calls_implemented: false }),
      prepare,
      authorize: vi.fn(),
      cancel: vi.fn(async () => undefined),
    }
    renderApp(createDemoService({ delayMs: 0 }), gateway)
    await upload(user, [ventas()])
    await goToReview(user)
    await user.type(screen.getByLabelText('¿Qué necesitás analizar?'), 'Ver montos')

    await user.click(screen.getByRole('checkbox', { name: 'Compartir la columna codigo de la fuente A' }))
    const nameInput = screen.getByRole('textbox', { name: 'Nombre a compartir para monto' })
    await user.clear(nameInput)
    await user.type(nameInput, 'importe')
    expect(preview().sources[0].columns.map((c: { name: string }) => c.name)).toEqual(['pais', 'importe'])

    // La revisión (acción A) no valida ni autoriza envíos: eso ocurre mensaje por mensaje en el asistente.
    expect(screen.queryByRole('button', { name: 'Validar contenido' })).not.toBeInTheDocument()
    expect(screen.getByText(/Cada envío a la IA se autoriza por separado en el asistente/)).toBeInTheDocument()
    expect(JSON.stringify(preview())).not.toMatch(/codigo|ventas\.csv|001/)
    expect(prepare).not.toHaveBeenCalled()
  })

  it('cambiar la revisión después de confirmarla obliga a confirmarla de nuevo', async () => {
    const user = userEvent.setup()
    const router = renderApp(createDemoService({ delayMs: 0 }))
    await upload(user, [ventas()])
    await goToReview(user)
    await completeReview(user)
    await waitFor(() => expect(router.state.location.pathname).toBe('/analisis/asistente'))

    await act(() => router.navigate('/analisis/revisar'))
    await user.selectOptions(await screen.findByLabelText('Significado de monto (fuente A)'), 'categorical')
    await act(() => router.navigate('/analisis/asistente'))
    expect(await screen.findByText('Primero revisá tus datos')).toBeInTheDocument()
  })

  it.each([1, 2, 3])('funciona con %i fuentes y la demo pública no hace solicitudes', async (count) => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const user = userEvent.setup()
    const service = createDemoService({ delayMs: 0 })
    const createProject = vi.spyOn(service, 'createProject')
    const router = renderApp(service, null)
    await upload(user, [ventas(), regiones(), notas()].slice(0, count))
    await goToReview(user)

    for (const alias of ['A', 'B', 'C'].slice(0, count)) {
      expect(screen.getByRole('heading', { name: new RegExp(`^Fuente ${alias} ·`) })).toBeInTheDocument()
    }
    expect(screen.getByText('Demo pública: sin conexión')).toBeInTheDocument()
    expect(preview().sources).toHaveLength(count)

    await completeReview(user)
    await waitFor(() => expect(router.state.location.pathname).toBe('/analisis/asistente'))
    expect(createProject.mock.calls[0][0].datasetIds).toHaveLength(count)
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })
})

describe('los archivos originales no se modifican', () => {
  it('los perfiles quedan idénticos después de revisar y corregir', async () => {
    const user = userEvent.setup()
    const service = createDemoService({ delayMs: 0 })
    const upload = vi.spyOn(service, 'uploadDataset')
    renderApp(service)
    await user.upload(screen.getByTestId('file-input'), ventas())
    await screen.findByLabelText('Archivo listo')
    const dataset = await upload.mock.results[0].value
    const before = JSON.stringify(await service.getDatasetProfile(dataset.id))

    await goToReview(user)
    await user.selectOptions(screen.getByLabelText('Formato de codigo (fuente A)'), 'integer')
    await user.selectOptions(screen.getByLabelText('Marcadores de ausencia de monto (fuente A)'), 'treat_as_missing')
    await completeReview(user)

    const after = await service.getDatasetProfile(dataset.id)
    expect(JSON.stringify(after)).toBe(before)
    expect(after.previewRows.map((r) => r.codigo)).toEqual(['001', '002', '003'])
    expect(after.previewRows[2].monto).toBe('NA')
  })
})
