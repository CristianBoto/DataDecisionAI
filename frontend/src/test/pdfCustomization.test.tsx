/**
 * Fase 4E — Personalización y calidad del PDF.
 * Datos: la respuesta REAL del backend para el dataset sintético de ventas (fixtures/salesReportResponse.json).
 * La frontera de IA es falsa y `fetch` está espiado: no hay red, ni OpenAI, ni consumo.
 */
import { useState } from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PdfCustomizer } from '@/components/report/PdfCustomizer'
import { ReportPreview } from '@/components/report/ReportPreview'
import { ReportSection } from '@/components/report/ReportSection'
import { AppProviders } from '@/context/AppProviders'
import { inlineText, parseObjective } from '@/lib/objectiveMarkdown'
import {
  cleanField,
  defaultCustomization,
  fitLogo,
  LIMITS,
  LOGO_MAX_BYTES,
  presentation,
  readLogo,
  sniffImage,
  type DecodedImage,
  type PdfCustomization,
  type PdfPresentation,
} from '@/lib/pdfCustomization'
import { planCoverage } from '@/lib/planCoverage'
import { buildReport, clarifyWarnings, defaultReportTitle, findingFacts, formatMeasure, type ReportDocument } from '@/lib/report'
import { createReportPdf, reportFileName, type ChartImage } from '@/lib/reportPdf'
import type { AIGatewayClient, AIInterpretationResult } from '@/services/aiGateway'
import type { ExecutionResponse } from '@/services/analysisEngine'
import { createDemoService } from '@/services/demoProvider'
import salesFixture from './fixtures/salesReportResponse.json'

const downloadSpy = vi.hoisted(() => vi.fn(async () => ({ missingCharts: 0 })))
vi.mock('@/lib/reportPdf', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/reportPdf')>()),
  downloadReportPdf: downloadSpy,
}))

const run = salesFixture as unknown as ExecutionResponse
const FILES = { A: 'datos-sinteticos-de-prueba-ventas.csv' }
// Imágenes reales y mínimas (generadas para la prueba): 40 × 20 px PNG y 30 × 60 px JPG.
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAACgAAAAUCAYAAAD/Rn+7AAAAPUlEQVR4nM3OQQEAEADAwFkPleTXhgiedgluzLUPYRIncRIncRIncRIncRIncRIncRIncRIncRIncf4OvFxowgJqmnqSAwAAAABJRU5ErkJggg=='
const JPG_B64 =
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAoHBwgHBgoICAgLCgoLDhgQDg0NDh0VFhEYIx8lJCIfIiEmKzcvJik0KSEiMEExNDk7Pj4+JS5ESUM8SDc9Pjv/2wBDAQoLCw4NDhwQEBw7KCIoOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozv/wAARCAA8AB4DASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDmKKKK++PCCiiigAooooAKKKKACiiigAooooAKKKKACiiigD//2Q=='

const bytes = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
const fileOf = (content: BlobPart, name: string, type = '') => new File([content], name, { type })
const pngFile = () => fileOf(bytes(PNG_B64), 'logo.png', 'image/png')
const jpgFile = () => fileOf(bytes(JPG_B64), 'logo.jpg', 'image/jpeg')

/** jsdom no decodifica imágenes: se simula la decodificación con las medidas reales de los archivos. */
const fakeDecode = async (_file: Blob, format: 'PNG' | 'JPEG'): Promise<DecodedImage> =>
  format === 'PNG'
    ? { dataUrl: `data:image/png;base64,${PNG_B64}`, width: 40, height: 20 }
    : { dataUrl: `data:image/jpeg;base64,${JPG_B64}`, width: 30, height: 60 }

const INTERPRETATION: AIInterpretationResult = {
  interpretation: {
    executive_summary: [
      {
        text: 'Las ventas suman 69.060 ARS.',
        evidence: ['P1.O1'],
        status: 'verified',
        claims: [{ ref: 'P1.O1', measure: 'monto_ars', kind: 'value', keys: [], period_from: null, period_to: null, value: 69060, unit: 'ARS' }],
      },
    ],
    findings: [],
    trends: [],
    recommendations: [],
    limitations: [],
    data_quality: [],
  },
  notes: [],
  usage: { model: 'gpt-6-luna', input_tokens: 2100, output_tokens: 600, cost_usd: 0.0009, remaining_usd: 0.09 },
}

/** Resultados sin la operación fallida: todas las operaciones del plan aprobado se calcularon. */
function completeRun(): ExecutionResponse {
  const r = structuredClone(run)
  r.results[0].operations = r.results[0].operations.filter((o) => o.status === 'ok')
  r.results[0].status = 'ok'
  r.summary!.items = r.summary!.items.filter((i) => i.status === 'ok')
  return r
}

const okOps = (r: ExecutionResponse) => r.results.flatMap((p) => p.operations.filter((o) => o.status === 'ok'))
const COLUMNS = ['fecha', 'rubro', 'canal', 'monto_ars']

function report(r: ExecutionResponse = run, extra: Partial<Parameters<typeof buildReport>[0]> = {}): ReportDocument {
  return buildReport({ run: r, objective: 'Ventas por rubro', projectName: 'Ventas', fileNames: FILES, interpretation: null, now: new Date('2026-10-27T12:00:00Z'), ...extra })
}

async function pdfText(doc: ReportDocument, p?: PdfPresentation, charts?: Map<string, ChartImage>) {
  const pdf = await createReportPdf(doc, charts, { compress: false, ...(p ? { presentation: p } : {}) })
  // jsPDF escapa paréntesis y barras del texto: se comparan sin escapes.
  return { pdf, text: pdf.output().replace(/\\([()\\])/g, '$1') }
}

const custom = (c: Partial<PdfCustomization>, doc = report()) => presentation({ ...defaultCustomization(), ...c }, defaultReportTitle(doc))

describe('1–3, 9, 10 · PDF sin personalizar y con portada personalizada', () => {
  it('1. sin personalización: título predeterminado, marca y fecha visibles', async () => {
    const doc = report()
    const { pdf, text } = await pdfText(doc)
    expect(text).toContain('Informe de análisis · Ventas')
    expect(text).toContain('Elaborado con DataDecision AI')
    expect(text).toContain('Elaborado el')
    expect(text).toContain('DataDecision AI · Informe de análisis · Ventas')
    expect(pdf.getNumberOfPages()).toBeGreaterThanOrEqual(3)
    expect(reportFileName(doc)).toBe('informe-ventas-2026-10-27.pdf')
  })

  it('2. el título personalizado va al PDF sin reemplazar el objetivo original', async () => {
    const doc = report()
    const { text } = await pdfText(doc, custom({ title: 'Informe de ventas 2025' }))
    expect(text).toContain('Informe de ventas 2025')
    expect(text).not.toContain('Informe de análisis · Ventas')
    expect(text).toContain('Ventas por rubro')
    expect(doc.objective).toBe('Ventas por rubro')
  })

  it('3. autor e institución son opcionales', async () => {
    const withBoth = (await pdfText(report(), custom({ author: 'Persona Ficticia', organization: 'Institución Ejemplo' }))).text
    expect(withBoth).toContain('Responsable: Persona Ficticia')
    expect(withBoth).toContain('Institución Ejemplo')
    const without = (await pdfText(report(), custom({}))).text
    expect(without).not.toContain('Responsable:')
    expect(without).not.toContain('Institución Ejemplo')
  })

  it('9. ocultar la fecha no toca las fechas de los datos ni de los gráficos', async () => {
    const doc = report()
    const p = custom({ showDate: false }, doc)
    const { text } = await pdfText(doc, p)
    expect(text).not.toContain('Elaborado el')
    expect(text).not.toContain('Resultados calculados el')
    // Los períodos analizados siguen en las tablas y en el resumen.
    expect(text).toContain('2025-01')
    expect(text).toContain('2025-06')
    expect(reportFileName(doc, p)).toBe('informe-ventas.pdf')
  })

  it('10. ocultar la marca conserva la referencia técnica al origen de los cálculos', async () => {
    const { pdf, text } = await pdfText(report(), custom({ showBrand: false, title: 'Informe propio' }))
    expect(text).not.toContain('Elaborado con DataDecision AI')
    expect(text).not.toContain('DataDecision AI · Informe propio')
    expect(text).toContain('Origen de los cálculos: DataDecision AI.')
    expect(text).toContain('Python y Pandas')
    // La portada ocupa una sola página con y sin marca (su pie no se desborda a una hoja en blanco).
    const branded = await pdfText(report(), custom({ showBrand: true, title: 'Informe propio' }))
    expect(pdf.getNumberOfPages()).toBe(branded.pdf.getNumberOfPages())
    expect(branded.pdf.getNumberOfPages()).toBe((await pdfText(report(), custom({ showBrand: true, showDate: false }))).pdf.getNumberOfPages())
  })

  it('los campos se limpian (control, espacios, longitud) y nunca se interpretan como HTML', () => {
    expect(cleanField('  Informe\u0000 de\n ventas  ', LIMITS.title)).toBe('Informe de ventas')
    expect(cleanField('x'.repeat(500), LIMITS.title)).toHaveLength(LIMITS.title)
    expect(cleanField('\u202eodatse', 80)).toBe('odatse')
    const p = custom({ title: '   ' })
    expect(p.title).toBe('Informe de análisis · Ventas')

    const doc = report()
    render(<ReportPreview report={doc} presentation={custom({ title: '<img src=x onerror="alert(1)">', author: '<b>Ana</b>' }, doc)} />)
    const cover = screen.getByRole('banner', { name: 'Portada' })
    expect(within(cover).getByText('<img src=x onerror="alert(1)">')).toBeInTheDocument()
    expect(within(cover).getByText('Responsable: <b>Ana</b>')).toBeInTheDocument()
    expect(cover.querySelector('img')).toBeNull()
    expect(cover.querySelector('b')).toBeNull()
  })
})

describe('4–8 · Logo', () => {
  it('4. PNG válido: se acepta por su contenido y se dibuja sin deformar', async () => {
    const result = await readLogo(pngFile(), fakeDecode)
    expect(result).toMatchObject({ ok: true, logo: { format: 'PNG', width: 40, height: 20, fileName: 'logo.png' } })
    if (!result.ok) return
    const size = fitLogo(result.logo, 60, 28)
    expect(size.width / size.height).toBeCloseTo(2)
    expect(size.width).toBeLessThanOrEqual(60)
    expect(size.height).toBeLessThanOrEqual(28)
    const { text } = await pdfText(report(), custom({ logo: result.logo }))
    expect(text).toMatch(/\/Subtype \/Image[\s\S]*\/Width 40[\s\S]*\/Height 20/)
  })

  it('5. JPG válido: se acepta y mantiene su proporción vertical', async () => {
    const result = await readLogo(jpgFile(), fakeDecode)
    expect(result).toMatchObject({ ok: true, logo: { format: 'JPEG', width: 30, height: 60 } })
    if (!result.ok) return
    const size = fitLogo(result.logo, 60, 28)
    expect(size.height).toBeCloseTo(28)
    expect(size.width).toBeCloseTo(14)
    const { text } = await pdfText(report(), custom({ logo: result.logo }))
    expect(text).toContain('/DCTDecode')
  })

  it('6. rechaza archivos que no son PNG o JPG (también si dicen serlo), SVG, vacíos y de más de 1 MB', async () => {
    const decode = vi.fn(fakeDecode)
    const svg = fileOf('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>', 'logo.svg', 'image/svg+xml')
    const disguisedSvg = fileOf('<svg xmlns="http://www.w3.org/2000/svg"></svg>', 'logo.png', 'image/png')
    const text = fileOf('hola', 'logo.jpg', 'image/jpeg')
    const gif = fileOf(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 0, 1, 0]), 'logo.gif', 'image/gif')
    for (const file of [svg, disguisedSvg, text, gif]) {
      expect(await readLogo(file, decode)).toEqual({ ok: false, error: expect.stringMatching(/Solo se aceptan imágenes PNG o JPG/) })
    }
    const big = new Uint8Array(LOGO_MAX_BYTES + 1)
    big.set(bytes(PNG_B64).slice(0, 8))
    expect(await readLogo(fileOf(big, 'grande.png', 'image/png'), decode)).toEqual({ ok: false, error: expect.stringMatching(/supera 1 MB/) })
    expect(await readLogo(fileOf('', 'vacio.png'), decode)).toEqual({ ok: false, error: 'El archivo está vacío.' })
    // Nada de lo rechazado llega a decodificarse.
    expect(decode).not.toHaveBeenCalled()
    expect(sniffImage(bytes(PNG_B64))).toBe('PNG')
    expect(sniffImage(bytes(JPG_B64))).toBe('JPEG')
  })

  it('7. una imagen dañada o con medidas fuera de rango se rechaza', async () => {
    const broken = fileOf(bytes(PNG_B64).slice(0, 30), 'roto.png', 'image/png')
    expect(await readLogo(broken, async () => Promise.reject(new Error('decode')))).toEqual({ ok: false, error: 'La imagen está dañada o no se puede abrir.' })
    expect(await readLogo(pngFile(), async () => ({ dataUrl: 'data:,', width: 4, height: 4 }))).toEqual({ ok: false, error: expect.stringMatching(/demasiado chica/) })
    expect(await readLogo(pngFile(), async () => ({ dataUrl: 'data:,', width: 9000, height: 40 }))).toEqual({ ok: false, error: expect.stringMatching(/demasiado grande/) })
  })

  it('8. se puede cargar, reemplazar y quitar el logo, y la vista previa lo refleja', async () => {
    const doc = report()
    function Harness() {
      const [value, setValue] = useState(defaultCustomization())
      return (
        <>
          <PdfCustomizer value={value} defaultTitle={defaultReportTitle(doc)} onChange={setValue} readLogoFile={(f) => readLogo(f, fakeDecode)} />
          <ReportPreview report={doc} presentation={presentation(value, defaultReportTitle(doc))} />
        </>
      )
    }
    render(<Harness />)
    const user = userEvent.setup()
    const input = screen.getByTestId('pdf-logo-input')
    const cover = () => screen.getByRole('banner', { name: 'Portada' })

    await user.upload(input, pngFile())
    expect(await within(cover()).findByAltText('Logo de la portada')).toHaveAttribute('src', `data:image/png;base64,${PNG_B64}`)
    expect(screen.getByAltText('Vista previa del logo')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Reemplazar logo' }))
    await user.upload(input, jpgFile())
    await waitFor(() => expect(within(cover()).getByAltText('Logo de la portada')).toHaveAttribute('src', `data:image/jpeg;base64,${JPG_B64}`))

    // Un archivo inválido muestra el error y conserva el logo anterior.
    await user.upload(input, fileOf('<svg/>', 'x.png', 'image/png'))
    expect(await screen.findByRole('alert')).toHaveTextContent(/Solo se aceptan imágenes PNG o JPG/)
    expect(within(cover()).getByAltText('Logo de la portada')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Quitar logo' }))
    expect(within(cover()).queryByAltText('Logo de la portada')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cargar logo' })).toBeInTheDocument()
  })
})

describe('11 · Objetivo con Markdown', () => {
  const OBJECTIVE = [
    '**1. Análisis general**',
    'Quiero conocer las ventas de **todo el año**, con énfasis en _Alimentos_ y en `monto_ars`.',
    '',
    '## 2. Detalle por canal',
    '- Comparar «Local» y «Online» (participación %).',
    '- Ver la evolución mes a mes:',
    '  - enero → junio',
    '1) Cuántos registros hay',
    '2. ¿Qué rubro creció más? Ñandú, pingüino, acción: ¡sí!',
    '<script>alert(1)</script> no es HTML',
    '---',
    'Ver [guía](https://example.test/guia).',
  ].join('\n')

  it('convierte encabezados, párrafos y listas sin perder palabras ni interpretar HTML', () => {
    expect(parseObjective(OBJECTIVE)).toEqual([
      { kind: 'heading', text: '1. Análisis general' },
      { kind: 'paragraph', text: 'Quiero conocer las ventas de todo el año, con énfasis en Alimentos y en monto_ars.' },
      { kind: 'heading', text: '2. Detalle por canal' },
      {
        kind: 'list',
        items: [
          { marker: '•', text: 'Comparar «Local» y «Online» (participación %).', level: 0 },
          { marker: '•', text: 'Ver la evolución mes a mes:', level: 0 },
          { marker: '•', text: 'enero → junio', level: 1 },
          { marker: '1.', text: 'Cuántos registros hay', level: 0 },
          { marker: '2.', text: '¿Qué rubro creció más? Ñandú, pingüino, acción: ¡sí!', level: 0 },
        ],
      },
      { kind: 'paragraph', text: '<script>alert(1)</script> no es HTML' },
      { kind: 'paragraph', text: 'Ver guía (https://example.test/guia).' },
    ])
    // Los nombres de columnas con guion bajo se conservan.
    expect(inlineText('usar monto_ars y fecha_venta')).toBe('usar monto_ars y fecha_venta')
    expect(inlineText('**A** y **B**')).toBe('A y B')
  })

  it('el PDF y la vista previa muestran el objetivo sin símbolos de Markdown; el original no cambia', async () => {
    const long = `${OBJECTIVE}\n\n${'Párrafo extenso con tildes y eñes: año, señal, información. '.repeat(40)}`
    const doc = report(run, { objective: long })
    expect(doc.objective).toBe(long.trim())
    const { text } = await pdfText(doc)
    expect(text).toContain('1. Análisis general')
    expect(text).not.toContain('**1. Análisis general**')
    expect(text).not.toContain('## 2.')
    expect(text).toContain('· Comparar «Local» y «Online» (participación %).')
    expect(text).toContain('enero -> junio')
    expect(text).toContain('¿Qué rubro creció más? Ñandú, pingüino, acción: ¡sí!')

    render(<ReportPreview report={doc} />)
    const objective = screen.getByTestId('report-objective')
    expect(objective).not.toHaveTextContent('**')
    expect(objective.querySelector('script')).toBeNull()
    expect(within(objective).getByText('<script>alert(1)</script> no es HTML')).toBeInTheDocument()
  })
})

describe('12–14 · Alcance real y advertencias contradictorias', () => {
  it('12. un plan completo con partes del objetivo pendientes no se presenta como «Análisis completo»', async () => {
    const r = completeRun()
    const objective = 'Quiero saber cuántos registros hay, los promedios por rubro y la relación entre el monto y el canal.'
    const coverage = planCoverage([objective], COLUMNS, okOps(r))
    const doc = report(r, { objective, coverage })
    expect(doc.scope.headline).toBe(
      'Se completaron las 4 operaciones del plan aprobado. Sin embargo, quedaron pendientes otras partes del objetivo original, ' +
        'como cantidad de registros, relación entre dos variables y promedios.',
    )
    expect(doc.scope.tone).toBe('warn')
    expect(doc.scope.operations).toEqual({ calculated: 4, total: 4, plans: 1 })
    expect(doc.scope.pending).toHaveLength(3)
    const { text } = await pdfText(doc)
    expect(text).not.toContain('Análisis completo')
    expect(text).toContain('Sin embargo, quedaron pendientes')
    expect(text).toContain('Cuestiones pendientes detectadas: 3')
    expect(text).toContain('Es una ayuda, no una garantía')
  })

  it('12b. con operaciones fallidas, se informan aparte de lo calculado', () => {
    const doc = report(run, { coverage: planCoverage(['Ventas por rubro'], COLUMNS, okOps(run)) })
    expect(doc.scope.headline).toMatch(/^Se calcularon 4 de las 5 operaciones del plan aprobado; una no se pudo calcular\./)
    expect(doc.scope.pending[0]).toMatch(/^P1\.O5 · Suma · Suma inválida: no se pudo calcular/)
    expect(doc.scope.notConcludable).toContain('Nada sobre las operaciones sin resultado.')
  })

  it('13. sin pendientes detectados, la redacción es prudente; sin objetivo, no se afirma cobertura', () => {
    const r = completeRun()
    const objective = 'Quiero ver la evolución de las ventas por rubro y comparar los canales.'
    const doc = report(r, { objective, coverage: planCoverage([objective], COLUMNS, okOps(r)) })
    expect(doc.scope.headline).toBe('Se completaron las 4 operaciones del plan aprobado. La revisión automática no detectó otras partes del objetivo sin calcular.')
    expect(doc.scope.tone).toBe('ok')
    expect(doc.scope.caveat).toMatch(/no una garantía/)
    const noObjective = report(r, { objective: null, coverage: null })
    expect(noObjective.scope.headline).toMatch(/no se puede establecer si el análisis lo responde por completo/)
  })

  it('14. una variación calculada como indicador derivado no queda contradicha por la advertencia', async () => {
    const r = completeRun()
    const warning = 'La variación absoluta y porcentual entre el primer y el último mes no está disponible como operación del catálogo.'
    r.results[0].warnings = [warning, 'No se pueden pronosticar variaciones futuras.', 'La correlación no implica causalidad.']
    const doc = report(r)
    expect(doc.derived.map((d) => d.ref)).toEqual(['P1.O2', 'P1.O2', 'P1.O2'])
    expect(doc.derived[0].fact).toContain('variación de +500 ARS (+9,8 %)')
    const notes = Object.fromEntries(doc.warningNotes.map((n) => [n.text, n.clarification]))
    // La advertencia original se conserva y se aclara; las limitaciones reales no se tocan.
    expect(notes[warning]).toMatch(/sí se calculó como indicador derivado de los resultados de Pandas \(P1\.O2/)
    expect(notes['No se pueden pronosticar variaciones futuras.']).toBeNull()
    expect(notes['La correlación no implica causalidad.']).toBeNull()
    const { text } = await pdfText(doc)
    expect(text).toContain('Indicadores derivados (calculados a partir de los resultados de Pandas)')
    expect(text).toContain('variación de +500 ARS (+9,8 %)')
    expect(text).toContain('no está disponible')
    // Las variaciones figuran una sola vez en «Indicadores derivados»; los hallazgos remiten a esa sección.
    const series = doc.summary!.items.find((i) => i.ref === 'P1.O2')!
    expect(findingFacts(series, doc.derived)).toEqual(['Las variaciones de sus 3 series entre el primer y el último período se detallan en «Indicadores derivados».'])
    const total = doc.summary!.items.find((i) => i.ref === 'P1.O1')!
    expect(findingFacts(total, doc.derived)).toEqual(total.facts)
    expect(text).toContain('Las variaciones de sus 3 series')
    expect(text.split('Limpieza): pasó de 2.120 ARS').length - 1).toBe(1)
    render(<ReportPreview report={doc} />)
    expect(screen.getAllByText(/Limpieza\): pasó de 2\.120 ARS/)).toHaveLength(1)
    // Sin variaciones calculadas, la advertencia queda sin aclaración.
    expect(clarifyWarnings([warning], [])).toEqual([{ text: warning, clarification: null }])
  })
})

describe('15–17 · Interpretación, paginación y valores exactos', () => {
  it('15. la sección de IA aparece solo si hay una interpretación autorizada', async () => {
    const without = (await pdfText(report())).text
    expect(without).not.toContain('Interpretación con IA')
    expect(without).toContain('No se incluyó una interpretación con IA')
    const withAi = (await pdfText(report(run, { interpretation: INTERPRETATION }))).text
    expect(withAi).toContain('8. Interpretación con IA')
    expect(withAi).toContain('Las ventas suman 69.060 ARS. [P1.O1]')
  })

  it('16. tablas extensas y muchos gráficos se reparten en páginas, con numeración', async () => {
    const long = structuredClone(run)
    long.results[0].operations[1].rows = Array.from({ length: 200 }, (_, i) => ({ keys: [`2025-${String((i % 12) + 1).padStart(2, '0')}`, `Rubro ${i}`], values: [1000 + i] }))
    const doc = report(long)
    const image: ChartImage = { dataUrl: `data:image/png;base64,${PNG_B64}`, ratio: 0.6 }
    const charts = new Map(doc.plans.flatMap((p) => p.charts.map((c) => [c.chart.id, image] as const)))
    const { pdf, text } = await pdfText(doc, undefined, charts)
    const pages = pdf.getNumberOfPages()
    expect(pages).toBeGreaterThanOrEqual(5)
    expect(text).toContain(`Página ${pages} de ${pages}`)
    expect(text).toContain('Se listan 25 de 200 filas')
  })

  it('17. el PDF conserva los valores exactos de Pandas', async () => {
    const doc = report()
    const { text } = await pdfText(doc)
    for (const plan of doc.plans) {
      for (const k of plan.kpis) expect(text).toContain(`${k.value.toLocaleString('es-AR', { maximumFractionDigits: 2 })}${k.unit ? ` ${k.unit}` : ''}`)
      for (const { op } of plan.tables) {
        for (const row of op.rows.slice(0, 25)) row.values.forEach((v, i) => expect(text).toContain(formatMeasure(v, op.measures[i])))
      }
    }
    expect(text).toContain('69.060 ARS')
  })
})

function gateway() {
  return {
    status: vi.fn(async () => ({
      ai_enabled: true, provider_configured: true, external_calls_implemented: true, model: 'gpt-6-luna',
      budget_usd: 0.1, spent_usd: 0, remaining_usd: 0.1, requests_used: 0, max_requests: 15,
    })),
    prepare: vi.fn(),
    authorize: vi.fn(),
    cancel: vi.fn(async () => undefined),
    prepareInterpretation: vi.fn(),
    authorizeInterpretation: vi.fn(),
    cancelInterpretation: vi.fn(async () => undefined),
  } satisfies AIGatewayClient
}

describe('18–20 · La personalización es solo del PDF', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('no modifica los resultados, no sale del navegador y no llama a la IA', async () => {
    const fetchSpy = vi.fn(async () => new Response('{}'))
    vi.stubGlobal('fetch', fetchSpy)
    const original = structuredClone(run)
    const ai = gateway()
    render(
      <AppProviders service={createDemoService({ delayMs: 0 })} aiGateway={ai} analysisEngine={null}>
        <ReportSection run={run} fileNames={FILES} />
      </AppProviders>,
    )
    const user = userEvent.setup()
    await screen.findByRole('button', { name: 'Interpretar resultados con IA' })
    const statusBefore = screen.getByRole('region', { name: 'Estado del análisis' }).textContent
    const summaryBefore = screen.getByRole('region', { name: 'Resumen descriptivo' }).textContent

    // «Personalizar PDF» está dentro de «Revisar el informe».
    expect(screen.queryByRole('region', { name: 'Personalizar PDF' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Revisar el informe' }))
    const panel = screen.getByRole('region', { name: 'Personalizar PDF' })
    const preview = screen.getByRole('document', { name: 'Vista previa del informe' })
    expect(within(preview).getByRole('heading', { name: 'Informe de análisis · Análisis de datos' })).toBeInTheDocument()

    await user.type(within(panel).getByLabelText('Título del informe'), 'Informe de ventas 2025')
    await user.type(within(panel).getByLabelText('Autor o responsable (opcional)'), 'Persona Ficticia')
    await user.type(within(panel).getByLabelText('Empresa o institución (opcional)'), 'Empresa Ejemplo')
    await user.click(within(panel).getByLabelText('Mostrar la fecha de elaboración'))
    await user.click(within(panel).getByLabelText('Mostrar la marca DataDecision AI'))

    // La vista previa refleja la portada sin recalcular nada.
    const cover = within(preview).getByRole('banner', { name: 'Portada' })
    expect(within(cover).getByRole('heading', { name: 'Informe de ventas 2025' })).toBeInTheDocument()
    expect(within(cover).getByText('Responsable: Persona Ficticia')).toBeInTheDocument()
    expect(within(cover).getByText('Empresa Ejemplo')).toBeInTheDocument()
    expect(within(cover).queryByText(/Elaborado el/)).not.toBeInTheDocument()
    expect(within(cover).queryByText('DataDecision AI')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Descargar PDF' }))
    await waitFor(() => expect(downloadSpy).toHaveBeenCalled())
    const [doc, , p] = downloadSpy.mock.calls.at(-1) as unknown as [ReportDocument, HTMLElement, PdfPresentation]
    expect(p).toMatchObject({ title: 'Informe de ventas 2025', author: 'Persona Ficticia', organization: 'Empresa Ejemplo', showDate: false, showBrand: false })

    // 18. Resultados, resumen y estado del análisis intactos; el informe no lleva la personalización.
    expect(run).toEqual(original)
    expect(doc.plans[0].kpis.map((k) => k.value)).toContain(69060)
    expect(JSON.stringify(doc)).not.toContain('Persona Ficticia')
    expect(screen.getByRole('region', { name: 'Estado del análisis' }).textContent).toBe(statusBefore)
    expect(screen.getByRole('region', { name: 'Resumen descriptivo' }).textContent).toBe(summaryBefore)

    // 19. Nada sale del navegador por esta función. 20. Ninguna llamada a la IA.
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(ai.prepareInterpretation).not.toHaveBeenCalled()
    expect(ai.authorizeInterpretation).not.toHaveBeenCalled()
    expect(ai.prepare).not.toHaveBeenCalled()
    expect(ai.authorize).not.toHaveBeenCalled()

    // «Restablecer» vuelve a la portada predeterminada.
    await user.click(within(panel).getByRole('button', { name: 'Restablecer' }))
    expect(within(preview).getByRole('heading', { name: 'Informe de análisis · Análisis de datos' })).toBeInTheDocument()
  })
})
