import type { CanvaFileType, ExportFormat, ExportRequest } from '@/types/domain'

/** Catálogo de formatos de exportación que ofrece el workspace. */
export interface ExportFormatOption {
  format: ExportFormat
  label: string
  extensionLabel: string
  description: string
  contents: string[]
}

export const EXPORT_FORMATS: ExportFormatOption[] = [
  {
    format: 'pdf',
    label: 'PDF',
    extensionLabel: '.pdf',
    description: 'Informe completo, listo para compartir o imprimir.',
    contents: ['Gráficos', 'Conclusiones', 'Fuentes de datos'],
  },
  {
    format: 'xlsx',
    label: 'Excel',
    extensionLabel: '.xlsx',
    description: 'Datos procesados para seguir trabajando en planillas.',
    contents: ['Datos procesados', 'Indicadores', 'Tablas de resultados'],
  },
  {
    format: 'docx',
    label: 'Word',
    extensionLabel: '.docx',
    description: 'Informe editable para ajustar textos y estructura.',
    contents: ['Gráficos', 'Análisis', 'Texto editable'],
  },
  {
    format: 'canva',
    label: 'Canva',
    extensionLabel: '.pdf / .pptx',
    description: 'Archivo compatible con Canva para personalizar el diseño.',
    contents: ['Diseño personalizable', 'Gráficos', 'Resumen visual'],
  },
]

export const CANVA_FILE_TYPES: Array<{ value: CanvaFileType; label: string }> = [
  { value: 'pptx', label: 'Presentación (.pptx)' },
  { value: 'pdf', label: 'Documento (.pdf)' },
]

export function getExportOption(format: ExportFormat): ExportFormatOption {
  const option = EXPORT_FORMATS.find((o) => o.format === format)
  if (!option) throw new Error(`Formato de exportación desconocido: ${format}`)
  return option
}

/** Extensión del archivo final según el formato elegido. */
export function getExportExtension(request: Pick<ExportRequest, 'format' | 'canvaFileType'>): string {
  if (request.format === 'canva') return request.canvaFileType ?? 'pptx'
  return request.format
}
