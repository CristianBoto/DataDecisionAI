import type { ColumnProfile, ColumnType, DataQualityIssue, DatasetProfile } from '@/types/domain'

/**
 * Lectura LOCAL y PRELIMINAR de archivos CSV en el navegador.
 *
 * Solo se usa para mostrar una vista previa rápida. El perfilado definitivo
 * (tipos, nulos, duplicados, codificación) lo hará el backend con Pandas.
 */

export type CsvDelimiter = ',' | ';' | '\t' | '|'

const CANDIDATE_DELIMITERS: CsvDelimiter[] = [',', ';', '\t', '|']

/** Detecta el separador más probable mirando la primera línea (fuera de comillas). */
export function detectDelimiter(text: string): CsvDelimiter {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? ''
  let best: CsvDelimiter = ','
  let bestCount = 0
  for (const delimiter of CANDIDATE_DELIMITERS) {
    let count = 0
    let inQuotes = false
    for (const char of firstLine) {
      if (char === '"') inQuotes = !inQuotes
      else if (char === delimiter && !inQuotes) count += 1
    }
    if (count > bestCount) {
      best = delimiter
      bestCount = count
    }
  }
  return best
}

/**
 * Parser CSV sencillo compatible con RFC 4180 (comillas dobles, comillas
 * escapadas y saltos de línea dentro de campos).
 */
export function parseCsv(text: string, delimiter: CsvDelimiter = detectDelimiter(text)): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  // Quita el BOM UTF-8 si existe.
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i]

    if (inQuotes) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"'
          i += 1
        } else {
          inQuotes = false
        }
      } else {
        field += char
      }
      continue
    }

    if (char === '"') {
      inQuotes = true
    } else if (char === delimiter) {
      row.push(field)
      field = ''
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && input[i + 1] === '\n') i += 1
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else {
      field += char
    }
  }

  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }

  // Descarta filas completamente vacías (por ejemplo, salto de línea final).
  return rows.filter((r) => r.some((value) => value.trim() !== ''))
}

/**
 * Política de faltantes, igual a la del backend (`column_semantics.py`):
 * solo la celda vacía es faltante; estos marcadores son *sospechosos* y no se
 * descuentan, porque pueden ser valores válidos ("NA" puede ser Namibia).
 */
export const SUSPECTED_MISSING_TOKENS = new Set([
  'na', 'n/a', 'n.a.', '#n/a', 'nan', 'null', 'none', 'nil', '-', '--', '?', 's/d', 'sin dato', 'sin datos',
])

export function isEmptyValue(value: string): boolean {
  return value.trim() === ''
}

export function isSuspectedMissing(value: string): boolean {
  return SUSPECTED_MISSING_TOKENS.has(value.trim().toLowerCase())
}

const NUMBER_PATTERN = /^[-+]?(\d{1,3}([.,]\d{3})*|\d+)([.,]\d+)?%?$/
const DATE_PATTERN = /^(\d{4}[-/]\d{1,2}([-/]\d{1,2})?|\d{1,2}[-/]\d{1,2}[-/]\d{2,4})([ T]\d{1,2}:\d{2}(:\d{2})?)?$/
const BOOLEAN_TOKENS = new Set(['true', 'false', 'si', 'sí', 'no', 'verdadero', 'falso'])

/** Infiere el formato de una columna ignorando vacíos y marcadores sospechosos. */
export function inferColumnType(values: string[]): ColumnType {
  const present = values.map((v) => v.trim()).filter((v) => !isEmptyValue(v) && !isSuspectedMissing(v))
  if (present.length === 0) return 'unknown'

  const ratio = (predicate: (v: string) => boolean) =>
    present.filter(predicate).length / present.length

  if (ratio((v) => BOOLEAN_TOKENS.has(v.toLowerCase())) >= 0.95) return 'boolean'
  if (ratio((v) => DATE_PATTERN.test(v)) >= 0.9) return 'date'
  if (ratio((v) => NUMBER_PATTERN.test(v.replace(/\s/g, ''))) >= 0.9) return 'numeric'
  return 'text'
}

export interface LocalProfileOptions {
  datasetId: string
  /** true si el texto analizado es solo una parte del archivo. */
  isSample: boolean
  previewRowLimit?: number
}

/** Construye un perfil preliminar a partir del texto CSV leído en el navegador. */
export function buildLocalCsvProfile(text: string, options: LocalProfileOptions): DatasetProfile {
  const { datasetId, isSample, previewRowLimit = 8 } = options
  const rows = parseCsv(text)
  // Si es una muestra, la última fila puede estar cortada: se descarta.
  const usableRows = isSample && rows.length > 2 ? rows.slice(0, -1) : rows
  const issues: DataQualityIssue[] = []

  if (usableRows.length === 0) {
    return {
      datasetId,
      origin: 'local-preview',
      isComplete: false,
      rowCount: 0,
      rowCountIsEstimate: false,
      columnCount: 0,
      columns: [],
      previewRows: [],
      issues: [{ severity: 'error', message: 'No se encontraron filas legibles en el archivo.' }],
      note: 'Vista previa local preliminar. El backend realizará la validación definitiva.',
    }
  }

  const rawHeader = usableRows[0].map((h) => h.trim())
  const header = rawHeader.map((h, index) => (h === '' ? `columna_${index + 1}` : h))
  const dataRows = usableRows.slice(1)

  rawHeader.forEach((h, index) => {
    if (h === '') {
      issues.push({
        severity: 'warning',
        column: header[index],
        message: `La columna ${index + 1} no tiene encabezado; se nombró provisoriamente "${header[index]}".`,
      })
    }
  })

  const seen = new Set<string>()
  header.forEach((h) => {
    if (seen.has(h)) {
      issues.push({ severity: 'warning', column: h, message: `El encabezado "${h}" está repetido.` })
    }
    seen.add(h)
  })

  const irregularRows = dataRows.filter((r) => r.length !== header.length).length
  if (irregularRows > 0) {
    issues.push({
      severity: 'warning',
      message: `${irregularRows} fila(s) tienen una cantidad de valores distinta a la de encabezados.`,
    })
  }

  const columns: ColumnProfile[] = header.map((name, index) => {
    const values = dataRows.map((r) => r[index] ?? '')
    const nullCount = values.filter(isEmptyValue).length
    const nonNull = values.filter((v) => !isEmptyValue(v))
    const suspectedMissingCount = nonNull.filter(isSuspectedMissing).length
    const unique = new Set(nonNull.map((v) => v.trim()))
    const inferredType = inferColumnType(values)

    if (suspectedMissingCount > 0) {
      issues.push({
        severity: 'info',
        column: name,
        message: `"${name}" tiene ${suspectedMissingCount} valor(es) como "NA" o "-" que podrían indicar ausencia; no se cuentan como vacíos.`,
      })
    }

    if (dataRows.length > 0 && nullCount / dataRows.length >= 0.2) {
      issues.push({
        severity: 'warning',
        column: name,
        message: `"${name}" tiene ${Math.round((nullCount / dataRows.length) * 100)} % de valores vacíos en la muestra.`,
      })
    }
    if (inferredType === 'unknown') {
      issues.push({ severity: 'info', column: name, message: `"${name}" no tiene valores en la muestra.` })
    }

    return {
      name,
      inferredType,
      nonNullCount: nonNull.length,
      nullCount,
      suspectedMissingCount,
      uniqueCount: unique.size,
      sampleValues: [...unique].slice(0, 3),
    }
  })

  const previewRows = dataRows.slice(0, previewRowLimit).map((r) =>
    Object.fromEntries(header.map((h, index) => [h, r[index] ?? ''])),
  )

  if (isSample) {
    issues.push({
      severity: 'info',
      message: 'El archivo es grande: la vista previa se calculó sobre una muestra inicial.',
    })
  }

  return {
    datasetId,
    origin: 'local-preview',
    isComplete: false,
    rowCount: dataRows.length,
    rowCountIsEstimate: isSample,
    columnCount: header.length,
    columns,
    previewRows,
    issues,
    note: 'Vista previa local preliminar calculada en tu navegador. El backend realizará el perfilado y la validación definitivos.',
  }
}

/** Bytes que se leen como máximo para la vista previa local. */
export const LOCAL_PREVIEW_MAX_BYTES = 2 * 1024 * 1024

/** Lee un Blob como texto UTF-8, con alternativa para entornos sin `Blob.text()`. */
export function readBlobText(blob: Blob): Promise<string> {
  if (typeof blob.text === 'function') return blob.text()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(new Error('No se pudo leer el archivo.'))
    reader.readAsText(blob, 'utf-8')
  })
}

/** Lee un CSV del usuario (completo o una muestra) y construye su perfil local. */
export async function profileCsvFile(file: File, datasetId: string): Promise<DatasetProfile> {
  const isSample = file.size > LOCAL_PREVIEW_MAX_BYTES
  const blob = isSample ? file.slice(0, LOCAL_PREVIEW_MAX_BYTES) : file
  const text = await readBlobText(blob)
  return buildLocalCsvProfile(text, { datasetId, isSample })
}
