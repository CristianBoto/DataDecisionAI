import { adaptBackendProfile, createBackendProfiler, type BackendProfileResponse } from './backendProfile'
import { createDemoService } from './demoProvider'
import { getErrorMessage } from './errors'
import { createService } from './index'

const BASE_URL = 'http://127.0.0.1:8000'

/** Respuesta con la misma forma que devuelve `profile_dataset` en Python. */
const backendResponse: BackendProfileResponse = {
  filename: 'pacientes.csv',
  format: 'csv',
  encoding: 'utf-8-sig',
  sheet_name: null,
  row_count: 102254,
  column_count: 3,
  duplicate_rows: 12,
  columns: [
    { name: 'fecha', missing: 0, non_empty: 102254, distinct: 365, examples: ['2025-01-01', '2025-01-02', '2025-01-03'] },
    { name: 'servicio', missing: 4, non_empty: 102250, distinct: 7, examples: ['Guardia', 'Pediatría', 'Clínica'] },
    { name: 'espera_min', missing: 0, non_empty: 102254, distinct: 180, examples: ['15', '42', '7'] },
  ],
  preview: [
    { fecha: '2025-01-01', servicio: 'Guardia', espera_min: '15' },
    { fecha: '2025-01-01', servicio: '', espera_min: '42' },
  ],
  warnings: [
    "La columna 'servicio' tiene 4 valores vacíos.",
    'Se encontraron 12 filas idénticas. No se eliminan automáticamente.',
  ],
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

const csvFile = () => new File(['fecha,servicio,espera_min\n2025-01-01,Guardia,15\n'], 'pacientes.csv', { type: 'text/csv' })

afterEach(() => {
  vi.restoreAllMocks()
})

describe('adaptador del perfil de Pandas', () => {
  it('convierte la respuesta del backend en un DatasetProfile completo', () => {
    const profile = adaptBackendProfile(backendResponse, 'ds_1')

    expect(profile.origin).toBe('backend')
    expect(profile.isComplete).toBe(true)
    expect(profile.rowCount).toBe(102254)
    expect(profile.rowCountIsEstimate).toBe(false)
    expect(profile.columnCount).toBe(3)
    expect(profile.duplicateRowCount).toBe(12)
    expect(profile.columns.map((c) => c.name)).toEqual(['fecha', 'servicio', 'espera_min'])
    expect(profile.columns[1]).toMatchObject({ nullCount: 4, nonNullCount: 102250, uniqueCount: 7 })
    expect(profile.columns.map((c) => c.inferredType)).toEqual(['date', 'text', 'numeric'])
    expect(profile.previewRows).toEqual(backendResponse.preview)
    expect(profile.issues).toEqual([
      { severity: 'warning', column: 'servicio', message: backendResponse.warnings[0] },
      { severity: 'warning', message: backendResponse.warnings[1] },
    ])
  })
})

describe('cliente de perfilado real', () => {
  it('envía el archivo como multipart en el campo "file"', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(backendResponse))
    const profile = await createBackendProfiler(BASE_URL).profile(csvFile(), 'ds_1')

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, init] = fetchSpy.mock.calls[0]
    expect(url).toBe(`${BASE_URL}/api/datasets/profile`)
    expect(init?.method).toBe('POST')
    const body = init?.body as FormData
    expect(body).toBeInstanceOf(FormData)
    expect((body.get('file') as File).name).toBe('pacientes.csv')
    expect(profile.rowCount).toBe(102254)
  })

  it('muestra el mensaje de error de FastAPI', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ detail: 'El archivo CSV no tiene una estructura tabular válida.' }, 422))
    const error = await createBackendProfiler(BASE_URL).profile(csvFile(), 'ds_1').catch((e: unknown) => e)
    expect(getErrorMessage(error)).toBe('El archivo CSV no tiene una estructura tabular válida.')
  })

  it('informa cuando el backend no responde', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'))
    const error = await createBackendProfiler(BASE_URL).profile(csvFile(), 'ds_1').catch((e: unknown) => e)
    expect(getErrorMessage(error)).toMatch(/No se pudo conectar con el backend en http:\/\/127\.0\.0\.1:8000/)
  })
})

describe('DEMO con perfilado real', () => {
  it('usa el perfil de Pandas y mantiene el resto en DEMO', async () => {
    const profiler = { profile: vi.fn(async (_file: File, id: string) => adaptBackendProfile(backendResponse, id)) }
    const service = createDemoService({ delayMs: 0, profiler })
    expect(service.mode).toBe('demo')
    expect(service.profiling).toBe('backend')

    const dataset = await service.uploadDataset(csvFile())
    const profile = await service.getDatasetProfile(dataset.id)
    expect(profiler.profile).toHaveBeenCalledTimes(1)
    expect(profile.origin).toBe('backend')

    const project = await service.createProject({ name: 'Tiempos de espera', datasetId: dataset.id })
    const [greeting] = await service.getConversation(project.id)
    expect(greeting.isDemo).toBe(true)
    expect(greeting.content).toMatch(/perfil calculado con Pandas/)
  })

  it('no reemplaza un error del backend por datos locales o ficticios', async () => {
    const profiler = { profile: vi.fn().mockRejectedValue(new Error('El backend respondió 500')) }
    const service = createDemoService({ delayMs: 0, profiler })
    await expect(service.uploadDataset(csvFile())).rejects.toThrow('El backend respondió 500')
  })

  it('también perfila Excel con el backend', async () => {
    const xlsx = { ...backendResponse, format: 'xlsx' as const, encoding: null, sheet_name: 'Hoja1' }
    const profiler = { profile: vi.fn(async (_file: File, id: string) => adaptBackendProfile(xlsx, id)) }
    const service = createDemoService({ delayMs: 0, profiler })
    const dataset = await service.uploadDataset(new File(['PK'], 'datos.xlsx'))
    const profile = await service.getDatasetProfile(dataset.id)
    expect(profile.columnCount).toBe(3)
    expect(profile.note).toMatch(/Hoja1/)
  })
})

describe('separación entre demo pública y ejecución local', () => {
  it('la demo pública (sin VITE_BACKEND_PROFILING) no llama al backend', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const service = createService(true, false)
    expect(service.profiling).toBe('browser')
    const dataset = await service.uploadDataset(csvFile())
    expect((await service.getDatasetProfile(dataset.id)).origin).toBe('local-preview')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('la ejecución local solo llama al endpoint de perfilado', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(backendResponse))
    const service = createService(true, true)
    expect(service.mode).toBe('demo')
    expect(service.profiling).toBe('backend')

    const dataset = await service.uploadDataset(csvFile())
    const project = await service.createProject({ name: 'Local', datasetId: dataset.id })
    await service.sendMessage(project.id, { content: 'resumen general' })
    await service.checkHealth()

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(String(fetchSpy.mock.calls[0][0])).toMatch(/\/api\/datasets\/profile$/)
  }, 10_000)
})
