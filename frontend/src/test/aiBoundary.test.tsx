import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { completeReview, goToReview } from './reviewHelpers'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { AIContextReview } from '@/components/ai/AIContextReview'
import { AppProviders } from '@/context/AppProviders'
import { buildAIContext, contextProblem, defaultReview, sizeRange } from '@/lib/aiContext'
import { buildDatasetCatalog, type AnalysisSource } from '@/lib/datasetCatalog'
import { routes } from '@/routes'
import { createAIGatewayClient, type AIGatewayClient } from '@/services/aiGateway'
import { createDemoService } from '@/services/demoProvider'
import type { DataDecisionService } from '@/services/types'

// Datos sintéticos con apariencia sensible: nada de esto debe aparecer en el contexto.
const secretCsv = 'cliente,cuit,saldo\nACME SA,30111222,150000\nBeta SRL,30999888,NA\n'
const files = {
  clientes: () => new File([secretCsv], 'clientes_confidencial.csv', { type: 'text/csv' }),
  regiones: () => new File(['region,poblacion\nNorte,1000\nSur,2000\n'], 'regiones.csv', { type: 'text/csv' }),
  notas: () => new File(['curso,nota\n1A,8\n1B,6\n'], 'notas.csv', { type: 'text/csv' }),
}

async function loadSources(service: DataDecisionService, list: File[]): Promise<AnalysisSource[]> {
  const sources = []
  for (const file of list) {
    const dataset = await service.uploadDataset(file)
    sources.push({ dataset, profile: await service.getDatasetProfile(dataset.id) })
  }
  return sources
}

const FORBIDDEN = ['clientes_confidencial', 'ACME', '30111222', 'Beta SRL', '150000', 'sampleValues', 'previewRows', 'fileName']

describe('contexto mínimo para la IA', () => {
  it('no incluye archivos, nombres de archivo, filas, ejemplos ni valores', async () => {
    const service = createDemoService({ delayMs: 0 })
    const sources = await loadSources(service, [files.clientes()])
    const catalog = buildDatasetCatalog(sources)
    const payload = buildAIContext(catalog, 'Analizar saldos por cliente', defaultReview(catalog))
    const json = JSON.stringify(payload)

    for (const word of FORBIDDEN) expect(json).not.toContain(word)
    expect(payload).toEqual({
      version: 1,
      objective: 'Analizar saldos por cliente',
      sources: [{ alias: 'A', size_range: null, columns: expect.any(Array) }],
    })
    expect(payload.sources[0].columns.map((c) => Object.keys(c).sort())).toEqual(
      Array(3).fill(['distinct_values', 'format', 'missing_markers', 'name', 'semantic_confidence', 'semantic_type', 'user_corrected']),
    )
  })

  it.each([1, 2, 3])('admite %i fuentes independientes con alias', async (count) => {
    const service = createDemoService({ delayMs: 0 })
    const sources = await loadSources(service, [files.clientes(), files.regiones(), files.notas()].slice(0, count))
    const catalog = buildDatasetCatalog(sources)
    const payload = buildAIContext(catalog, 'Objetivo', defaultReview(catalog))
    expect(payload.sources.map((s) => s.alias)).toEqual(['A', 'B', 'C'].slice(0, count))
  })

  it('respeta columnas ocultas y renombradas; el tamaño solo como rango y si se autoriza', async () => {
    const service = createDemoService({ delayMs: 0 })
    const sources = await loadSources(service, [files.clientes(), files.regiones()])
    const catalog = buildDatasetCatalog(sources)
    const review = defaultReview(catalog)
    review[0].columns.cuit.include = false
    review[0].columns.cliente.name = 'entidad'
    review[1].includeSize = true
    for (const column of Object.values(review[1].columns)) column.include = false

    const payload = buildAIContext(catalog, 'Objetivo', review)
    expect(payload.sources).toHaveLength(1) // B sin columnas autorizadas no se menciona
    expect(payload.sources[0].columns.map((c) => c.name)).toEqual(['entidad', 'saldo'])
    expect(JSON.stringify(payload)).not.toContain('cuit')

    review[0].includeSize = true
    expect(buildAIContext(catalog, 'Objetivo', review).sources[0].size_range).toBe('<1k')
    expect(sizeRange(102_254)).toBe('100k-1M')
  })

  it('indica por qué no se puede preparar', () => {
    expect(contextProblem({ version: 1, objective: '', sources: [] })).toMatch(/objetivo/)
    expect(contextProblem({ version: 1, objective: 'Objetivo', sources: [] })).toMatch(/al menos una columna/)
  })
})

function fakeGateway(overrides: Partial<AIGatewayClient> = {}): AIGatewayClient & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    status: vi.fn(async () => {
      calls.push('status')
      return { ai_enabled: false, provider_configured: false, external_calls_implemented: false }
    }),
    prepare: vi.fn(async (payload) => {
      calls.push('prepare')
      return { request_id: 'req1', payload, payload_sha256: 'a'.repeat(64), expires_in_seconds: 300, ai_enabled: false, external_calls_implemented: false }
    }),
    authorize: vi.fn(async () => {
      calls.push('authorize')
      throw new Error('La IA externa está deshabilitada (AI_ENABLED=false). No se envió nada.')
    }),
    cancel: vi.fn(async () => {
      calls.push('cancel')
    }),
    ...overrides,
  }
}

describe('revisión y autorización', () => {
  it('en la demo pública solo muestra el contenido: no hay conexión ni envío', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const service = createDemoService({ delayMs: 0 })
    const sources = await loadSources(service, [files.clientes()])
    const onClose = vi.fn()
    const user = userEvent.setup()
    render(<AIContextReview sources={sources} initialObjective="Ver saldos" gateway={null} onClose={onClose} />)

    expect(screen.getByText('Demo pública: sin conexión')).toBeInTheDocument()
    const preview = screen.getByTestId('ai-payload-preview').textContent ?? ''
    for (const word of FORBIDDEN) expect(preview).not.toContain(word)
    expect(screen.getByRole('button', { name: 'Validar contenido' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(onClose).toHaveBeenCalled()
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })

  it('nada se envía sin preparar y autorizar; la autorización es de un solo uso', async () => {
    const gateway = fakeGateway()
    const service = createDemoService({ delayMs: 0 })
    const sources = await loadSources(service, [files.clientes(), files.regiones()])
    const user = userEvent.setup()
    render(<AIContextReview sources={sources} initialObjective="Ver saldos" gateway={gateway} onClose={() => undefined} />)

    await waitFor(() => expect(gateway.calls).toEqual(['status']))
    expect(screen.getByText(/deshabilitada/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Autorizar este envío' })).not.toBeInTheDocument()

    // Ocultar una columna antes de validar.
    await user.click(screen.getByRole('checkbox', { name: 'Compartir la columna cuit de la fuente A' }))
    await user.click(screen.getByRole('button', { name: 'Validar contenido' }))
    const sent = vi.mocked(gateway.prepare).mock.calls[0][0]
    expect(JSON.stringify(sent)).not.toContain('cuit')
    expect(sent.sources.map((s) => s.alias)).toEqual(['A', 'B'])
    expect(await screen.findByText(/Huella SHA-256/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Autorizar este envío' }))
    expect(await screen.findByText('Prueba finalizada. La IA está deshabilitada y no se envió ningún dato.')).toBeInTheDocument()
    expect(gateway.authorize).toHaveBeenCalledWith('req1', 'a'.repeat(64))
    // Uso único y estado final: no se invita a repetir el mismo envío.
    expect(screen.queryByRole('button', { name: 'Autorizar este envío' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Validar contenido' })).not.toBeInTheDocument()
    // Un contenido distinto es otro envío: vuelve a requerir validación.
    await user.type(screen.getByLabelText('Objetivo que se compartiría'), ' por región')
    expect(screen.getByRole('button', { name: 'Validar contenido' })).toBeInTheDocument()
  })

  it('editar después de validar invalida la solicitud preparada', async () => {
    const gateway = fakeGateway()
    const service = createDemoService({ delayMs: 0 })
    const sources = await loadSources(service, [files.regiones()])
    const user = userEvent.setup()
    render(<AIContextReview sources={sources} initialObjective="Ver población" gateway={gateway} onClose={() => undefined} />)
    await user.click(screen.getByRole('button', { name: 'Validar contenido' }))
    await screen.findByRole('button', { name: 'Autorizar este envío' })

    await user.type(screen.getByLabelText('Objetivo que se compartiría'), ' por región')
    expect(gateway.cancel).toHaveBeenCalledWith('req1')
    expect(screen.queryByRole('button', { name: 'Autorizar este envío' })).not.toBeInTheDocument()
    expect(gateway.authorize).not.toHaveBeenCalled()
  })

  it('el cliente solo llama a la frontera del backend, sin los datos excluidos', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ request_id: 'r', payload: {}, payload_sha256: 'b'.repeat(64), expires_in_seconds: 300, ai_enabled: false, external_calls_implemented: false }), { status: 201 }),
    )
    const service = createDemoService({ delayMs: 0 })
    const catalog = buildDatasetCatalog(await loadSources(service, [files.clientes()]))
    await createAIGatewayClient('http://127.0.0.1:8000').prepare(buildAIContext(catalog, 'Objetivo', defaultReview(catalog)))

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, init] = fetchSpy.mock.calls[0]
    expect(url).toBe('http://127.0.0.1:8000/api/ai/requests')
    for (const word of FORBIDDEN) expect(String(init?.body)).not.toContain(word)
    expect(String(url)).not.toMatch(/openai/i)
    fetchSpy.mockRestore()
  })
})

describe('flujo DEMO con la revisión de privacidad', () => {
  it('el asistente sigue funcionando y la revisión se abre sin conexión', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const user = userEvent.setup()
    const service = createDemoService({ delayMs: 0 })
    const router = createMemoryRouter(routes, { initialEntries: ['/analisis/cargar'] })
    render(
      <AppProviders service={service} aiGateway={null}>
        <RouterProvider router={router} />
      </AppProviders>,
    )
    await user.upload(screen.getByTestId('file-input'), files.clientes())
    await goToReview(user)
    await completeReview(user)
    await waitFor(() => expect(router.state.location.pathname).toBe('/analisis/asistente'))

    // Se espera el saludo (mientras carga, el editor está deshabilitado) y se usa una sugerencia.
    await user.click(await screen.findByRole('button', { name: 'Quiero un resumen general de mis datos' }))
    expect(await screen.findByText(/Entiendo tu objetivo/)).toBeInTheDocument()

    // En el asistente hay un resumen compacto; sin backend no hay autorización de envíos.
    expect(screen.getByRole('region', { name: 'Resumen de la revisión de datos' })).toHaveTextContent('Datos revisados')
    expect(screen.queryByText(/Enviar a la IA real/)).not.toBeInTheDocument()
    expect(document.body.textContent).not.toContain('ACME')
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })
})

describe('aislamiento de la demo pública', () => {
  afterEach(() => {
    vi.resetModules()
    vi.doUnmock('@/lib/config')
  })

  it.each([
    [{ demoMode: true, backendProfiling: false }, false],
    [{ demoMode: true, backendProfiling: true }, true],
    [{ demoMode: false, backendProfiling: false }, true],
  ])('con %o, el cliente de IA existe: %s', async (flags, exists) => {
    vi.resetModules()
    vi.doMock('@/lib/config', () => ({ appConfig: { ...flags, apiBaseUrl: 'http://127.0.0.1:8000', maxUploadMb: 25 } }))
    const { createDefaultAIGateway } = await import('@/services/aiGateway')
    expect(createDefaultAIGateway() !== null).toBe(exists)
  })
})
