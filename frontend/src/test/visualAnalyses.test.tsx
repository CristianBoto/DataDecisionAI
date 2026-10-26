/**
 * Histograma, dispersión y curva ROC en el dashboard (Fase 4B.2).
 *
 * `fixtures/visualResponse.json` es la respuesta REAL de `analysis_engine.py`:
 * fuente A (publicidad y ventas: histograma y dispersión) y fuente B (etiquetas y
 * puntuaciones de un clasificador: ROC con AUC 0,75 calculado a mano). La IA y el
 * motor se simulan solo en las pruebas; no hay red ni OpenAI.
 */
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { AnalysisResults } from '@/components/analysis/AnalysisResults'
import { AppProviders } from '@/context/AppProviders'
import { buildDashboard } from '@/lib/dashboard'
import { routes } from '@/routes'
import type { AIGatewayClient } from '@/services/aiGateway'
import type { AnalysisEngineClient, ExecutionResponse } from '@/services/analysisEngine'
import { createDemoService } from '@/services/demoProvider'
import visualFixture from './fixtures/visualResponse.json'
import { completeReview, goToReview, startConversation } from './reviewHelpers'

const run = visualFixture as ExecutionResponse

describe('dashboard: histograma, dispersión y ROC desde el motor', () => {
  const [a, b] = buildDashboard(run)
  const planA = a.plans[0]
  const planB = b.plans[0]

  it('histograma: intervalos y frecuencias exactamente como los calculó NumPy', () => {
    const chart = planA.charts.find((c) => c.type === 'histogram')!
    expect(chart.data).toEqual([
      { x: '[10, 15)', s0: 3 }, { x: '[15, 20)', s0: 1 }, { x: '[20, 25)', s0: 3 }, { x: '[25, 30]', s0: 1 },
    ])
    expect(chart.data.reduce((acc, r) => acc + (r.s0 as number), 0)).toBe(8)
  })

  it('dispersión: un punto por par (x, y), con unidades e indicadores de correlación', () => {
    const chart = planA.charts.find((c) => c.type === 'scatter')!
    expect(chart.title).toBe('Relación entre publicidad y ventas') // título pedido por el plan
    expect(chart.data).toHaveLength(8)
    expect(chart.data[0]).toEqual({ x: 1, y: 10 })
    expect(chart.xLabel).toBe('publicidad (miles ARS)')
    expect(chart.yLabel).toBe('ventas (unidades)')
    expect(chart.description).toMatch(/r de Pearson = 0\.947 · correlación no implica causalidad/)
    expect(planA.kpis.map((k) => [k.label, k.value])).toEqual([
      ['Correlación de Pearson (r)', 0.947487],
      ['Correlación de Spearman (ρ)', 0.952381],
      ['Pares de valores', 8],
    ])
  })

  it('un gráfico pedido incompatible con el histograma se explica y no se fabrica', () => {
    expect(planA.charts.some((c) => c.type === 'line')).toBe(false)
    expect(planA.notices).toEqual([expect.stringMatching(/líneas.*se representa como histograma/)])
  })

  it('ROC: curva de scikit-learn, AUC y clase positiva, solo en la fuente B', () => {
    const chart = planB.charts[0]
    expect(chart.type).toBe('roc')
    expect(chart.data).toEqual([
      { x: 0, tpr: 0 }, { x: 0, tpr: 0.5 }, { x: 0.5, tpr: 0.5 }, { x: 0.5, tpr: 1 }, { x: 1, tpr: 1 },
    ])
    expect(chart.description).toMatch(/Clase positiva: «si» · AUC = 0\.750 · diagonal = azar/)
    expect(planB.kpis.map((k) => [k.label, k.value])).toEqual([
      ['AUC (área bajo la curva ROC)', 0.75], ['Casos positivos', 2], ['Casos negativos', 2],
    ])
    // Independencia: A no tiene ROC y B no tiene histograma ni dispersión.
    expect(planA.charts.some((c) => c.type === 'roc')).toBe(false)
    expect(planB.charts.map((c) => c.type)).toEqual(['roc'])
  })

  it('en pantalla: indicadores, avisos, tablas y sin solicitudes de red', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const user = userEvent.setup()
    render(<AnalysisResults run={run} fileNames={{ A: 'ventas.csv', B: 'modelo.csv' }} />)
    const sourceA = screen.getByRole('region', { name: 'Fuente A' })
    const sourceB = screen.getByRole('region', { name: 'Fuente B' })
    expect(within(sourceA).getByRole('group', { name: 'Indicador: Correlación de Pearson (r)' })).toHaveTextContent('0,95')
    expect(within(sourceB).getByRole('group', { name: 'Indicador: AUC (área bajo la curva ROC)' })).toHaveTextContent('0,75')
    expect(within(sourceA).getByRole('group', { name: 'Resultado: Histograma · Distribución de ventas' })).toHaveTextContent(
      '4 intervalos de igual ancho (regla de Sturges)',
    )
    expect(sourceA).toHaveTextContent('no implica causalidad')
    expect(sourceB).toHaveTextContent('DataDecision AI no entrenó ningún modelo')
    expect(sourceB).not.toHaveTextContent('publicidad')

    // Valores exactos de la curva ROC en la vista de tabla del gráfico.
    const roc = within(sourceB).getByRole('group', { name: 'Vista de Curva ROC' })
    await user.click(within(roc).getByRole('button', { name: 'Tabla' }))
    const card = roc.closest('div.flex.flex-col') as HTMLElement
    expect(card).toHaveTextContent('Tasa de falsos positivos')
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })
})

describe('clase positiva de la curva ROC (recorrido completo, IA y motor simulados en la prueba)', () => {
  const CSV = 'real,score\nno,0.1\nno,0.4\nsi,0.35\nsi,0.8\n'

  function gateway() {
    return {
      status: vi.fn(async () => ({
        ai_enabled: true, provider_configured: true, external_calls_implemented: true, model: 'gpt-6-luna',
        budget_usd: 1, spent_usd: 0, remaining_usd: 1, requests_used: 0, max_requests: 25, max_output_tokens: 2500,
      })),
      prepare: vi.fn(async (payload) => ({
        request_id: 'r1', payload, payload_sha256: '1'.repeat(64), expires_in_seconds: 300,
        ai_enabled: true, external_calls_implemented: true, estimated_input_tokens: 1500, estimated_max_cost_usd: 0.0015,
      })),
      authorize: vi.fn(async (): Promise<unknown> => ({
        reply: {
          message: 'Propongo la curva ROC de tu modelo.', interpreted_objective: 'Evaluar el clasificador', source_relationship: 'single',
          questions: [], warnings: [],
          plans: [{
            source_alias: 'A', title: 'Desempeño del clasificador', rationale: 'Compara puntuaciones con etiquetas reales.',
            columns_needed: ['real', 'score'],
            operations: [{ operation: 'roc_curve', columns: ['real', 'score'], group_by: [], description: 'Curva ROC del modelo' }],
            charts: [{ type: 'roc', x: 'score', y: 'real', title: 'Curva ROC' }], limitations: [],
          }],
        },
        plan_ids: ['plan-roc'],
        usage: { model: 'gpt-6-luna', input_tokens: 1400, output_tokens: 400, cost_usd: 0.0003, remaining_usd: 0.9997 },
      })),
      cancel: vi.fn(async () => undefined),
      approvePlan: vi.fn(async (planId: string) => ({ plan_id: planId, status: 'approved', executed: false })),
    } satisfies AIGatewayClient
  }

  it('pide elegir la clase positiva entre las dos clases reales y la envía solo al motor', async () => {
    const ai = gateway()
    const engine = { execute: vi.fn(async () => run) } satisfies AnalysisEngineClient
    const user = userEvent.setup()
    const router = createMemoryRouter(routes, { initialEntries: ['/analisis/cargar'] })
    render(
      <AppProviders service={createDemoService({ delayMs: 0 })} aiGateway={ai} analysisEngine={engine}>
        <RouterProvider router={router} />
      </AppProviders>,
    )
    await user.upload(await screen.findByTestId('file-input'), [new File([CSV], 'modelo.csv', { type: 'text/csv' })])
    await waitFor(() => expect(screen.getAllByLabelText('Archivo listo')).toHaveLength(1))
    await goToReview(user)
    await user.selectOptions(screen.getByLabelText('Significado de real (fuente A)'), 'categorical')
    await user.selectOptions(screen.getByLabelText('Significado de score (fuente A)'), 'quantitative')
    await completeReview(user, 'Evaluar el clasificador')
    await screen.findByText(/IA real · gpt-6-luna/)
    await startConversation(user)
    // La clase positiva es un valor del dataset: no viaja a la IA.
    await waitFor(() => expect(ai.prepare).toHaveBeenCalled())
    expect(JSON.stringify(ai.prepare.mock.calls[0][0])).not.toMatch(/"si"|"no"|0\.35/)
    const panel = await screen.findByRole('region', { name: 'Autorizar envío a OpenAI' })
    await user.click(await within(panel).findByRole('button', { name: 'Autorizar solo este mensaje' }))
    const plan = await screen.findByRole('region', { name: 'Plan propuesto: Desempeño del clasificador' })
    await user.click(within(plan).getByRole('button', { name: 'Aprobar este plan' }))
    await user.click(await screen.findByRole('button', { name: /Continuar a Confirmar/ }))
    await user.click(await screen.findByRole('checkbox', { name: /Revisé los planes aprobados/ }))
    await user.click(screen.getByRole('button', { name: 'Confirmar propuesta' }))

    // Sin clase positiva no se puede ejecutar.
    const select = screen.getByLabelText('Clase positiva de real (fuente A)')
    expect([...(select as HTMLSelectElement).options].map((o) => o.value)).toEqual(['', 'no', 'si'])
    expect(screen.getByText(/Elegí la clase positiva de «real» \(fuente A\)/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ejecutar análisis' })).toBeDisabled()

    await user.selectOptions(select, 'si')
    await user.click(screen.getByRole('button', { name: 'Ejecutar análisis' }))
    await waitFor(() => expect(engine.execute).toHaveBeenCalledTimes(1))
    const [request] = engine.execute.mock.calls[0] as unknown as Parameters<AnalysisEngineClient['execute']>
    expect(request.sources[0].columns.find((c) => c.name === 'real')?.positive_label).toBe('si')
    expect(request.sources[0].columns.find((c) => c.name === 'score')?.positive_label).toBeNull()
    expect(await screen.findByRole('group', { name: 'Indicador: AUC (área bajo la curva ROC)' })).toHaveTextContent('0,75')
    expect(ai.authorize).toHaveBeenCalledTimes(1) // ejecutar no vuelve a consultar a la IA
  }, 15_000)
})
