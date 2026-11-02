import type { jsPDF as JsPDF } from 'jspdf'
import { seriesColor } from '@/lib/chartColors'
import { parseObjective } from '@/lib/objectiveMarkdown'
import { defaultPresentation, fitLogo, type PdfPresentation } from '@/lib/pdfCustomization'
import {
  aiItems,
  defaultReportTitle,
  executiveSummary,
  findingsWithoutChart,
  formatMeasure,
  measureHeader,
  METHODOLOGY_TEXT,
  operationFindings,
  PROVENANCE_LABELS,
  type OutlineItem,
  type ReportDocument,
} from '@/lib/report'

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
const CHART_WIDTH = 140
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
    return Math.min(CHART_WIDTH * image.ratio, 78)
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

/** Lista de afirmaciones con su origen (Pandas, IA verificada, interpretación o hipótesis) y sus operaciones. */
function outline(w: Writer, list: OutlineItem[], opts: { tag?: boolean } = {}) {
  for (const item of list) {
    const refs = item.refs.length ? ` [${item.refs.join(', ')}]` : ''
    w.text(`- ${item.text}${refs}`, { indent: 3, hanging: 2, gap: 0.4 })
    if (opts.tag !== false) w.text(PROVENANCE_LABELS[item.provenance], { indent: 5, size: 7.5, color: item.provenance === 'pandas' ? MUTED : ACCENT, gap: 1 })
  }
  w.y += 1
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

const dateOnly = new Intl.DateTimeFormat('es-AR', { dateStyle: 'long' })

/** Portada: encabezado con logo e institución, título destacado, objetivo interpretado y datos de autoría. */
function cover(doc: JsPDF, report: ReportDocument, p: PdfPresentation) {
  const w = new Writer(doc)
  const accent = p.showBrand ? ACCENT : INK
  if (p.showBrand) {
    doc.setFillColor(...ACCENT)
    doc.rect(0, 0, PAGE.width, 4, 'F')
  }
  // Encabezado: logo a la izquierda y nombre de la organización alineado a su altura.
  let headerBottom = 22
  if (p.logo) {
    const size = fitLogo(p.logo, 55, 24)
    doc.addImage(p.logo.dataUrl, p.logo.format, PAGE.margin, 16, size.width, size.height)
    headerBottom = 16 + size.height
    if (p.organization) {
      w.y = 16 + size.height / 2 - 3
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(11)
      doc.setTextColor(...INK)
      const x = PAGE.margin + size.width + 6
      const lines = (doc.splitTextToSize(pdfText(p.organization), PAGE.width - PAGE.margin - x) as string[]).slice(0, 2)
      lines.forEach((line, i) => doc.text(line, x, w.y + 4 + i * 5))
    }
  } else if (p.organization) {
    w.y = 16
    w.text(p.organization, { size: 12, bold: true })
    headerBottom = w.y
  }
  doc.setDrawColor(226, 232, 240)
  doc.line(PAGE.margin, headerBottom + 6, PAGE.margin + CONTENT, headerBottom + 6)

  w.y = 92
  w.text('INFORME DE ANÁLISIS DE DATOS', { size: 9, bold: true, color: accent, gap: 3 })
  w.text(p.title, { size: 26, bold: true, gap: 4 })
  doc.setDrawColor(...accent)
  doc.setLineWidth(0.8)
  doc.line(PAGE.margin, w.y, PAGE.margin + 36, w.y)
  doc.setLineWidth(0.2)
  w.y += 7
  if (report.proposal?.interpretedObjective) {
    w.text(report.proposal.interpretedObjective, { size: 12, color: MUTED, gap: 3 })
  }
  w.text(`Proyecto: ${report.projectName}`, { size: 10, color: MUTED, gap: 1 })

  // Autoría y fecha, en posiciones fijas al pie (nunca pasan a otra página).
  const rows = [
    p.author ? `Responsable: ${p.author}` : null,
    p.showDate ? `Fecha: ${dateOnly.format(p.date ?? report.generatedAt)}` : null,
    p.showDate ? `Resultados calculados el ${dateTime.format(new Date(report.executedAt))}` : null,
  ].filter((r): r is string => Boolean(r))
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.setTextColor(...INK)
  const bottom = PAGE.height - PAGE.margin - (p.showBrand ? 10 : 0)
  rows.forEach((row, i) => doc.text(pdfText(row), PAGE.margin, bottom - (rows.length - i) * 5.5))
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

  cover(doc, report, p)
  doc.addPage()
  const w = new Writer(doc)
  let n = 0
  /** `keepWith`: alto de lo que sigue y debe quedar en la misma página que el título de la sección. */
  const section = (title: string, keepWith = 0) => w.heading(`${(n += 1)}. ${title}`, 1, keepWith)
  const ai = report.interpretation?.interpretation ?? null
  const scope = report.scope
  const proposal = report.proposal

  // 1. Resumen ejecutivo breve
  section('Resumen ejecutivo')
  outline(w, executiveSummary(report))

  // 2. Objetivo interpretado y alcance
  section('Objetivo interpretado y alcance')
  w.text(proposal?.interpretedObjective || (report.objective ? 'Ver el anexo «Pedido original».' : 'No se registró un objetivo.'), { bold: Boolean(proposal), gap: 2 })
  if (proposal?.decisions.length) {
    w.heading('Decisiones que ayuda a evaluar', 3)
    w.bullets(proposal.decisions)
  }
  w.text(
    `Operaciones calculadas: ${scope.operations.calculated} de ${scope.operations.total}` +
      `${proposal?.feasibility ? ` · Viabilidad declarada: ${FEASIBILITY_TEXT[proposal.feasibility] ?? proposal.feasibility}` : ''}.`,
    { size: 9.5 },
  )
  if (proposal?.missingData.length) {
    w.heading('Datos que faltan para el resto del objetivo', 3)
    w.bullets(proposal.missingData)
  }
  w.text(scope.caveat, { size: 8, color: MUTED })

  // 3. Indicadores principales
  const kpis = report.plans.flatMap((plan) => plan.kpis.map((k) => ({ ...k, plan: plan.title })))
  if (kpis.length || report.derived.length) {
    section('Indicadores principales')
    if (kpis.length) {
      w.table(['Indicador', 'Valor', 'Plan'], kpis.map((k) => [
        k.label,
        `${k.value.toLocaleString('es-AR', { maximumFractionDigits: 2 })}${k.unit ? ` ${k.unit}` : ''}`,
        k.plan,
      ]), [80, 45, CONTENT - 125])
    }
    if (report.derived.length) {
      w.heading('Indicadores derivados (calculados a partir de los resultados de Pandas)', 3)
      w.bullets(report.derived.map((d) => `${d.ref} · ${d.fact}`))
    }
  }

  // 4. Gráficos y hallazgos: cada gráfico con los hechos calculados de su operación.
  // El título de la sección va con su primer gráfico: nunca queda solo al pie de una página.
  const firstChart = report.plans.flatMap((plan) => plan.charts)[0]
  const firstImage = firstChart ? charts.get(firstChart.chart.id) : undefined
  section('Gráficos y hallazgos', firstImage ? Writer.imageHeight(firstImage) + 24 : 0)
  w.text(PROVENANCE_LABELS.pandas, { size: 7.5, color: MUTED, gap: 1.5 })
  for (const plan of report.plans) {
    for (const { chart, note, ref } of plan.charts) {
      const image = charts.get(chart.id)
      const facts = operationFindings(report, ref)
      // Título, imagen y leyenda van juntos: nunca se corta un gráfico ni queda su título solo.
      w.ensure((image ? Writer.imageHeight(image) + 6 : 10) + (chart.description ? 18 : 12))
      w.heading(`${chart.title}${ref ? ` · ${ref}` : ''}`, 3)
      if (chart.description) w.text(chart.description, { size: 8, color: MUTED, gap: 1 })
      if (image) {
        w.image(image)
        w.legend(chart.series.map((s) => s.label))
      } else {
        w.text('No se pudo convertir este gráfico en imagen: sus valores están en el anexo «Tablas con valores exactos».', { size: 8, color: WARN })
      }
      if (note) w.text(note, { size: 7.5, color: MUTED })
      if (facts.length) w.bullets(facts)
    }
  }
  const others = findingsWithoutChart(report)
  if (others.length) {
    w.heading('Otros resultados calculados', 3)
    for (const item of others) {
      w.text(`${item.ref} · ${item.title}`, { size: 9.5, bold: true, gap: 0.5 })
      w.bullets(item.facts)
    }
  }

  // 5. Interpretación orientada a decisiones
  section('Interpretación orientada a decisiones')
  if (ai) {
    w.text(
      `Redactada por la IA (${report.interpretation!.usage.model}) con los resultados agregados que se autorizaron. Cada cifra se ` +
        'recalculó sobre los resultados de Pandas; lo que no coincidía se descartó (ver el anexo «Auditoría de la verificación de la IA»).',
      { size: 8, color: MUTED },
    )
    for (const [title, key] of [['Hallazgos principales', 'findings'], ['Tendencias y comparaciones', 'trends'], ['Implicaciones para el objetivo', 'implications'], ['Hipótesis a comprobar', 'hypotheses']] as const) {
      const list = aiItems(ai, key)
      if (!list.length) continue
      w.heading(title, 3)
      outline(w, list)
    }
    if (ai.not_supported?.length) {
      w.heading('Lo que estos datos no permiten concluir', 3)
      w.bullets(ai.not_supported)
    }
  } else {
    w.text(
      'No se incluyó una interpretación con IA: el informe se limita a los resultados calculados con Pandas, sin intervención de la IA.',
      { color: MUTED },
    )
  }

  // 6. Recomendaciones y limitaciones
  section('Recomendaciones y limitaciones')
  if (ai) {
    const recommendations = aiItems(ai, 'recommendations')
    if (recommendations.length) {
      w.heading('Recomendaciones (condicionadas a los resultados)', 3)
      outline(w, recommendations)
    }
    if (ai.information_needed?.length) {
      w.heading('Información adicional que ayudaría a decidir', 3)
      w.bullets(ai.information_needed)
    }
  }
  if (scope.pending.length) {
    w.heading('Cuestiones pendientes', 3)
    w.bullets(scope.pending, { color: WARN })
  }
  w.heading('Lo que no se puede concluir', 3)
  w.bullets(scope.notConcludable)
  // Advertencias del cálculo (las notas generales del motor van a la metodología).
  const technical = new Set(report.engineNotes)
  const cautions = report.warningNotes.filter((note) => !technical.has(note.text))
  if (cautions.length || ai?.limitations.length) {
    w.heading('Limitaciones y advertencias del cálculo', 3)
    for (const note of cautions) {
      w.text(`- ${note.text}`, { indent: 3, hanging: 2, gap: 0.6, size: 9 })
      if (note.clarification) w.text(note.clarification, { indent: 7, size: 8, color: ACCENT, gap: 0.6 })
    }
    if (ai?.limitations.length) w.bullets(ai.limitations)
  }

  // 7. Metodología, fuentes y detalles técnicos
  section('Metodología, fuentes y detalles técnicos')
  w.text('Origen de cada contenido:', { size: 9, bold: true, gap: 0.5 })
  w.bullets(Object.values(PROVENANCE_LABELS))
  w.table(
    ['Fuente', 'Archivo', 'Registros', 'Columnas'],
    report.sources.map((s) => [s.alias, s.fileName ?? '—', s.rows.toLocaleString('es-AR'), String(s.columns)]),
    [20, CONTENT - 80, 30, 30],
  )
  w.text(`Origen de los cálculos: DataDecision AI. ${METHODOLOGY_TEXT}`, { size: 9 })
  w.bullets(report.engineNotes, { color: MUTED })
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
  if (ai?.data_quality.length) {
    w.heading('Calidad de los datos señalada en la interpretación', 3)
    w.bullets(ai.data_quality)
  }

  // Anexos: el pedido original completo, las tablas exactas y la auditoría de la verificación.
  const annexes: [string, () => void][] = []
  if (report.objective && report.objective !== proposal?.interpretedObjective) {
    annexes.push(['Pedido original', () => objective(w, report.objective)])
  }
  if (report.plans.some((plan) => plan.tables.length)) {
    annexes.push(['Tablas con valores exactos', () => {
      for (const plan of report.plans) {
        for (const { ref, op } of plan.tables) {
          w.heading(`${ref} · ${op.description && op.description !== '—' ? op.description : op.operation}`, 3, 14)
          if (op.operation === 'scatter' || op.operation === 'roc_curve') {
            const stats = Object.entries(op.stats ?? {}).filter(([k]) => ['pearson', 'spearman', 'n', 'auc', 'positives', 'negatives'].includes(k))
            w.text(stats.map(([k, v]) => `${k}: ${typeof v === 'number' ? v.toLocaleString('es-AR', { maximumFractionDigits: 4 }) : String(v)}`).join(' · '), { size: 9 })
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
    }])
  }
  if (report.interpretation?.notes.length) {
    annexes.push(['Auditoría de la verificación de la IA', () => w.bullets(report.interpretation!.notes, { color: MUTED })])
  }
  annexes.forEach(([title, render], i) => {
    w.heading(`Anexo ${String.fromCharCode(65 + i)}. ${title}`, 1)
    render()
  })

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

const FEASIBILITY_TEXT: Record<string, string> = {
  viable: 'viable',
  partial: 'parcialmente viable',
  not_viable: 'no viable con estos datos',
  needs_information: 'falta información',
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
