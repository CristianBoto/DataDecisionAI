import type { Dataset } from '@/types/domain'
import { buildLocalCsvProfile } from '@/lib/csv'
import { buildProposal, detectIntent, replyToObjective } from './demoAssistant'
import { createDemoDataset, createDemoProfile } from './demoDataset'

const uploaded: Dataset = {
  id: 'ds_up',
  name: 'notas',
  fileName: 'notas.csv',
  format: 'csv',
  sizeBytes: 100,
  uploadedAt: new Date().toISOString(),
  source: 'upload',
  status: 'ready',
}

describe('asistente DEMO', () => {
  it('detecta la intención por palabras clave', () => {
    expect(detectIntent('Quiero saber si debería comprar más mercadería')).toBe('restock')
    expect(detectIntent('¿Cómo vienen las ventas?')).toBe('sales')
    expect(detectIntent('Dame un panorama')).toBe('general')
  })

  it('pide información de stock cuando falta, sin inventarla', () => {
    const { reply } = replyToObjective('Quiero reponer mercadería', createDemoDataset(), createDemoProfile())
    expect(reply.kind).toBe('question')
    expect(reply.content).toMatch(/stock actual/)
    expect(reply.producesProposal).toBe(false)
  })

  it('arma propuestas solo con columnas existentes del archivo', () => {
    const profile = buildLocalCsvProfile('fecha,curso,nota\n2025-03-01,1A,8\n2025-03-02,1B,6\n2025-03-03,1A,7\n', {
      datasetId: uploaded.id,
      isSample: false,
    })
    const proposal = buildProposal({
      projectId: 'p',
      dataset: uploaded,
      profile,
      intent: 'general',
      objectiveText: 'Ver rendimiento',
      version: 1,
      requestedChanges: [],
      proposalId: 'prop',
    })
    const real = new Set(profile.columns.map((c) => c.name))
    expect(proposal.requiredData.every((c) => real.has(c))).toBe(true)
    expect(proposal.charts.some((c) => c.type === 'line')).toBe(true)
    expect(proposal.feasibility).toBe('viable')
    expect(proposal.isDemo).toBe(true)
  })

  it('marca como insuficiente un Excel sin columnas legibles', () => {
    const proposal = buildProposal({
      projectId: 'p',
      dataset: { ...uploaded, format: 'xlsx' },
      profile: { ...createDemoProfile(), origin: 'local-preview', columns: [], columnCount: 0, rowCount: null },
      intent: 'general',
      objectiveText: '',
      version: 1,
      requestedChanges: [],
      proposalId: 'prop',
    })
    expect(proposal.feasibility).toBe('insufficient')
    expect(proposal.indicators).toHaveLength(0)
  })
})
