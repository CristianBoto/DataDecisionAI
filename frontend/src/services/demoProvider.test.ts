import { createDemoService } from './demoProvider'
import { isBackendRequiredError } from './errors'

const exportRequest = {
  format: 'pdf' as const,
  title: 'Informe',
  author: 'Autor',
  organization: '',
  date: '2026-10-24',
  objectives: '',
  sections: { objectives: true, indicators: true, charts: true, analysis: true, limitations: true },
}

describe('proveedor DEMO', () => {
  it('recorre el flujo completo con el dataset ficticio y exige aprobación', async () => {
    const service = createDemoService({ delayMs: 0 })
    const dataset = await service.loadDemoDataset()
    const project = await service.createProject({ name: 'Proyecto demo', datasetId: dataset.id })

    const history = await service.getConversation(project.id)
    expect(history[0].role).toBe('assistant')

    // Sin aprobación no hay resultados ni ejecución.
    expect((await service.getResults(project.id)).status).toBe('not_started')
    await expect(service.runAnalysis(project.id)).rejects.toThrow(/aprobar/)

    const first = await service.sendMessage(project.id, { content: 'Quiero ver cómo vienen las ventas' })
    expect(first.proposal).toBeNull()
    const second = await service.sendMessage(project.id, { content: 'Sí, ese enfoque me sirve' })
    expect(second.proposal?.feasibility).toBe('viable')

    const plan = await service.approveProposal(project.id, second.proposal!.id)
    expect(plan.proposalVersion).toBe(1)
    const run = await service.runAnalysis(project.id)
    expect(run.status).toBe('completed')

    const results = await service.getResults(project.id)
    expect(results.status).toBe('available')
    expect(results.isDemo).toBe(true)
    expect(results.charts.map((c) => c.id)).toEqual(plan.charts.map((c) => c.id))
  })

  it('registra modificaciones como nueva versión de la propuesta', async () => {
    const service = createDemoService({ delayMs: 0 })
    const dataset = await service.loadDemoDataset()
    const project = await service.createProject({ name: 'Proyecto demo', datasetId: dataset.id })
    await service.sendMessage(project.id, { content: 'resumen general' })
    const v1 = await service.sendMessage(project.id, { content: 'sí' })
    const v2 = await service.sendMessage(project.id, { content: 'Agregar comparación por región' })
    expect(v2.proposal?.version).toBe((v1.proposal?.version ?? 0) + 1)
    expect(v2.proposal?.requestedChanges).toEqual(['Agregar comparación por región'])
    await expect(service.approveProposal(project.id, v1.proposal!.id)).rejects.toThrow(/vigente/)
  })

  it('no inventa resultados para archivos propios', async () => {
    const service = createDemoService({ delayMs: 0 })
    const file = new File(['zona,monto\nNorte,10\nSur,20\nNorte,5\n'], 'mis_datos.csv', { type: 'text/csv' })
    const dataset = await service.uploadDataset(file)
    const profile = await service.getDatasetProfile(dataset.id)
    expect(profile.columns.map((c) => c.name)).toEqual(['zona', 'monto'])

    const project = await service.createProject({ name: 'Mis datos', datasetId: dataset.id })
    await service.sendMessage(project.id, { content: 'quiero comparar zonas' })
    const reply = await service.sendMessage(project.id, { content: 'sí' })
    await service.approveProposal(project.id, reply.proposal!.id)
    const run = await service.runAnalysis(project.id)
    expect(run.status).toBe('queued')

    const results = await service.getResults(project.id)
    expect(results.status).toBe('pending_backend')
    expect(results.charts).toHaveLength(0)
    expect(results.indicators).toHaveLength(0)
  })

  it('rechaza archivos PDF y la exportación indica que requiere backend', async () => {
    const service = createDemoService({ delayMs: 0 })
    await expect(service.uploadDataset(new File(['%PDF'], 'informe.pdf'))).rejects.toThrow(/PDF/)

    const dataset = await service.loadDemoDataset()
    const project = await service.createProject({ name: 'Proyecto demo', datasetId: dataset.id })
    for (const format of ['pdf', 'xlsx', 'docx', 'canva'] as const) {
      const error = await service.exportAnalysis(project.id, { ...exportRequest, format }).catch((e: unknown) => e)
      expect(isBackendRequiredError(error)).toBe(true)
    }
  })
})
