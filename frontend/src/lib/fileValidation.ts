import type { DatasetFormat } from '@/types/domain'

/**
 * Validación PRELIMINAR del archivo en el navegador.
 * El backend realizará la validación definitiva (contenido, codificación, estructura).
 */

export type FileValidationResult =
  | { ok: true; format: DatasetFormat }
  | { ok: false; error: string }

const EXTENSION_FORMATS: Record<string, DatasetFormat> = {
  csv: 'csv',
  xlsx: 'xlsx',
}

export const ACCEPTED_EXTENSIONS = Object.keys(EXTENSION_FORMATS).map((ext) => `.${ext}`)

/** Valor para el atributo `accept` del input de archivos. */
export const ACCEPT_ATTRIBUTE = [
  ...ACCEPTED_EXTENSIONS,
  'text/csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
].join(',')

export function getExtension(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  return dot === -1 ? '' : fileName.slice(dot + 1).toLowerCase()
}

export function validateDatasetFile(
  file: Pick<File, 'name' | 'size'>,
  maxSizeMb: number,
): FileValidationResult {
  const extension = getExtension(file.name)

  if (extension === '') {
    return { ok: false, error: 'El archivo no tiene extensión. Usá un archivo .csv o .xlsx.' }
  }

  if (extension === 'pdf') {
    return {
      ok: false,
      error:
        'Los archivos PDF no son compatibles. Exportá tus datos como tabla en formato CSV o Excel (.xlsx).',
    }
  }

  if (extension === 'xls') {
    return {
      ok: false,
      error: 'El formato .xls (Excel antiguo) no es compatible. Guardá el archivo como .xlsx o .csv.',
    }
  }

  const format = EXTENSION_FORMATS[extension]
  if (!format) {
    return {
      ok: false,
      error: `El formato .${extension} no es compatible. Solo se aceptan archivos CSV y Excel (.xlsx).`,
    }
  }

  if (file.size === 0) {
    return { ok: false, error: 'El archivo está vacío.' }
  }

  const maxBytes = maxSizeMb * 1024 * 1024
  if (file.size > maxBytes) {
    return {
      ok: false,
      error: `El archivo supera el tamaño máximo permitido de ${maxSizeMb} MB.`,
    }
  }

  return { ok: true, format }
}
