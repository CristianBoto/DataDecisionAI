import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { completeReview, goToReview } from './reviewHelpers'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { AppProviders } from '@/context/AppProviders'
import { buildDatasetCatalog, MAX_SOURCES, normalizeColumnName } from '@/lib/datasetCatalog'
import { routes } from '@/routes'
import type { DatasetProfiler } from '@/services/backendProfile'
import { createDemoService } from '@/services/demoProvider'
import { ApiError } from '@/services/errors'
import type { DataDecisionService } from '@/services/types'

// Tres estructuras distintas y una cuarta igual a la primera (posible concatenación).
const csv = (name: string, text: string) => new File([text], name, { type: 'text/csv' })
const ventas2024 = () => csv('ventas_2024.csv', 'fecha,region,monto\n2024-01-01,Norte,10\n2024-01-02,Sur,20\n')
const ventas2025 = () => csv('ventas_2025.csv', 'fecha,region,monto\n2025-01-01,Norte,15\n2025-01-02,Sur,NA\n')
const regiones = () => csv('regiones.csv', 'Región;Responsable;Población\nNorte;Ana;1000\nSur;Luis;2000\n')
const alumnos = () => csv('alumnos.csv', 'curso,alumno,nota\n1A,Ana,8\n1B,Luis,6\n')

function renderApp(service: DataDecisionService, initialPath = '/analisis/cargar') {
  const router = createMemoryRouter(routes, { initialEntries: [initialPath] })
  render(
    <AppProviders service={service}>
      <RouterProvider router={router} />
    </AppProviders>,
  )
  return router
}

async function uploadedSources(service: DataDecisionService, files: File[]) {
  const sources = []
  for (const file of files) {
    const dataset = await service.uploadDataset(file)
    sources.push({ dataset, profile: await service.getDatasetProfile(dataset.id) })
  }
  return sources
}

describe('catálogo estructurado de fuentes', () => {
  it('describe esquemas de varias fuentes sin unirlas ni incluir valores reales', async () => {
    const service = createDemoService({ delayMs: 0 })
    const sources = await uploadedSources(service, [ventas2024(), regiones(), ventas2025()])
    const catalog = buildDatasetCatalog(sources)

    expect(catalog.sources.map((s) => [s.alias, s.fileName, s.columnCount])).toEqual([
      ['A', 'ventas_2024.csv', 3],
      ['B', 'regiones.csv', 3],
      ['C', 'ventas_2025.csv', 3],
    ])
    expect(catalog.sources[2].suspectedMissingCells).toBe(1)
    // 'region' y 'Región' se reconocen como el mismo nombre, solo como pista.
    expect(catalog.sharedColumns).toContainEqual({ name: 'region', sources: ['A', 'B', 'C'] })
    expect(catalog.sameColumnSets).toEqual([['A', 'C']])
    expect(catalog.rules.join(' ')).toMatch(/no se unieron/)
    // Minimización: ni ejemplos ni filas.
    const json = JSON.stringify(catalog)
    expect(json).not.toMatch(/Norte|Ana|2024-01-01/)
  })

  it('normaliza nombres de columna sin tildes, mayúsculas ni separadores', () => {
    expect(normalizeColumnName('Código País')).toBe('codigo_pais')
    expect(normalizeColumnName(' codigo-pais ')).toBe('codigo_pais')
  })
})

describe('proyectos con varias fuentes (DEMO)', () => {
  it('referencia todas las fuentes, avisa que solo usa la principal y no modifica los perfiles', async () => {
    const service = createDemoService({ delayMs: 0 })
    const sources = await uploadedSources(service, [ventas2024(), regiones(), alumnos()])
    const before = JSON.stringify(sources.map((s) => s.profile))
    const ids = sources.map((s) => s.dataset.id)

    const project = await service.createProject({ name: 'Varias fuentes', datasetId: ids[0], datasetIds: ids })
    expect(project.datasetIds).toEqual(ids)
    expect(project.datasets?.map((d) => d.fileName)).toEqual(['ventas_2024.csv', 'regiones.csv', 'alumnos.csv'])

    const [, notice] = await service.getConversation(project.id)
    expect(notice.content).toMatch(/2 fuentes más/)
    expect(notice.content).toMatch(/no se unió ni modificó ningún archivo/)

    await service.sendMessage(project.id, { content: 'resumen general' })
    const reply = await service.sendMessage(project.id, { content: 'sí' })
    expect(reply.proposal?.limitations.join(' ')).toMatch(/usa solo «ventas_2024.csv»/)

    const after = await Promise.all(ids.map((id) => service.getDatasetProfile(id)))
    expect(JSON.stringify(after)).toBe(before)
  })

  it('mantiene el flujo de una sola fuente', async () => {
    const service = createDemoService({ delayMs: 0 })
    const [{ dataset }] = await uploadedSources(service, [ventas2024()])
    const project = await service.createProject({ name: 'Una fuente', datasetId: dataset.id })
    expect(project.datasets).toHaveLength(1)
    expect(await service.getConversation(project.id)).toHaveLength(1)
  })

  it('rechaza más de tres fuentes o fuentes inexistentes', async () => {
    const service = createDemoService({ delayMs: 0 })
    const sources = await uploadedSources(service, [ventas2024(), ventas2025(), regiones(), alumnos()])
    const ids = sources.map((s) => s.dataset.id)
    await expect(service.createProject({ name: 'Demasiadas', datasetId: ids[0], datasetIds: ids })).rejects.toThrow(/hasta 3 fuentes/)
    await expect(service.createProject({ name: 'Inexistente', datasetId: ids[0], datasetIds: [ids[0], 'ds_x'] })).rejects.toThrow(/no existe/)
  })
})

describe('pantalla de carga con varias fuentes', () => {
  it('carga dos archivos distintos a la vez, muestra cada uno y envía ambas fuentes al proyecto', async () => {
    const user = userEvent.setup()
    const service = createDemoService({ delayMs: 0 })
    const createProject = vi.spyOn(service, 'createProject')
    const router = renderApp(service)

    await user.upload(screen.getByTestId('file-input'), [ventas2024(), regiones()])
    const list = await screen.findByRole('list', { name: 'Fuentes del análisis' })
    await waitFor(() => expect(within(list).getAllByLabelText('Archivo listo')).toHaveLength(2))
    expect(within(list).getByText(/Fuente 1/).closest('li')).toHaveTextContent('ventas_2024.csv')
    expect(within(list).getByText(/Fuente 2/).closest('li')).toHaveTextContent('3 columnas')
    expect(screen.getByText(/Fuentes del análisis \(2 de 3\)/)).toBeInTheDocument()
    expect(screen.getByText(/«region» en fuentes A, B/)).toBeInTheDocument()

    // Ver el detalle de otra fuente.
    await user.click(screen.getByRole('button', { name: 'Ver detalle de ventas_2024.csv' }))
    expect(screen.getByText(/Detalle de «ventas_2024.csv»/)).toBeInTheDocument()

    await goToReview(user)
    await completeReview(user)
    await waitFor(() => expect(router.state.location.pathname).toBe('/analisis/asistente'))
    const input = createProject.mock.calls[0][0]
    expect(input.datasetIds).toHaveLength(2)
    expect(input.datasetId).toBe(input.datasetIds?.[0])
  })

  it('quita una fuente sin afectar a las demás', async () => {
    const user = userEvent.setup()
    renderApp(createDemoService({ delayMs: 0 }))
    await user.upload(screen.getByTestId('file-input'), [ventas2024(), regiones(), alumnos()])
    const list = await screen.findByRole('list', { name: 'Fuentes del análisis' })
    await waitFor(() => expect(within(list).getAllByLabelText('Archivo listo')).toHaveLength(3))
    // Con tres fuentes ya no se ofrece la zona de carga.
    expect(screen.queryByTestId('file-input')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Quitar regiones.csv' }))
    expect(within(list).queryByText('regiones.csv')).not.toBeInTheDocument()
    expect(within(list).getAllByLabelText('Archivo listo')).toHaveLength(2)
    expect(screen.getByText(/Fuentes del análisis \(2 de 3\)/)).toBeInTheDocument()
    expect(screen.getByTestId('file-input')).toBeInTheDocument()
  })

  it('limita la cantidad de archivos e informa errores por archivo', async () => {
    const user = userEvent.setup({ applyAccept: false })
    renderApp(createDemoService({ delayMs: 0 }))
    await user.upload(screen.getByTestId('file-input'), [
      ventas2024(),
      new File(['%PDF'], 'informe.pdf', { type: 'application/pdf' }),
      alumnos(),
      regiones(),
    ])

    expect(await screen.findByText(`Un análisis admite hasta ${MAX_SOURCES} archivos: se tomaron 3 y se ignoraron 1.`)).toBeInTheDocument()
    const list = screen.getByRole('list', { name: 'Fuentes del análisis' })
    await waitFor(() => expect(within(list).getAllByLabelText('Archivo listo')).toHaveLength(2))
    expect(within(list).getByText(/Los archivos PDF no son compatibles/)).toBeInTheDocument()
    expect(screen.getByText(/Los archivos con error no se incluirán/)).toBeInTheDocument()
  })

  it('no acepta el mismo archivo dos veces', async () => {
    const user = userEvent.setup()
    renderApp(createDemoService({ delayMs: 0 }))
    await user.upload(screen.getByTestId('file-input'), ventas2024())
    await screen.findByLabelText('Archivo listo')
    await user.upload(screen.getByTestId('file-input'), ventas2024())
    expect(await screen.findByText('Este archivo ya forma parte del análisis.')).toBeInTheDocument()
  })

  it('si falla un reemplazo con el backend, conserva la fuente anterior; y perfila de a un archivo', async () => {
    const user = userEvent.setup()
    let active = 0
    let maxActive = 0
    const profiler: DatasetProfiler = {
      async profile(file, id) {
        active += 1
        maxActive = Math.max(maxActive, active)
        await new Promise((resolve) => setTimeout(resolve, 5))
        active -= 1
        if (file.name === 'roto.csv') throw new ApiError('El archivo CSV no tiene una estructura tabular válida.', { status: 422 })
        return {
          datasetId: id,
          origin: 'backend',
          isComplete: true,
          rowCount: 2,
          rowCountIsEstimate: false,
          columnCount: 1,
          columns: [{ name: file.name, inferredType: 'text', nonNullCount: 2, nullCount: 0, uniqueCount: 2, sampleValues: [] }],
          previewRows: [],
          issues: [],
        }
      },
    }
    renderApp(createDemoService({ delayMs: 0, profiler }))
    await user.upload(screen.getByTestId('file-input'), [ventas2024(), regiones()])
    const list = await screen.findByRole('list', { name: 'Fuentes del análisis' })
    await waitFor(() => expect(within(list).getAllByLabelText('Archivo listo')).toHaveLength(2))
    expect(maxActive).toBe(1)

    await user.upload(screen.getByTestId('replace-input-1'), csv('roto.csv', 'a\n'))
    expect(await screen.findByText(/estructura tabular válida\. Se conserva el archivo anterior\./)).toBeInTheDocument()
    expect(within(list).getByText(/Fuente 1/).closest('li')).toHaveTextContent('ventas_2024.csv')
    expect(within(list).getAllByLabelText('Archivo listo')).toHaveLength(2)
    expect(screen.getByText('El backend no pudo perfilar el archivo')).toBeInTheDocument()
  })

  it('reemplaza una fuente en su misma posición', async () => {
    const user = userEvent.setup()
    renderApp(createDemoService({ delayMs: 0 }))
    await user.upload(screen.getByTestId('file-input'), [ventas2024(), regiones()])
    const list = await screen.findByRole('list', { name: 'Fuentes del análisis' })
    await waitFor(() => expect(within(list).getAllByLabelText('Archivo listo')).toHaveLength(2))

    await user.upload(screen.getByTestId('replace-input-1'), alumnos())
    await waitFor(() => expect(within(list).getByText(/Fuente 1/).closest('li')).toHaveTextContent('alumnos.csv'))
    expect(within(list).getByText(/Fuente 2/).closest('li')).toHaveTextContent('regiones.csv')
  })
})

describe('workspace con varias fuentes', () => {
  it('permite ver el perfil de cada fuente por separado', async () => {
    const user = userEvent.setup()
    const service = createDemoService({ delayMs: 0 })
    const sources = await uploadedSources(service, [ventas2024(), alumnos()])
    const ids = sources.map((s) => s.dataset.id)
    const project = await service.createProject({ name: 'Workspace', datasetId: ids[0], datasetIds: ids })
    // El workspace exige un plan aprobado.
    await service.sendMessage(project.id, { content: 'resumen general' })
    const reply = await service.sendMessage(project.id, { content: 'sí' })
    await service.approveProposal(project.id, reply.proposal!.id)

    renderApp(service, `/proyectos/${project.id}/datos`)
    expect(await screen.findByRole('tab', { name: 'A · ventas_2024.csv' })).toHaveAttribute('aria-selected', 'true')
    await user.click(screen.getByRole('tab', { name: 'B · alumnos.csv' }))
    expect(await screen.findByRole('columnheader', { name: /alumno/ })).toBeInTheDocument()
    expect(screen.getByText(/no se unieron ni se transformaron/)).toBeInTheDocument()
  })
})

describe('liberación de fuentes quitadas o reemplazadas (F7)', () => {
  it('el proveedor DEMO libera el dataset y su perfil sin afectar a las demás fuentes', async () => {
    const service = createDemoService({ delayMs: 0 })
    const [a, b] = await uploadedSources(service, [ventas2024(), regiones()])
    service.discardDataset(a.dataset.id)
    await expect(service.getDatasetProfile(a.dataset.id)).rejects.toThrow(/No se encontró/)
    expect((await service.getDatasetProfile(b.dataset.id)).columns).toHaveLength(3)
    // Ya no puede usarse para crear un proyecto.
    await expect(service.createProject({ name: 'Liberado', datasetId: a.dataset.id })).rejects.toThrow(/no existe/)
  })

  it('no libera un dataset que usa un proyecto ya creado', async () => {
    const service = createDemoService({ delayMs: 0 })
    const [a] = await uploadedSources(service, [ventas2024()])
    await service.createProject({ name: 'En uso', datasetId: a.dataset.id })
    service.discardDataset(a.dataset.id)
    expect((await service.getDatasetProfile(a.dataset.id)).columns).toHaveLength(3)
  })

  it('la pantalla libera al quitar y al reemplazar, y conserva la fuente si el reemplazo falla', async () => {
    const user = userEvent.setup({ applyAccept: false })
    const service = createDemoService({ delayMs: 0 })
    const discard = vi.spyOn(service, 'discardDataset')
    renderApp(service)
    await user.upload(screen.getByTestId('file-input'), [ventas2024(), regiones(), alumnos()])
    const list = await screen.findByRole('list', { name: 'Fuentes del análisis' })
    await waitFor(() => expect(within(list).getAllByLabelText('Archivo listo')).toHaveLength(3))

    // Reemplazo fallido (PDF): no se libera nada.
    await user.upload(screen.getByTestId('replace-input-1'), new File(['%PDF'], 'informe.pdf'))
    expect(await screen.findByText(/Se conserva el archivo anterior/)).toBeInTheDocument()
    expect(discard).not.toHaveBeenCalled()

    // Reemplazo exitoso: se libera solo el anterior.
    await user.upload(screen.getByTestId('replace-input-2'), csv('nuevo.csv', 'x,y\n1,2\n'))
    // El nombre nuevo aparece mientras se procesa: se espera a que termine (liberación incluida).
    await waitFor(() => expect(discard).toHaveBeenCalledTimes(1))
    expect(within(list).getByText(/Fuente 2/).closest('li')).toHaveTextContent('nuevo.csv')
    expect(within(list).getAllByLabelText('Archivo listo')).toHaveLength(3)
    const replacedId = discard.mock.calls[0][0]
    await expect(service.getDatasetProfile(replacedId)).rejects.toThrow(/No se encontró/)

    // Quitar: se libera esa fuente; las demás siguen disponibles.
    await user.click(screen.getByRole('button', { name: 'Quitar alumnos.csv' }))
    expect(discard).toHaveBeenCalledTimes(2)
    await expect(service.getDatasetProfile(discard.mock.calls[1][0])).rejects.toThrow(/No se encontró/)
    expect(within(list).getAllByLabelText('Archivo listo')).toHaveLength(2)
  })
})
