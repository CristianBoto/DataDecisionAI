import type { jsPDF as JsPDF } from 'jspdf'
import { seriesColor } from '@/lib/chartColors'
import { parseObjective } from '@/lib/objectiveMarkdown'
import { defaultPresentation, fitLogo, type PdfPresentation } from '@/lib/pdfCustomization'
import { defaultReportTitle, findingFacts, formatMeasure, measureHeader, METHODOLOGY_TEXT, splitVerified, unverifiedItems, type ReportDocument } from '@/lib/report'
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
/** Líneas por celda: alcanza para los mensajes de error completos sin desbordar la página. */
const MAX_CELL_LINES = 8
const CHART_WIDTH = 150
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

  /** `hanging`: sangría de las líneas siguientes a la primera (ítems de listas). */
  text(value: string, opts: { size?: number; bold?: boolean; color?: [number, number, number]; indent?: number; hanging?: number; gap?: number } = {}) {
    const { size = 10, bold = false, color = INK, indent = 0, hanging = 0, gap = 1.5 } = opts
    const doc = this.doc
    doc.setFont('helvetica', bold ? 'bold' : 'normal')
    doc.setFontSize(size)
    doc.setTextColor(...color)
    const lineHeight = size * 0.3528 * 1.35
    const lines = doc.splitTextToSize(pdfText(value), CONTENT - indent - hanging) as string[]
    lines.forEach((line, i) => {
      this.ensure(lineHeight)
      // Tras un salto de página, la tipografía se restablece (el pie de página la cambia al final).
      doc.setFont('helvetica', bold ? 'bold' : 'normal')
      doc.setFontSize(size)
      doc.setTextColor(...color)
      doc.text(line, PAGE.margin + indent + (i ? hanging : 0), this.y + lineHeight * 0.75)
      this.y += lineHeight
    })
    this.y += gap
  }

  /** `keepWith`: alto (mm) de lo que sigue y debe quedar en la misma página que el título. */
  heading(value: string, level: 1 | 2 | 3 = 1, keepWith = 0) {
    const size = level === 1 ? 14 : level === 2 ? 12 : 10.5
    this.ensure((level === 1 ? 26 : 16) + keepWith)
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
    const measure = (cells: string[], bold: boolean) => {
      doc.setFont('helvetica', bold ? 'bold' : 'normal')
      doc.setFontSize(size)
      const wrapped = cells.map((c, i) => (doc.splitTextToSize(pdfText(c), w[i] - 2) as string[]).slice(0, MAX_CELL_LINES))
      return { wrapped, height: Math.max(...wrapped.map((l) => l.length)) * lineHeight + 2 }
    }
    const drawRow = (cells: string[], bold: boolean, fill: boolean) => {
      const { wrapped, height } = measure(cells, bold)
      if (this.y + height > BOTTOM) {
        doc.addPage()
        this.y = PAGE.margin
        if (!bold) drawRow(header, true, true)
      }
      doc.setFont('helvetica', bold ? 'bold' : 'normal')
      doc.setFontSize(size)
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
    // El encabezado nunca queda solo al pie de una página: se dibuja junto con la primera fila.
    this.ensure(measure(header, true).height + (rows[0] ? measure(rows[0], false).height : 0))
    drawRow(header, true, true)
    rows.forEach((r) => drawRow(r, false, false))
    this.y += 3
  }

  static imageHeight(image: ChartImage) {
    // Ancho máximo menor que el de la página: los textos del gráfico quedan en un tamaño legible.
    return Math.min(CHART_WIDTH * image.ratio, 100)
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

/** Objetivo con formato (encabezados, párrafos y listas): el texto es el original, sin las marcas. */
function objective(w: Writer, text: string | null) {
  if (!text) {
    w.text('No se registró un objetivo para esta ejecución.', { color: MUTED })
    return
  }
  for (const block of parseObjective(text)) {
    if (block.kind === 'heading') w.heading(block.text, 3)
    else if (block.kind === 'paragraph') w.text(block.text, { gap: 2 })
    else {
      for (const item of block.items) w.text(`${item.marker} ${item.text}`, { indent: item.level ? 9 : 3, hanging: 4, gap: 0.8 })
      w.y += 1.5
    }
  }
}

/** Portada: logo, título, institución, autor y fecha, según la personalización. */
function cover(doc: JsPDF, report: ReportDocument, p: PdfPresentation) {
  const w = new Writer(doc)
  if (p.showBrand) {
    doc.setFillColor(...ACCENT)
    doc.rect(0, 0, PAGE.width, 4, 'F')
    w.y = 14
    w.text('DataDecision AI', { size: 10, bold: true, color: ACCENT })
  }
  if (p.logo) {
    const size = fitLogo(p.logo, 60, 28)
    doc.addImage(p.logo.dataUrl, p.logo.format, PAGE.margin, 30, size.width, size.height)
  }
  w.y = 96
  if (p.organization) w.text(p.organization, { size: 12, bold: true, color: MUTED, gap: 3 })
  w.text(p.title, { size: 24, bold: true, gap: 3 })
  doc.setDrawColor(...(p.showBrand ? ACCENT : INK))
  doc.setLineWidth(0.6)
  doc.line(PAGE.margin, w.y, PAGE.margin + 40, w.y)
  doc.setLineWidth(0.2)
  w.y += 6
  w.text(`Proyecto: ${report.projectName}`, { size: 12, color: MUTED, gap: 2 })
  if (p.author) w.text(`Responsable: ${p.author}`, { size: 11, gap: 2 })
  if (p.showDate) {
    w.y += 4
    w.text(`Elaborado el ${dateTime.format(report.generatedAt)}`, { size: 9.5, color: MUTED, gap: 0.5 })
    w.text(`Resultados calculados el ${dateTime.format(new Date(report.executedAt))}`, { size: 9.5, color: MUTED })
  }
  // Pie de la portada en posiciones fijas: nunca pasa a otra página.
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(...(report.scope.tone === 'ok' ? MUTED : WARN))
  const headline = (doc.splitTextToSize(pdfText(report.scope.headline), CONTENT) as string[]).slice(0, 4)
  const lineHeight = 9 * 0.3528 * 1.35
  const bottom = PAGE.height - PAGE.margin - (p.showBrand ? 8 : 0)
  headline.forEach((line, i) => doc.text(line, PAGE.margin, bottom - (headline.length - i) * lineHeight))
  if (p.showBrand) {
    doc.setFontSize(8)
    doc.setTextColor(...MUTED)
    doc.text(pdfText('Elaborado con DataDecision AI · cálculos con Python y Pandas'), PAGE.margin, PAGE.height - PAGE.margin)
  }
}

/** Construye el documento (sin descargarlo). `charts`: imágenes por id de gráfico. */
export async function createReportPdf(
  report: ReportDocument,
  charts: Map<string, ChartImage> = new Map(),
  {
    compress = true,
    presentation = defaultPresentation(defaultReportTitle(report)),
  }: {
    /** false solo en las pruebas, para poder leer el texto del documento. */
    compress?: boolean
    /** Personalización del PDF (título, autor, logo…): solo cambia la presentación. */
    presentation?: PdfPresentation
  } = {},
): Promise<JsPDF> {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress })
  const p = presentation
  doc.setProperties({
    title: pdfText(p.title),
    subject: pdfText(report.projectName),
    ...(p.author ? { author: pdfText(p.author) } : {}),
    // Origen técnico de los cálculos: se conserva aunque se oculte la marca visual.
    creator: 'DataDecision AI',
  })

  // Portada
  cover(doc, report, p)
  doc.addPage()
  const w = new Writer(doc)
  let n = 0
  const section = (title: string) => w.heading(`${(n += 1)}. ${title}`, 1)
  const ai = report.interpretation
  const scope = report.scope

  // 1. Objetivo original
  section('Objetivo original del análisis')
  objective(w, report.objective)

  // 2. Alcance real y cobertura
  section('Alcance real y estado de cobertura')
  w.text(scope.headline, { bold: true, color: scope.tone === 'ok' ? INK : WARN, gap: 2 })
  w.text(
    `Operaciones aprobadas y ejecutadas: ${scope.operations.calculated} de ${scope.operations.total} calculadas` +
      ` (${scope.operations.plans === 1 ? '1 plan' : `${scope.operations.plans} planes`}).`,
    { size: 9.5 },
  )
  if (scope.calculated.length) {
    w.heading('Resultados efectivamente calculados', 3)
    w.bullets(scope.calculated)
  }
  w.text(
    scope.pending.length
      ? `Cuestiones pendientes detectadas: ${scope.pending.length}. El detalle está en la sección «Cuestiones pendientes, advertencias y limitaciones».`
      : 'No se detectaron cuestiones pendientes.',
    { size: 9, color: scope.pending.length ? WARN : MUTED },
  )
  w.text(scope.caveat, { size: 8, color: MUTED })

  // 3. Resumen ejecutivo descriptivo (sin IA)
  section('Resumen ejecutivo (descriptivo, calculado sin IA)')
  if (report.summary?.executive.length) w.bullets(report.summary.executive)
  else w.text('El backend no informó un resumen descriptivo para esta ejecución.', { color: MUTED })

  // 4. Fuentes y metodología
  section('Fuentes de datos y metodología')
  w.table(
    ['Fuente', 'Archivo', 'Registros', 'Columnas'],
    report.sources.map((s) => [s.alias, s.fileName ?? '—', s.rows.toLocaleString('es-AR'), String(s.columns)]),
    [20, CONTENT - 80, 30, 30],
  )
  w.text(`Origen de los cálculos: DataDecision AI. ${METHODOLOGY_TEXT}`, { size: 9 })
  w.text(
    ai
      ? `Interpretación: incluye una interpretación redactada por la IA (${ai.usage.model}) que la persona autorizó; cada cifra se verificó contra los resultados.`
      : 'No se incluyó una interpretación con IA: el informe contiene solo resultados calculados con Pandas, sin intervención de la IA.',
    { size: 9, color: MUTED },
  )
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

  // 5. Indicadores y resultados calculados
  section('Indicadores y resultados calculados')
  for (const plan of report.plans) {
    if (!plan.kpis.length) continue
    w.heading(`${plan.title} · fuente ${plan.sourceAlias}`, 2)
    w.table(['Indicador', 'Valor', 'Operación'], plan.kpis.map((k) => [
      k.label,
      `${k.value.toLocaleString('es-AR', { maximumFractionDigits: 2 })}${k.unit ? ` ${k.unit}` : ''}`,
      k.description,
    ]))
  }
  if (report.derived.length) {
    w.heading('Indicadores derivados (calculados a partir de los resultados de Pandas)', 2)
    w.text('Variación entre el primer y el último período de cada serie. No es una operación aparte del catálogo: se obtiene de los valores ya calculados.', {
      size: 8,
      color: MUTED,
    })
    w.bullets(report.derived.map((d) => `${d.ref} · ${d.fact}`))
  }
  w.heading('Hallazgos calculados (resumen descriptivo con Pandas, sin IA)', 2)
  if (report.summary) {
    for (const item of report.summary.items) {
      w.ensure(12)
      w.text(`${item.ref} · ${item.title}`, { size: 9.5, bold: true, gap: 0.5 })
      if (item.status === 'error') w.text(`No se pudo calcular: ${item.error ?? ''}`, { size: 9, color: WARN, indent: 3 })
      else w.bullets(findingFacts(item, report.derived))
    }
    w.text(report.summary.notes.join(' '), { size: 8, color: MUTED })
  } else {
    w.text('El backend no informó un resumen descriptivo para esta ejecución.', { color: MUTED })
  }

  // 6. Gráficos
  if (report.plans.some((plan) => plan.charts.length)) {
    section('Gráficos')
    for (const plan of report.plans) {
      if (!plan.charts.length) continue
      w.heading(`${plan.title} · fuente ${plan.sourceAlias}`, 2, 40)
      for (const { chart, note } of plan.charts) {
        const image = charts.get(chart.id)
        // Título, descripción, imagen y leyenda van juntos: nunca se corta un gráfico ni queda su título solo.
        w.ensure((image ? Writer.imageHeight(image) + 6 : 10) + (chart.description ? 18 : 12))
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
    }
  }

  // 7. Tablas con valores exactos
  section('Tablas con valores exactos')
  for (const plan of report.plans) {
    if (!plan.tables.length) continue
    w.heading(`${plan.title} · fuente ${plan.sourceAlias}`, 2, 24)
    for (const { ref, op } of plan.tables) {
      w.heading(`${ref} · ${op.description && op.description !== '—' ? op.description : op.operation}`, 3, 14)
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
  }

  // 8. Interpretación con IA: solo si existe y fue autorizada
  if (ai) {
    section('Interpretación con IA')
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
      w.bullets(unverified.map(({ section: s, item }) => `${s}: ${item.text} [${item.evidence.join(', ')}]`), { color: WARN })
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

  // 9. Pendientes, advertencias y limitaciones
  section('Cuestiones pendientes, advertencias y limitaciones')
  w.heading('Cuestiones pendientes detectadas', 3)
  if (scope.pending.length) w.bullets(scope.pending, { color: WARN })
  else w.text('No se detectaron partes del objetivo sin calcular.', { size: 9.5, color: MUTED })
  w.heading('Lo que estos resultados no permiten concluir', 3)
  w.bullets(scope.notConcludable)
  if (report.warningNotes.length) {
    w.heading('Advertencias del cálculo y limitaciones de los planes', 3)
    for (const note of report.warningNotes) {
      w.text(`- ${note.text}`, { indent: 3, hanging: 2, gap: 0.8 })
      if (note.clarification) w.text(note.clarification, { indent: 7, size: 8.5, color: ACCENT, gap: 0.8 })
    }
    w.y += 1
  }
  w.text(scope.caveat, { size: 8, color: MUTED })

  // Pie de página en todas las hojas, salvo la portada
  const pages = doc.getNumberOfPages()
  const footer = pdfText(p.showBrand ? `DataDecision AI · ${p.title}` : p.title)
  for (let i = 2; i <= pages; i += 1) {
    doc.setPage(i)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.setTextColor(...MUTED)
    doc.text((doc.splitTextToSize(footer, CONTENT - 30) as string[])[0], PAGE.margin, PAGE.height - 8)
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

/** Nombre del archivo: el del proyecto y, si se muestra la fecha, la de elaboración. */
export function reportFileName(report: ReportDocument, presentation?: PdfPresentation): string {
  const base = report.projectName
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
  const date = presentation?.showDate === false ? '' : `-${report.generatedAt.toISOString().slice(0, 10)}`
  return `informe-${base || 'analisis'}${date}.pdf`
}

/** Captura los gráficos de la vista previa, arma el PDF y lo descarga. Todo ocurre en el navegador. */
export async function downloadReportPdf(
  report: ReportDocument,
  preview: HTMLElement,
  presentation: PdfPresentation = defaultPresentation(defaultReportTitle(report)),
): Promise<{ missingCharts: number }> {
  const { images, failed } = await captureCharts(preview)
  const doc = await createReportPdf(report, images, { presentation })
  doc.save(reportFileName(report, presentation))
  return { missingCharts: failed }
}
