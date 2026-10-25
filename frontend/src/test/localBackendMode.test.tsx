/**
 * Ejecución local sin DEMO (VITE_DEMO_MODE=false) con IA real habilitada.
 *
 * Error corregido: en este modo la app usaba el proveedor HTTP de la API
 * completa y cargaba con `POST /api/datasets`, que el backend no implementa (404).
 * Ahora usa la sesión local + `POST /api/datasets/profile` (perfil real de Pandas).
 * `fetch` está simulado con la respuesta real del backend para el CSV sintético
 * y la frontera de IA es falsa: no hay red ni consumo.
 */
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { AppProviders } from '@/context/AppProviders'
import { routes } from '@/routes'
import { createService } from '@/services'
import type { AIGatewayClient } from '@/services/aiGateway'
import profileFixture from './fixtures/ventasSinteticasProfile.json'
import { completeReview, goToReview, startConversation } from './reviewHelpers'

const CSV = [
  'fecha,sector,ventas',
  '2026-01-05,Comercio,1200',
  '2026-01-12,Industria,3400',
  '2026-01-19,Servicios,980',
  '2026-01-26,Comercio,1500',
  '2026-02-02,Industria,2900',
  '2026-02-09,Servicios,1100',
].join('\n')

function mockBackend() {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input instanceof Request ? input.url : input)
    if (url.endsWith('/api/datasets/profile')) {
      return new Response(JSON.stringify(profileFixture), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    return new Response(JSON.stringify({ detail: 'Not Found' }), { status: 404, headers: { 'Content-Type': 'application/json' } })
  })
}

function realGateway() {
  const gateway = {
    status: vi.fn(async () => ({
      ai_enabled: true, provider_configured: true, external_calls_implemented: true, model: 'gpt-6-luna',
      budget_usd: 1, spent_usd: 0, remaining_usd: 1, requests_used: 0, max_requests: 25, max_output_tokens: 2500,
    })),
    prepare: vi.fn(async (payload) => ({
      request_id: 'local1', payload, payload_sha256: 'e'.repeat(64), expires_in_seconds: 300,
      ai_enabled: true, external_calls_implemented: true, estimated_input_tokens: 1400, estimated_max_cost_usd: 0.0014,
    })),
    authorize: vi.fn(async (): Promise<unknown> => {
      throw new Error('No debería autorizarse en esta prueba')
    }),
    cancel: vi.fn(async () => undefined),
  }
  return gateway satisfies AIGatewayClient
}

afterEach(() => vi.restoreAllMocks())

describe('servicio sin DEMO (VITE_DEMO_MODE=false)', () => {
  it('perfila con POST /api/datasets/profile y nunca usa POST /api/datasets', async () => {
    const fetchSpy = mockBackend()
    const service = createService(false, false)
    expect(service.profiling).toBe('backend')

    const dataset = await service.uploadDataset(new File([CSV], 'ventas-sinteticas.csv', { type: 'text/csv' }))
    const profile = await service.getDatasetProfile(dataset.id)
    expect(profile.origin).toBe('backend')
    expect(profile.rowCount).toBe(6)
    expect(profile.columns.map((c) => [c.name, c.semanticType])).toEqual([
      ['fecha', 'temporal'],
      ['sector', 'categorical'],
      ['ventas', 'quantitative'],
    ])

    // La sesión (proyecto y conversación) vive en el navegador: no llama a endpoints inexistentes.
    const project = await service.createProject({ name: 'Local', datasetId: dataset.id })
    await service.sendMessage(project.id, { content: 'resumen general' })
    const urls = fetchSpy.mock.calls.map(([input]) => String(input))
    expect(urls).toHaveLength(1)
    expect(urls[0]).toMatch(/\/api\/datasets\/profile$/)
    expect(urls.some((u) => /\/api\/datasets$|\/api\/projects/.test(u))).toBe(false)
  })
})

describe('recorrido local con IA real: Cargar → Revisar → Conversar', () => {
  it('carga el CSV con el perfil real, completa la revisión y prepara el contexto sin llamadas externas', async () => {
    const fetchSpy = mockBackend()
    const gateway = realGateway()
    const user = userEvent.setup()
    const router = createMemoryRouter(routes, { initialEntries: ['/analisis/cargar'] })
    render(
      <AppProviders service={createService(false, false)} aiGateway={gateway}>
        <RouterProvider router={router} />
      </AppProviders>,
    )

    // 1. Cargar: perfil real, sin 404.
    await user.upload(await screen.findByTestId('file-input'), [new File([CSV], 'ventas-sinteticas.csv', { type: 'text/csv' })])
    const list = await screen.findByRole('list', { name: 'Fuentes del análisis' })
    await waitFor(() => expect(within(list).getAllByLabelText('Archivo listo')).toHaveLength(1))
    expect(screen.queryByText(/Not Found|404/)).not.toBeInTheDocument()

    // 2. Revisar: se reconocen fecha, sector y ventas con su interpretación.
    await goToReview(user)
    const reviewed = JSON.parse(screen.getByTestId('ai-payload-preview').textContent ?? '{}')
    expect(reviewed.sources[0].columns.map((c: { name: string; semantic_type: string }) => [c.name, c.semantic_type])).toEqual([
      ['fecha', 'temporal'],
      ['sector', 'categorical'],
      ['ventas', 'quantitative'],
    ])
    await completeReview(user, 'Quiero ver cómo evolucionan las ventas por sector')
    await waitFor(() => expect(router.state.location.pathname).toBe('/analisis/asistente'))

    // 3. Conversar con la IA real: se prepara y valida el contexto; nada se autoriza ni se envía.
    await screen.findByText(/IA real · gpt-6-luna/)
    await startConversation(user)
    const panel = await screen.findByRole('region', { name: 'Autorizar envío a OpenAI' })
    await waitFor(() => expect(gateway.prepare).toHaveBeenCalledTimes(1))
    const sent = gateway.prepare.mock.calls[0][0]
    expect(sent.sources).toHaveLength(1)
    expect(sent.sources[0].columns.map((c: { name: string; semantic_type: string | null }) => [c.name, c.semantic_type])).toEqual([
      ['fecha', 'temporal'],
      ['sector', 'categorical'],
      ['ventas', 'quantitative'],
    ])
    expect(JSON.stringify(sent)).not.toMatch(/ventas-sinteticas|Comercio|Industria|1200|2026-01-05/)
    expect(await within(panel).findByText(/Costo máximo estimado:/)).toBeInTheDocument()
    expect(gateway.authorize).not.toHaveBeenCalled()

    // Solo hubo una solicitud de red de la app: el perfilado.
    const urls = fetchSpy.mock.calls.map(([input]) => String(input))
    expect(urls).toEqual([expect.stringMatching(/\/api\/datasets\/profile$/)])
  })
})
