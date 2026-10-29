import type { jsPDF as JsPDF } from 'jspdf'
import { seriesColor } from '@/lib/chartColors'
import { formatMeasure, measureHeader, METHODOLOGY_TEXT, splitVerified, unverifiedItems, type ReportDocument } from '@/lib/report'
import type { AIInterpretation } from '@/services/aiGateway'

/**
 * PDF del informe (Fase 4C), generado en el navegador con jsPDF: sin servidor de
 * documentos ni infraestructura nueva, y sin enviar los resultados a otro sitio.
 * Usa el mismo `ReportDocument` de la vista previa y las imágenes de SUS gráficos
 * (los SVG de Recharts convertidos a PNG): se descarga lo que se revisó.
 */

export interface ChartImage {
  dataUrl: string
  /** Proporción alto / ancho del gráfico original. */
  ratio: number
}

const PAGE = { width: 210, height: 297, margin: 16 }
const CONTENT = PAGE.width - PAGE.margin * 2
const BOTTOM = PAGE.height - PAGE.margin - 8
const MAX_TABLE_ROWS = 25
const INK: [number, number, number] = [15, 23, 42]
const MUTED: [number, number, number] = [100, 116, 139]
const ACCENT: [number, number, number] = [29, 78, 216]
const WARN: [number, number, number] = [146, 64, 14]

const dateTime = new Intl.DateTimeFormat('es-AR', { dateStyle: 'long', timeStyle: 'short' })

/** Las fuentes estándar de PDF cubren Latin-1: se reemplaza la tipografía que no entra. */
export function pdfText(text: string): string {
  return text
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[–—−]/g, '-')
    .replace(/…/g, '...')
    .replace(/•/g, '·')
    .replace(/≥/g, '>=')
    .replace(/≤/g, '<=')
    .replace(/→/g, '->')
    .replace(/€/g, 'EUR')
    .replace(/[^\n -ÿ]/g, '')
}

class Writer {
  y = PAGE.margin

  constructor(readonly doc: JsPDF) {}

  ensure(height: number) {
    if (this.y + height > BOTTOM) {
      this.doc.addPage()
      this.y = PAGE.margin
    }
  }

  text(value: string, opts: { size?: number; bold?: boolean; color?: [number, number, number]; indent?: number; gap?: number } = {}) {
    const { size = 10, bold = false, color = INK, indent = 0, gap = 1.5 } = opts
    const doc = this.doc
    doc.setFont('helvetica', bold ? 'bold' : 'normal')
    doc.setFontSize(size)
    doc.setTextColor(...color)
    const lineHeight = size * 0.3528 * 1.35
    for (const line of doc.splitTextToSize(pdfText(value), CONTENT - indent) as string[]) {
      this.ensure(lineHeight)
      doc.text(line, PAGE.margin + indent, this.y + lineHeight * 0.75)
      this.y += lineHeight
    }
    this.y += gap
  }

  heading(value: string, level: 1 | 2 | 3 = 1) {
    const size = level === 1 ? 14 : level === 2 ? 12 : 10.5
    this.ensure(14)
    this.y += level === 1 ? 4 : 2
    this.text(value, { size, bold: true, color: level === 1 ? ACCENT : INK, gap: level === 1 ? 2 : 1 })
    if (level === 1) {
      this.doc.setDrawColor(203, 213, 225)
      this.doc.line(PAGE.margin, this.y - 1, PAGE.margin + CONTENT, this.y - 1)
      this.y += 2
    }
  }

  bullets(items: string[], opts: { color?: [number, number, number] } = {}) {
    for (const item of items) this.text(`- ${item}`, { indent: 3, gap: 0.8, color: opts.color })
    this.y += 1
  }

  table(header: string[], rows: string[][], widths?: number[]) {
    const doc = this.doc
    const cols = header.length
    const w = widths ?? header.map(() => CONTENT / cols)
    const size = 8
    const lineHeight = size * 0.3528 * 1.3
    const drawRow = (cells: string[], bold: boolean, fill: boolean) => {
      doc.setFont('helvetica', bold ? 'bold' : 'normal')
      doc.setFontSize(size)
      const wrapped = cells.map((c, i) => (doc.splitTextToSize(pdfText(c), w[i] - 2) as string[]).slice(0, 3))
      const height = Math.max(...wrapped.map((l) => l.length)) * lineHeight + 2
      if (this.y + height > BOTTOM) {
        doc.addPage()
        this.y = PAGE.margin
        if (!bold) drawRow(header, true, true)
      }
      if (fill) {
        doc.setFillColor(241, 245, 249)
        doc.rect(PAGE.margin, this.y, CONTENT, height, 'F')
      }
      doc.setTextColor(...INK)
      let x = PAGE.margin
      wrapped.forEach((lines, i) => {
        lines.forEach((line, j) => doc.text(line, x + 1, this.y + 1 + lineHeight * (j + 0.8)))
        x += w[i]
      })
      doc.setDrawColor(226, 232, 240)
      doc.line(PAGE.margin, this.y + height, PAGE.margin + CONTENT, this.y + height)
      this.y += height
    }
    drawRow(header, true, true)
    rows.forEach((r) => drawRow(r, false, false))
    this.y += 3
  }

  static imageHeight(image: ChartImage) {
    return Math.min(CONTENT * image.ratio, 110)
  }

  image(image: ChartImage) {
    const height = Writer.imageHeight(image)
    const width = height / image.ratio
    this.ensure(height + 2)
    this.doc.addImage(image.dataUrl, 'PNG', PAGE.margin + (CONTENT - width) / 2, this.y, width, height)
    this.y += height + 2
  }

  legend(labels: string[]) {
    if (labels.length < 2) return
    const doc = this.doc
    doc.setFontSize(8)
    let x = PAGE.margin
    this.ensure(6)
    labels.forEach((label, i) => {
      const text = pdfText(label)
      const width = doc.getTextWidth(text) + 8
      if (x + width > PAGE.margin + CONTENT) {
        x = PAGE.margin
        this.y += 4.5
        this.ensure(5)
      }
      doc.setFillColor(seriesColor(i))
      doc.rect(x, this.y + 0.6, 3, 2, 'F')
      doc.setTextColor(...MUTED)
      doc.text(text, x + 4, this.y + 2.5)
      x += width
    })
    this.y += 6
  }
}

/** Solo las afirmaciones con cifras recalculadas sobre los resultados. */
function items(writer: Writer, title: string, interpretation: AIInterpretation, section: 'executive_summary' | 'findings' | 'trends' | 'recommendations') {
  const values = splitVerified(interpretation, section).verified
  if (!values.length) return
  writer.heading(title, 3)
  writer.bullets(values.map((v) => `${v.text} [${v.evidence.join(', ')}]`))
}

/** Construye el documento (sin descargarlo). `charts`: imágenes por id de gráfico. */
export async function createReportPdf(
  report: ReportDocument,
  charts: Map<string, ChartImage> = new Map(),
  /** false solo en las pruebas, para poder leer el texto del documento. */
  { compress = true }: { compress?: boolean } = {},
): Promise<JsPDF> {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress })
  doc.setProperties({ title: pdfText(`${report.title} · ${report.projectName}`), creator: 'DataDecision AI' })
  const w = new Writer(doc)

  // 1. Portada: título y fechas
  w.text('DataDecision AI', { size: 9, bold: true, color: ACCENT, gap: 1 })
  w.text(report.title, { size: 18, bold: true, gap: 1 })
  w.text(report.projectName, { size: 12, color: MUTED })
  w.text(`Generado el ${dateTime.format(report.generatedAt)} · resultados calculados el ${dateTime.format(new Date(report.executedAt))}`, {
    size: 9,
    color: MUTED,
  })
  const status = { complete: 'Análisis completo', partial: 'Análisis parcial: algunas operaciones no se pudieron calcular', empty: 'Sin resultados' }
  w.text(status[report.status], { size: 9, bold: true, color: report.status === 'complete' ? INK : WARN })

  // 2. Objetivo
  w.heading('Objetivo del análisis')
  w.text(report.objective ?? 'No se registró un objetivo para esta ejecución.')

  // 2b. Resumen ejecutivo descriptivo (sin IA)
  w.heading('Resumen ejecutivo (descriptivo, calculado sin IA)')
  if (report.summary?.executive.length) w.bullets(report.summary.executive)
  else w.text('El backend no informó un resumen descriptivo para esta ejecución.', { color: MUTED })

  // 3. Fuentes
  w.heading('Fuentes de datos')
  w.table(
    ['Fuente', 'Archivo', 'Registros', 'Columnas'],
    report.sources.map((s) => [s.alias, s.fileName ?? '—', s.rows.toLocaleString('es-AR'), String(s.columns)]),
    [20, CONTENT - 80, 30, 30],
  )

  // 4. Metodología
  w.heading('Operaciones y metodología')
  w.text(METHODOLOGY_TEXT, { size: 9 })
  w.table(
    ['Ref.', 'Plan', 'Operación', 'Columnas', 'Filas', 'Estado'],
    report.methodology.map((m) => [
      m.ref,
      m.plan,
      m.operation,
      m.columns,
      m.rowsUsed === null ? '—' : m.rowsUsed.toLocaleString('es-AR'),
      m.status === 'ok' ? 'Calculada' : `Falló: ${m.error ?? ''}`,
    ]),
    [14, 32, 46, 40, 16, CONTENT - 148],
  )

  // 5. Indicadores, gráficos y tablas
  w.heading('Resultados')
  for (const plan of report.plans) {
    w.heading(`${plan.title} · fuente ${plan.sourceAlias}`, 2)
    if (plan.kpis.length) {
      w.table(['Indicador', 'Valor', 'Operación'], plan.kpis.map((k) => [
        k.label,
        `${k.value.toLocaleString('es-AR', { maximumFractionDigits: 2 })}${k.unit ? ` ${k.unit}` : ''}`,
        k.description,
      ]))
    }
    for (const { chart, note } of plan.charts) {
      const image = charts.get(chart.id)
      // El título, la descripción y la imagen van juntos: no se deja un título solo al pie de una página.
      w.ensure((image ? Writer.imageHeight(image) : 10) + 16)
      w.heading(chart.title, 3)
      if (chart.description) w.text(chart.description, { size: 8, color: MUTED, gap: 1 })
      if (image) {
        w.image(image)
        w.legend(chart.series.map((s) => s.label))
      } else {
        w.text('No se pudo convertir este gráfico en imagen: sus valores están en la tabla de la operación.', { size: 8, color: WARN })
      }
      if (note) w.text(note, { size: 8, color: MUTED })
    }
    for (const { ref, op } of plan.tables) {
      w.heading(`${ref} · ${op.description && op.description !== '—' ? op.description : op.operation}`, 3)
      if (op.operation === 'scatter' || op.operation === 'roc_curve') {
        const stats = Object.entries(op.stats ?? {}).filter(([k]) => ['pearson', 'spearman', 'n', 'auc', 'positives', 'negatives'].includes(k))
        w.text(stats.map(([k, v]) => `${k}: ${typeof v === 'number' ? v.toLocaleString('es-AR', { maximumFractionDigits: 4 }) : String(v)}`).join(' · '), { size: 9 })
        w.text('Los puntos individuales se muestran en el gráfico; no se listan en el informe.', { size: 8, color: MUTED })
        continue
      }
      const header = [...op.dimensions, ...op.measures.map((m) => measureHeader(m, op))]
      const rows = op.rows.slice(0, MAX_TABLE_ROWS).map((r) => [...r.keys, ...r.values.map((v, i) => formatMeasure(v, op.measures[i]))])
      w.table(header, rows)
      if (op.rows.length > MAX_TABLE_ROWS) {
        w.text(`Se listan ${MAX_TABLE_ROWS} de ${op.rows.length} filas; la tabla completa está en la aplicación.`, { size: 8, color: MUTED })
      }
    }
    if (plan.errors.length) {
      w.text('Operaciones que no se pudieron calcular (no se extraen conclusiones de ellas):', { size: 9, bold: true, color: WARN })
      w.bullets(plan.errors.map((e) => `${e.title}: ${e.message}`), { color: WARN })
    }
  }

  // 6. Interpretación disponible
  w.heading('Interpretación')
  w.heading('Hallazgos calculados (resumen descriptivo con Pandas, sin IA)', 2)
  if (report.summary) {
    for (const item of report.summary.items) {
      w.text(`${item.ref} · ${item.title}`, { size: 9.5, bold: true, gap: 0.5 })
      if (item.status === 'error') w.text(`No se pudo calcular: ${item.error ?? ''}`, { size: 9, color: WARN, indent: 3 })
      else w.bullets(item.facts.length ? item.facts : ['Sin hechos destacados para esta operación.'])
    }
    w.text(report.summary.notes.join(' '), { size: 8, color: MUTED })
  } else {
    w.text('El backend no informó un resumen descriptivo para esta ejecución.', { color: MUTED })
  }

  const ai = report.interpretation
  w.heading('Interpretación con IA', 2)
  if (!ai) {
    w.text('No se incluyó una interpretación con IA. Este informe contiene solo el resumen descriptivo calculado, sin intervención de la IA.', {
      color: MUTED,
    })
  } else {
    w.text(
      `Redactada por la IA (${ai.usage.model}) a partir de los resultados agregados que la persona autorizó. ` +
        'Cada cifra se recalculó sobre los resultados de Pandas (operación, categoría, período y unidad); se descartaron las que no coincidían, ' +
        'las atribuciones a otra categoría o período y las afirmaciones causales. Entre corchetes, las operaciones que respaldan cada afirmación.',
      { size: 8, color: MUTED },
    )
    items(w, 'Resumen ejecutivo (verificado)', ai.interpretation, 'executive_summary')
    items(w, 'Hallazgos respaldados por los cálculos', ai.interpretation, 'findings')
    items(w, 'Tendencias y comparaciones', ai.interpretation, 'trends')
    items(w, 'Recomendaciones y líneas de análisis', ai.interpretation, 'recommendations')
    const unverified = unverifiedItems(ai.interpretation)
    if (unverified.length) {
      w.heading('No verificadas automáticamente (sin cifras)', 3)
      w.bullets(unverified.map(({ section, item }) => `${section}: ${item.text} [${item.evidence.join(', ')}]`), { color: WARN })
    }
    if (ai.interpretation.data_quality.length) {
      w.heading('Calidad de los datos', 3)
      w.bullets(ai.interpretation.data_quality)
    }
    if (ai.interpretation.limitations.length) {
      w.heading('Limitaciones señaladas por la IA', 3)
      w.bullets(ai.interpretation.limitations)
    }
    if (ai.notes.length) {
      w.heading('Verificación automática de la interpretación', 3)
      w.bullets(ai.notes, { color: MUTED })
    }
  }

  // 7. Advertencias y limitaciones
  w.heading('Advertencias y limitaciones')
  w.bullets([...report.warnings, ...report.engineNotes])

  // Pie de página en todas las hojas
  const pages = doc.getNumberOfPages()
  for (let i = 1; i <= pages; i += 1) {
    doc.setPage(i)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.setTextColor(...MUTED)
    doc.text(pdfText(`DataDecision AI · ${report.projectName}`), PAGE.margin, PAGE.height - 8)
    doc.text(`Página ${i} de ${pages}`, PAGE.width - PAGE.margin, PAGE.height - 8, { align: 'right' })
  }
  return doc
}

/** Convierte el SVG de un gráfico de Recharts en PNG (fondo blanco, doble resolución). */
async function svgToPng(svg: SVGSVGElement): Promise<ChartImage | null> {
  const box = svg.getBoundingClientRect()
  const width = box.width || Number(svg.getAttribute('width')) || 0
  const height = box.height || Number(svg.getAttribute('height')) || 0
  if (!width || !height) return null
  const clone = svg.cloneNode(true) as SVGSVGElement
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  clone.setAttribute('width', String(width))
  clone.setAttribute('height', String(height))
  clone.setAttribute('style', 'font-family: Helvetica, Arial, sans-serif; background: #fff')
  const source = new XMLSerializer().serializeToString(clone)
  const image = new Image()
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve()
    image.onerror = () => reject(new Error('No se pudo leer el gráfico.'))
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`
  })
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(width * 2)
  canvas.height = Math.round(height * 2)
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
  return { dataUrl: canvas.toDataURL('image/png'), ratio: height / width }
}

/** Imágenes de los gráficos de la vista previa (elementos con `data-report-chart`). */
export async function captureCharts(container: HTMLElement): Promise<{ images: Map<string, ChartImage>; failed: number }> {
  const images = new Map<string, ChartImage>()
  let failed = 0
  for (const node of container.querySelectorAll<HTMLElement>('[data-report-chart]')) {
    const svg = node.querySelector<SVGSVGElement>('svg.recharts-surface')
    try {
      const image = svg ? await svgToPng(svg) : null
      if (image) images.set(node.dataset.reportChart ?? '', image)
      else failed += 1
    } catch {
      failed += 1
    }
  }
  return { images, failed }
}

export function reportFileName(report: ReportDocument): string {
  const base = report.projectName
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
  return `informe-${base || 'analisis'}-${report.generatedAt.toISOString().slice(0, 10)}.pdf`
}

/** Captura los gráficos de la vista previa, arma el PDF y lo descarga. */
export async function downloadReportPdf(report: ReportDocument, preview: HTMLElement): Promise<{ missingCharts: number }> {
  const { images, failed } = await captureCharts(preview)
  const doc = await createReportPdf(report, images)
  doc.save(reportFileName(report))
  return { missingCharts: failed }
}
