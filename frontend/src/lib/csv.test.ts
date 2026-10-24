import { buildLocalCsvProfile, detectDelimiter, inferColumnType, parseCsv } from './csv'

describe('detectDelimiter', () => {
  it('detecta coma, punto y coma y tabulación', () => {
    expect(detectDelimiter('a,b,c\n1,2,3')).toBe(',')
    expect(detectDelimiter('a;b;c\n1;2;3')).toBe(';')
    expect(detectDelimiter('a\tb\n1\t2')).toBe('\t')
  })

  it('ignora separadores dentro de comillas', () => {
    expect(detectDelimiter('"x;y";b,c\n')).toBe(',')
  })
})

describe('parseCsv', () => {
  it('respeta comillas, comillas escapadas y saltos de línea internos', () => {
    const rows = parseCsv('nombre,nota\n"Pérez, Ana","dijo ""hola"""\n"línea\ndoble",3\n')
    expect(rows).toEqual([
      ['nombre', 'nota'],
      ['Pérez, Ana', 'dijo "hola"'],
      ['línea\ndoble', '3'],
    ])
  })

  it('quita el BOM y descarta filas vacías', () => {
    expect(parseCsv('﻿a;b\r\n1;2\r\n\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })
})

describe('inferColumnType', () => {
  it('infiere tipos básicos', () => {
    expect(inferColumnType(['1', '2,5', '1.200', ''])).toBe('numeric')
    expect(inferColumnType(['2025-01-01', '2025-02-15'])).toBe('date')
    expect(inferColumnType(['sí', 'no', 'Sí'])).toBe('boolean')
    expect(inferColumnType(['Norte', 'Sur'])).toBe('text')
    expect(inferColumnType(['', 'NA'])).toBe('unknown')
  })
})

describe('buildLocalCsvProfile', () => {
  it('usa solo las columnas reales del archivo y reporta problemas', () => {
    const csv = 'curso,alumno,nota\n1A,Ana,8\n1A,Luis,\n1B,Sofía,9\n1B,Juan,\n'
    const profile = buildLocalCsvProfile(csv, { datasetId: 'ds_1', isSample: false })

    expect(profile.origin).toBe('local-preview')
    expect(profile.isComplete).toBe(false)
    expect(profile.rowCount).toBe(4)
    expect(profile.columns.map((c) => c.name)).toEqual(['curso', 'alumno', 'nota'])
    expect(profile.columns[2]).toMatchObject({ inferredType: 'numeric', nullCount: 2, nonNullCount: 2 })
    expect(profile.previewRows[0]).toEqual({ curso: '1A', alumno: 'Ana', nota: '8' })
    expect(profile.issues.some((i) => i.column === 'nota' && i.severity === 'warning')).toBe(true)
  })

  it('nombra encabezados vacíos y avisa filas irregulares', () => {
    const profile = buildLocalCsvProfile('a,,c\n1,2,3\n4,5\n', { datasetId: 'x', isSample: false })
    expect(profile.columns[1].name).toBe('columna_2')
    expect(profile.issues.some((i) => i.message.includes('cantidad de valores distinta'))).toBe(true)
  })

  it('devuelve un error si no hay filas', () => {
    const profile = buildLocalCsvProfile('', { datasetId: 'x', isSample: false })
    expect(profile.columnCount).toBe(0)
    expect(profile.issues[0].severity).toBe('error')
  })
})
