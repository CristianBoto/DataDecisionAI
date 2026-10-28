/**
 * Fase 4C — Informe de análisis e interpretación.
 * La respuesta del motor es la del backend REAL para el dataset sintético de ventas (72 filas,
 * total 69.060 ARS) con una operación fallida: fixtures/salesReportResponse.json. La frontera
 * de IA es falsa: no hay red, ni OpenAI, ni consumo.
 */
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ReportSection } from '@/components/report/ReportSection'
import { AppProviders } from '@/context/AppProviders'
import { buildReport } from '@/lib/report'
import { createReportPdf, pdfText, reportFileName } from '@/lib/reportPdf'
import type { AIGatewayClient, AIInterpretationResult } from '@/services/aiGateway'
import type { ExecutionResponse } from '@/services/analysisEngine'
import { createDemoService } from '@/services/demoProvider'
import salesFixture from './fixtures/salesReportResponse.json'

const downloadSpy = vi.hoisted(() => vi.fn(async () => ({ missingCharts: 0 })))
vi.mock('@/lib/reportPdf', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/reportPdf')>()),
  downloadReportPdf: downloadSpy,
}))

const run = salesFixture as unknown as ExecutionResponse
const FILES = { A: 'datos-sinteticos-de-prueba-ventas.csv' }

const INTERPRETATION: AIInterpretationResult = {
  interpretation: {
    executive_summary: [
      {
        text: 'Las ventas suman 69.060 ARS.',
        evidence: ['P1.O1'],
        status: 'verified',
        claims: [{ ref: 'P1.O1', measure: 'monto_ars', kind: 'value', keys: [], period_from: null, period_to: null, value: 69060, unit: 'ARS' }],
      },
    ],
    findings: [
      {
        text: 'El canal Local concentra el 79,41 % del total.',
        evidence: ['P1.O3'],
        status: 'verified',
        claims: [{ ref: 'P1.O3', measure: 'monto_ars', kind: 'share_pct', keys: [{ dimension: 'canal', value: 'Local' }], period_from: null, period_to: null, value: 79.41, unit: '%' }],
      },
      { text: 'Alimentos es el rubro de mayor venta.', evidence: ['P1.O2'], status: 'unverified', claims: [] },
    ],
    trends: [{ text: 'Los tres rubros crecen entre 2025-01 y 2025-06.', evidence: ['P1.O2'], status: 'unverified', claims: [] }],
    recommendations: [{ text: 'Comparar el canal dentro de cada rubro.', evidence: ['P1.O3', 'P1.O2'], status: 'unverified', claims: [] }],
    limitations: ['No se pudo calcular P1.O5.'],
    data_quality: [],
  },
  notes: [
    'Se descartaron 1 afirmaciones que no se pudieron verificar contra los resultados:',
    'Descartada (hallazgo: no nombra «Alimentos», al que corresponde su cifra).',
  ],
  usage: { model: 'gpt-6-luna', input_tokens: 2100, output_tokens: 600, cost_usd: 0.0009, remaining_usd: 0.09 },
}

function gateway(aiEnabled = true) {
  return {
    status: vi.fn(async () => ({
      ai_enabled: aiEnabled, provider_configured: true, external_calls_implemented: true, model: 'gpt-6-luna',
      budget_usd: 0.1, spent_usd: 0, remaining_usd: 0.1, requests_used: 0, max_requests: 15,
    })),
    prepare: vi.fn(),
    authorize: vi.fn(),
    cancel: vi.fn(async () => undefined),
    prepareInterpretation: vi.fn(async (executionId: string) => ({
      request_id: 'int-1',
      payload: { version: 1, objective: 'Quiero ver la evolución de las ventas por rubro', execution: executionId, operations: [{ ref: 'P1.O1' }] },
      payload_sha256: 'a'.repeat(64),
      expires_in_seconds: 300,
      ai_enabled: aiEnabled,
      external_calls_implemented: true,
      estimated_input_tokens: 2300,
      estimated_max_cost_usd: 0.0021,
    })),
    authorizeInterpretation: vi.fn(async () => INTERPRETATION),
    cancelInterpretation: vi.fn(async () => undefined),
  } satisfies AIGatewayClient
}

function renderSection(ai: AIGatewayClient | null = gateway()) {
  render(
    <AppProviders service={createDemoService({ delayMs: 0 })} aiGateway={ai} analysisEngine={null}>
      <ReportSection run={run} fileNames={FILES} />
    </AppProviders>,
  )
  return userEvent.setup()
}

const section = () => screen.getByRole('region', { name: 'Informe de análisis e interpretación' })

describe('modelo del informe', () => {
  it('reúne fuentes, metodología, gráficos y tablas sin recalcular nada', () => {
    const report = buildReport({ run, objective: ' Ventas por rubro ', projectName: 'Ventas', fileNames: FILES, interpretation: null, now: new Date('2026-10-27T12:00:00Z') })
    expect(report.objective).toBe('Ventas por rubro')
    expect(report.status).toBe('partial')
    expect(report.sources).toEqual([{ alias: 'A', rows: 72, columns: 4, fileName: FILES.A }])
    expect(report.methodology.map((m) => m.ref)).toEqual(['P1.O1', 'P1.O2', 'P1.O3', 'P1.O4', 'P1.O5'])
    expect(report.methodology[4]).toMatchObject({ status: 'error', operation: 'Suma · Suma inválida' })
    const plan = report.plans[0]
    // El indicador es el total que calculó Pandas (no se suma nada en el navegador).
    expect(plan.kpis.map((k) => [k.value, k.unit])).toContainEqual([69060, 'ARS'])
    expect(plan.charts.length).toBeGreaterThan(0)
    expect(plan.charts.every((c) => c.chart.animated === false)).toBe(true)
    // La serie por rubro es explorable: el informe aclara que muestra la vista predeterminada.
    expect(plan.charts.some((c) => c.note?.startsWith('Vista predeterminada'))).toBe(true)
    expect(report.summary?.executive[0]).toBe('Se calcularon 4 de 5 operaciones con Pandas.')
    // La operación fallida no tiene tabla ni gráfico: figura entre los errores.
    expect(plan.tables.map((t) => t.ref)).toEqual(['P1.O1', 'P1.O2', 'P1.O3', 'P1.O4'])
    expect(plan.errors[0].message).toContain('columna categórica')
    expect(reportFileName(report)).toBe('informe-ventas-2026-10-27.pdf')
  })
})

describe('Informe de análisis e interpretación', () => {
  it('muestra el resumen descriptivo verificable (sin IA) y la operación fallida sin conclusiones', async () => {
    renderSection()
    const summary = within(section()).getByRole('region', { name: 'Resumen descriptivo' })
    expect(within(summary).getByText('Calculado con Pandas · sin IA')).toBeInTheDocument()
    expect(within(summary).getByText('Suma de monto_ars: 69.060 ARS.')).toBeInTheDocument()
    expect(within(summary).getByText(/pasó de 5\.080 ARS en 2025-01 a 5\.580 ARS en 2025-06; variación de \+500 ARS \(\+9,8 %\)/)).toBeInTheDocument()
    expect(within(summary).getByText(/No se pudo calcular: «rubro» es una columna categórica/)).toBeInTheDocument()
    expect(within(summary).getByText(/1 de 5 operaciones no se pudieron calcular/)).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Interpretar resultados con IA' })).toBeInTheDocument()
  })

  it('pide autorización explícita, muestra el contenido exacto y el costo, y solo entonces envía', async () => {
    const ai = gateway()
    const user = renderSection(ai)
    await user.click(await screen.findByRole('button', { name: 'Interpretar resultados con IA' }))

    expect(ai.prepareInterpretation).toHaveBeenCalledWith('exec-ventas-1')
    const panel = await screen.findByRole('region', { name: 'Autorizar interpretación con IA' })
    expect(within(panel).getByText(/USD 0\.0021/)).toBeInTheDocument()
    expect(within(panel).getByText(/Nunca se envían: los archivos, las filas originales/)).toBeInTheDocument()
    expect(within(panel).getByLabelText('Contenido exacto de la interpretación')).toHaveTextContent('"execution": "exec-ventas-1"')
    expect(ai.authorizeInterpretation).not.toHaveBeenCalled()

    await user.click(within(panel).getByRole('button', { name: 'Autorizar y enviar' }))
    expect(ai.authorizeInterpretation).toHaveBeenCalledWith('int-1', 'a'.repeat(64))
    expect(await screen.findByText('Generada por IA · verificada')).toBeInTheDocument()
    expect(screen.getByText(/no nombra «Alimentos»/)).toBeInTheDocument()
    expect(screen.getByText('Verificada')).toBeInTheDocument()

    // La vista previa identifica la interpretación como de la IA y muestra en qué se apoya cada afirmación.
    await user.click(screen.getByRole('button', { name: 'Revisar el informe' }))
    const preview = screen.getByRole('document', { name: 'Vista previa del informe' })
    expect(within(preview).getByText(/Redactada por la IA \(gpt-6-luna\)/)).toBeInTheDocument()
    expect(within(preview).getByText('El canal Local concentra el 79,41 % del total.')).toBeInTheDocument()
    expect(within(preview).getByText('[P1.O3, P1.O2]')).toBeInTheDocument()
    // Las afirmaciones sin cifras se muestran aparte, marcadas como no verificadas.
    const unverified = within(preview).getByText('No verificadas automáticamente (sin cifras)').parentElement!
    expect(within(unverified).getByText(/Hallazgo: Alimentos es el rubro de mayor venta./)).toBeInTheDocument()
    expect(within(preview).getByText('Hallazgos principales').parentElement).not.toHaveTextContent('Alimentos es el rubro de mayor venta')
    expect(within(preview).getByText('Resumen ejecutivo (descriptivo, calculado sin IA)')).toBeInTheDocument()
  })

  it('cancelar no envía nada', async () => {
    const ai = gateway()
    const user = renderSection(ai)
    await user.click(await screen.findByRole('button', { name: 'Interpretar resultados con IA' }))
    await user.click(within(await screen.findByRole('region', { name: 'Autorizar interpretación con IA' })).getByRole('button', { name: 'Cancelar' }))
    expect(ai.cancelInterpretation).toHaveBeenCalledWith('int-1')
    expect(ai.authorizeInterpretation).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Interpretar resultados con IA' })).toBeInTheDocument()
  })

  it('sin IA disponible, el informe y el PDF usan solo el resumen descriptivo, sin presentarlo como de la IA', async () => {
    const ai = gateway(false)
    const user = renderSection(ai)
    expect(await screen.findByText('IA no disponible')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Interpretar resultados con IA' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Revisar el informe' }))
    const preview = screen.getByRole('document', { name: 'Vista previa del informe' })
    expect(within(preview).getByText(/No se incluyó una interpretación con IA/)).toBeInTheDocument()
    expect(within(preview).queryByText(/Redactada por la IA/)).not.toBeInTheDocument()
    expect(within(preview).getAllByText(/Suma de monto_ars: 69\.060 ARS\./).length).toBeGreaterThan(0)

    await user.click(screen.getByRole('button', { name: 'Descargar PDF' }))
    await waitFor(() => expect(downloadSpy).toHaveBeenCalled())
    const [report, container] = downloadSpy.mock.calls.at(-1) as unknown as [ReturnType<typeof buildReport>, HTMLElement]
    expect(report.interpretation).toBeNull()
    expect(report.summary?.items).toHaveLength(5)
    expect(container).toBe(preview)
    expect(ai.prepareInterpretation).not.toHaveBeenCalled()
  })
})

describe('PDF', () => {
  it('se genera con y sin interpretación', async () => {
    for (const interpretation of [null, INTERPRETATION]) {
      const report = buildReport({ run, objective: 'Ventas', projectName: 'Ventas', fileNames: FILES, interpretation })
      const doc = await createReportPdf(report)
      const bytes = new Uint8Array(doc.output('arraybuffer'))
      expect(String.fromCharCode(...bytes.slice(0, 5))).toBe('%PDF-')
      expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(2)
    }
  })

  it('incluye las secciones obligatorias, tildes, unidades y avisos de recortes y vistas predeterminadas', async () => {
    // Una tabla de 30 filas para comprobar el aviso de recorte (el PDF lista 25).
    const long = structuredClone(run)
    const series = long.results[0].operations[1]
    series.rows = Array.from({ length: 30 }, (_, i) => ({ keys: [`2025-${String(i + 1).padStart(2, '0')}`, 'Alimentos'], values: [1000 + i] }))
    const report = buildReport({ run: long, objective: 'Quiero ver la evolución de las ventas por rubro', projectName: 'Ventas', fileNames: FILES, interpretation: INTERPRETATION })
    const doc = await createReportPdf(report, new Map(), { compress: false })
    const text = doc.output()
    // jsPDF escapa los paréntesis del texto: se comparan sin ellos.
    const has = (s: string) => expect(text.replace(/\\([()])/g, '$1')).toContain(s)
    has('Objetivo del análisis')
    has('Quiero ver la evolución de las ventas por rubro')
    has('Resumen ejecutivo (descriptivo, calculado sin IA)')
    has('Se calcularon 4 de 5 operaciones con Pandas.')
    has('Hallazgos calculados (resumen descriptivo con Pandas, sin IA)')
    has('Indicador')
    has('69.060 ARS')
    has('Se listan 25 de 30 filas')
    has('Vista predeterminada')
    has('No se pudo convertir este gráfico en imagen')
    has('Hallazgos respaldados por los cálculos')
    has('El canal Local concentra el 79,41 % del total. [P1.O3]')
    has('No verificadas automáticamente (sin cifras)')
    has('Advertencias y limitaciones')
    has('Página 1 de')
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(3)
  })

  it('reemplaza los caracteres que las fuentes estándar no tienen', () => {
    expect(pdfText('“Sí” — 3 → 4 ≥ 2 … ⚠ 10 €')).toBe('"Sí" - 3 -> 4 >= 2 ...  10 EUR')
  })
})
