/**
 * Modo real (hay backend): ningún contenido ficticio.
 * - Cargar no ofrece el dataset de ejemplo.
 * - Confirmar nunca muestra la propuesta del asistente DEMO.
 * - El contexto para la IA agrega solo un rango aproximado de valores distintos.
 * La demo pública (sin backend) conserva su comportamiento, claramente identificado.
 */
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { act } from 'react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { AppProviders } from '@/context/AppProviders'
import { distinctRange } from '@/lib/aiContext'
import { routes } from '@/routes'
import { createService } from '@/services'
import type { AIGatewayClient } from '@/services/aiGateway'
import { createDemoService } from '@/services/demoProvider'
import { completeReview, goToReview } from './reviewHelpers'

const readyGateway = () =>
  ({
    status: vi.fn(async () => ({
      ai_enabled: true, provider_configured: true, external_calls_implemented: true, model: 'gpt-6-luna',
      budget_usd: 1, spent_usd: 0, remaining_usd: 1, requests_used: 0, max_requests: 25, max_output_tokens: 2500,
    })),
    prepare: vi.fn(),
    authorize: vi.fn(),
    cancel: vi.fn(async () => undefined),
  }) satisfies AIGatewayClient

function renderApp(path: string, aiGateway: AIGatewayClient | null, service = createDemoService({ delayMs: 0 })) {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  render(
    <AppProviders service={service} aiGateway={aiGateway}>
      <RouterProvider router={router} />
    </AppProviders>,
  )
  return router
}

afterEach(() => vi.restoreAllMocks())

describe('sin datos ficticios en modo real', () => {
  it('con backend, «Cargar» no ofrece el dataset de ejemplo', async () => {
    renderApp('/analisis/cargar', readyGateway(), createService(false, false))
    await screen.findByTestId('file-input')
    expect(screen.queryByRole('button', { name: 'Usar dataset de ejemplo' })).not.toBeInTheDocument()
    expect(screen.getByText(/El asistente usa OpenAI y los cálculos se hacen con Pandas/)).toBeInTheDocument()
  })

  it('en la demo pública, el dataset de ejemplo sigue disponible e identificado', async () => {
    renderApp('/analisis/cargar', null)
    expect(await screen.findByRole('button', { name: 'Usar dataset de ejemplo' })).toBeInTheDocument()
    expect(screen.getByText(/Demo pública:/)).toBeInTheDocument()
  })

  it('con backend, «Confirmar» no muestra la propuesta del asistente DEMO aunque el servicio la tenga', async () => {
    const service = createDemoService({ delayMs: 0 })
    const proposalSpy = vi.spyOn(service, 'getCurrentProposal')
    const user = userEvent.setup()
    const router = renderApp('/analisis/cargar', readyGateway(), service)
    await user.upload(await screen.findByTestId('file-input'), [new File(['pais,monto\nAR,10\nUY,20\n'], 'ventas.csv', { type: 'text/csv' })])
    await waitFor(() => expect(screen.getAllByLabelText('Archivo listo')).toHaveLength(1))
    await goToReview(user)
    await completeReview(user, 'Montos por país')
    await waitFor(() => expect(router.state.location.pathname).toBe('/analisis/asistente'))
    await act(() => router.navigate('/analisis/confirmar'))
    expect(await screen.findByText('Todavía no aprobaste ningún plan')).toBeInTheDocument()
    expect(screen.queryByText(/Propuesta simulada/)).not.toBeInTheDocument()
    expect(proposalSpy).not.toHaveBeenCalled()
  })

  it('la franja superior distingue la ejecución con backend de la demo pública', async () => {
    renderApp('/analisis/cargar', readyGateway(), createService(false, false))
    const banner = await screen.findByRole('note')
    expect(within(banner).getByText(/Ejecución con backend:/)).toBeInTheDocument()
    expect(banner).toHaveTextContent('sin respuestas ni resultados simulados')
  })
})

describe('metadato aproximado para la IA', () => {
  it.each([
    [null, null], [0, null], [1, '1'], [2, '2'], [7, '3-10'], [10, '3-10'], [11, '11-50'], [50, '11-50'],
    [51, '51-500'], [500, '51-500'], [501, '>500'], [102254, '>500'],
  ])('%s valores distintos → %s', (count, range) => {
    expect(distinctRange(count)).toBe(range)
  })
})
