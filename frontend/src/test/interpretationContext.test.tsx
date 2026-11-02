/**
 * Fase 5.1 — contexto compacto para interpretar con la IA: lo que muestra el panel de autorización
 * y la interpretación por partes (selección de planes). Frontera de IA falsa: sin red ni OpenAI.
 */
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ReportSection } from '@/components/report/ReportSection'
import { AppProviders } from '@/context/AppProviders'
import { summarizeInterpretationPayload } from '@/lib/interpretationSummary'
import type { AIGatewayClient } from '@/services/aiGateway'
import type { ExecutionResponse } from '@/services/analysisEngine'
import { createDemoService } from '@/services/demoProvider'
import salesFixture from './fixtures/salesReportResponse.json'

/** Contenido compacto (versión 2) como lo prepara el backend. */
const COMPACT = {
  version: 2,
  objective: 'Decidir dónde reforzar las ventas.',
  sources: [{ alias: 'A', rows: 72, columns: 4 }],
  coverage: { operations: 4, full: 2, summarized: 1, facts_only: 1, note: 'Resumen parcial: 1 operaciones van con filas representativas y 1 solo con sus hechos principales.' },
  plans: [
    {
      ref: 'P1', title: 'Ventas', source_alias: 'A',
      operations: [
        { ref: 'P1.O1', operation: 'compare_groups', description: 'Por canal', status: 'ok', detail: 'full', dimensions: ['canal'],
          measures: [{ column: 'monto_ars', aggregate: 'sum', unit: 'ARS' }], rows: [['Local', 54840], ['Online', 14220]], rows_total: 2 },
        { ref: 'P1.O2', operation: 'time_series', description: 'Por mes y producto', status: 'ok', detail: 'summary', dimensions: ['fecha', 'producto'],
          rows: [['2025-01', 'Producto 001', 10], ['2025-06', 'Producto 001', 12]], rows_total: 500, omitted: 'Se enviaron 2 de 500 filas…', facts: ['f1'],
          repeated: { 'monto_ars (sum, ARS)': 'P1.O1' } },
        { ref: 'P1.O3', operation: 'pareto', description: 'Ranking', status: 'ok', detail: 'facts', rows_total: 120, facts: ['f2', 'f3'] },
        { ref: 'P1.O4', operation: 'compare_groups', description: 'Por canal (repetida)', status: 'ok', detail: 'full', same_as: 'P1.O1' },
      ],
    },
  ],
}

describe('resumen del contenido compacto', () => {
  it('describe lo que viaja de cada operación, la cobertura parcial y los valores (filas como arreglos)', () => {
    const summary = summarizeInterpretationPayload(COMPACT)
    expect(summary.objective).toBe('Decidir dónde reforzar las ventas.')
    expect(summary.partial).toMatch(/^Resumen parcial/)
    const sent = Object.fromEntries(summary.sent.map((s) => [s.ref, s]))
    expect(sent['P1.O1'].content).toBe('2 filas de resultados agregados, con sus cifras')
    expect(sent['P1.O1'].values).toEqual([{ dimension: 'canal', values: ['Local', 'Online'] }])
    expect(sent['P1.O2'].content).toMatch(/2 filas de resultados agregados \(de 500: filas representativas\).*una medida va como referencia a otra operación/)
    expect(sent['P1.O2'].values.map((v) => v.dimension)).toEqual(['fecha', 'producto'])
    expect(sent['P1.O3'].content).toBe('solo sus hechos principales (no sus 120 filas), por el límite de tamaño')
    expect(sent['P1.O4'].content).toBe('es igual a P1.O1: no se repite')
    expect(summary.facts).toBe(3)
  })

  it('sin reducciones no hay aviso de resumen parcial', () => {
    const full = { ...COMPACT, coverage: { operations: 1, full: 1, summarized: 0, facts_only: 0, note: 'Contexto completo.' } }
    expect(summarizeInterpretationPayload(full).partial).toBeNull()
  })
})

function gateway() {
  return {
    status: vi.fn(async () => ({
      ai_enabled: true, provider_configured: true, external_calls_implemented: true, model: 'gpt-6-luna',
      budget_usd: 0.1, spent_usd: 0, remaining_usd: 0.1, requests_used: 0, max_requests: 15,
    })),
    prepare: vi.fn(),
    authorize: vi.fn(),
    cancel: vi.fn(async () => undefined),
    prepareInterpretation: vi.fn(async (executionId: string, plans?: number[]) => ({
      request_id: 'int-1',
      payload: { ...COMPACT, execution: executionId, plans: plans ? COMPACT.plans : COMPACT.plans },
      payload_sha256: 'a'.repeat(64),
      expires_in_seconds: 300, ai_enabled: true, external_calls_implemented: true,
      estimated_input_tokens: 5200, estimated_max_cost_usd: 0.002,
    })),
    authorizeInterpretation: vi.fn(),
    cancelInterpretation: vi.fn(async () => undefined),
  } satisfies AIGatewayClient
}

describe('interpretar por partes', () => {
  it('con varios planes, se eligen los planes y preparar no envía nada', async () => {
    const run = structuredClone(salesFixture) as unknown as ExecutionResponse
    run.results = [run.results[0], { ...run.results[0], plan_id: 'p2', title: 'Segundo plan' }]
    const ai = gateway()
    render(
      <AppProviders service={createDemoService({ delayMs: 0 })} aiGateway={ai} analysisEngine={null}>
        <ReportSection run={run} fileNames={{ A: 'ventas.csv' }} />
      </AppProviders>,
    )
    const user = userEvent.setup()
    const plans = await screen.findByRole('group', { name: 'Planes a interpretar' })
    expect(within(plans).getAllByRole('checkbox').every((c) => (c as HTMLInputElement).checked)).toBe(true)
    await user.click(within(plans).getByRole('checkbox', { name: /P2 · Segundo plan/ }))
    await user.click(screen.getByRole('button', { name: 'Interpretar resultados con IA' }))
    await waitFor(() => expect(ai.prepareInterpretation).toHaveBeenCalledWith('exec-ventas-1', [1]))
    // El panel avisa que la IA recibirá un resumen parcial, antes de autorizar.
    const panel = await screen.findByRole('region', { name: 'Autorizar interpretación con IA' })
    expect(within(panel).getByRole('note', { name: 'Resumen parcial' })).toHaveTextContent('La IA recibirá un resumen parcial.')
    expect(ai.authorizeInterpretation).not.toHaveBeenCalled()

    // Sin ningún plan elegido no se puede preparar.
    await user.click(within(panel).getByRole('button', { name: 'Cancelar' }))
    const again = await screen.findByRole('group', { name: 'Planes a interpretar' })
    await user.click(within(again).getByRole('checkbox', { name: /P1 · / }))
    expect(screen.getByRole('button', { name: 'Interpretar resultados con IA' })).toBeDisabled()
  })
})
