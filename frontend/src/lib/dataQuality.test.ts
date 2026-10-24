import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { DatasetProfile } from '@/types/domain'
import { adaptBackendProfile, type BackendProfileResponse } from '@/services/backendProfile'
import { buildProposal, classifyColumns } from '@/mocks/demoAssistant'
import { buildLocalCsvProfile, inferColumnType, SUSPECTED_MISSING_TOKENS } from './csv'
import { formatCompleteness, getCompleteness, getSuspectedMissingCells } from './profileMetrics'

/** Respuesta sintética con la forma de `profile_dataset` (columnas tipo comercio exterior). */
const tradeResponse: BackendProfileResponse = {
  filename: 'importaciones.csv',
  format: 'csv',
  encoding: 'utf-8-sig',
  sheet_name: null,
  row_count: 1000,
  column_count: 4,
  duplicate_rows: 0,
  total_cells: 4000,
  empty_cells: 3,
  suspected_missing_cells: 40,
  completeness: 0.99925,
  columns: [
    { name: 'ANYO', missing: 0, non_empty: 1000, distinct: 5, examples: ['2020', '2021'], suspected_missing: 0, value_kind: 'numeric', semantic_type: 'temporal', semantic_confidence: 'high', semantic_reason: 'El nombre indica un año.' },
    { name: 'PPRO', missing: 0, non_empty: 1000, distinct: 40, examples: ['26030000'], suspected_missing: 0, value_kind: 'numeric', semantic_type: 'identifier', semantic_confidence: 'medium', semantic_reason: 'Enteros de longitud fija (8 dígitos).' },
    { name: 'CIF', missing: 3, non_empty: 997, distinct: 990, examples: ['1500.50'], suspected_missing: 0, value_kind: 'numeric', semantic_type: 'quantitative', semantic_confidence: 'high', semantic_reason: 'Valores numéricos con decimales.' },
    { name: 'PAIS', missing: 0, non_empty: 1000, distinct: 4, examples: ['AR', 'NA'], suspected_missing: 40, suspected_missing_values: { NA: 40 }, value_kind: 'text', semantic_type: 'categorical', semantic_confidence: 'medium', semantic_reason: 'Texto con 3 valores distintos.' },
  ],
  preview: [{ ANYO: '2020', PPRO: '26030000', CIF: '1500.50', PAIS: 'NA' }],
  warnings: ["La columna 'PAIS' tiene 40 valores como 'NA' que podrían indicar ausencia; no se cuentan como faltantes porque pueden ser valores válidos."],
}

describe('política de valores faltantes', () => {
  it('en el navegador, solo la celda vacía es faltante y "NA" queda como sospechoso', () => {
    const csv = 'pais,valor\nAR,10\nNA,\nN/A,null\n,-\nBR,20\n'
    const profile = buildLocalCsvProfile(csv, { datasetId: 'x', isSample: false })
    const [pais, valor] = profile.columns

    expect(pais).toMatchObject({ nullCount: 1, suspectedMissingCount: 2 })
    expect(valor).toMatchObject({ nullCount: 1, suspectedMissingCount: 2, inferredType: 'numeric' })
    expect(profile.previewRows[1].pais).toBe('NA') // el dato no se modifica
    expect(profile.issues.some((i) => i.column === 'pais' && i.message.includes('podrían indicar ausencia'))).toBe(true)
  })

  it('los marcadores no alteran el formato inferido', () => {
    expect(inferColumnType(['10.5', 'NA', '7', '-'])).toBe('numeric')
    expect(inferColumnType(['NA', 'null'])).toBe('unknown')
  })

  it('usa los mismos marcadores que el backend', () => {
    const python = readFileSync(
      // Vitest se ejecuta desde frontend/.
      resolve(process.cwd(), '../backend/app/services/column_semantics.py'),
      'utf-8',
    )
    const block = /SUSPECTED_MISSING_TOKENS = frozenset\(\{([\s\S]*?)\}\)/.exec(python)?.[1] ?? ''
    const backendTokens = [...block.matchAll(/"([^"]*)"/g)].map((m) => m[1]).sort()
    expect(backendTokens.length).toBeGreaterThan(0)
    expect([...SUSPECTED_MISSING_TOKENS].sort()).toEqual(backendTokens)
  })
})

describe('perfil del backend como fuente autorizada', () => {
  const profile = adaptBackendProfile(tradeResponse, 'ds_1')

  it('conserva tipo semántico, confianza y motivo de cada columna', () => {
    expect(profile.columns.map((c) => [c.name, c.semanticType, c.semanticConfidence])).toEqual([
      ['ANYO', 'temporal', 'high'],
      ['PPRO', 'identifier', 'medium'],
      ['CIF', 'quantitative', 'high'],
      ['PAIS', 'categorical', 'medium'],
    ])
    expect(profile.columns[1].semanticReason).toMatch(/longitud fija/)
    // El formato viene del backend (todas las filas), no de los ejemplos.
    expect(profile.columns.map((c) => c.inferredType)).toEqual(['numeric', 'numeric', 'numeric', 'text'])
  })

  it('usa la completitud y los sospechosos informados por el backend', () => {
    expect(getCompleteness(profile)).toBe(0.99925)
    expect(getSuspectedMissingCells(profile)).toBe(40)
    expect(formatCompleteness(0.99925)).toMatch(/^99,9\s?%$/)
  })

  it('nunca muestra 100 % si falta alguna celda', () => {
    expect(formatCompleteness(0.99999)).not.toMatch(/^100/)
    expect(formatCompleteness(1)).toMatch(/^100\s?%$/)
  })

  it('tolera respuestas de versiones previas sin campos semánticos', () => {
    const { columns } = adaptBackendProfile(
      { ...tradeResponse, completeness: undefined, columns: [{ name: 'monto', missing: 1, non_empty: 9, distinct: 9, examples: ['10', '20'] }], preview: [{ monto: '10' }] },
      'ds_2',
    )
    expect(columns[0]).toMatchObject({ inferredType: 'numeric', semanticType: undefined })
  })
})

describe('asistente DEMO con tipos semánticos', () => {
  const profile: DatasetProfile = adaptBackendProfile(tradeResponse, 'ds_1')

  it('no trata códigos ni años como cantidades', () => {
    const { numeric, dates, categorical } = classifyColumns(profile)
    expect(numeric.map((c) => c.name)).toEqual(['CIF'])
    expect(dates.map((c) => c.name)).toEqual(['ANYO'])
    expect(categorical.map((c) => c.name)).toEqual(['PAIS'])
  })

  it('la propuesta no suma ni promedia códigos', () => {
    const proposal = buildProposal({
      projectId: 'p',
      dataset: { id: 'ds_1', name: 'importaciones', fileName: 'importaciones.csv', format: 'csv', sizeBytes: 1, uploadedAt: '', source: 'upload', status: 'ready' },
      profile,
      intent: 'general',
      objectiveText: '',
      version: 1,
      requestedChanges: [],
      proposalId: 'prop',
    })
    const text = JSON.stringify([proposal.indicators, proposal.charts])
    expect(text).not.toMatch(/promedio de «PPRO»|promedio de «ANYO»/)
    expect(text).toMatch(/«CIF»/)
  })
})
