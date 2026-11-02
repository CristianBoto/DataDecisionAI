import { forwardRef, type ReactNode } from 'react'
import { ChartCard } from '@/components/charts/ChartCard'
import { parseObjective } from '@/lib/objectiveMarkdown'
import { defaultPresentation, type PdfPresentation } from '@/lib/pdfCustomization'
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

const dateTime = new Intl.DateTimeFormat('es-AR', { dateStyle: 'long', timeStyle: 'short' })
const dateOnly = new Intl.DateTimeFormat('es-AR', { dateStyle: 'long' })
const number = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 })
/** Mismo límite que el PDF: la vista previa muestra lo que se va a descargar. */
const MAX_TABLE_ROWS = 25
const FEASIBILITY_TEXT: Record<string, string> = {
  viable: 'viable',
  partial: 'parcialmente viable',
  not_viable: 'no viable con estos datos',
  needs_information: 'falta información',
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2" aria-label={title}>
      <h3 className="border-b border-slate-200 pb-1 text-base font-semibold text-blue-800">{title}</h3>
      {children}
    </section>
  )
}

function Sub({ children }: { children: ReactNode }) {
  return <p className="pt-1 text-sm font-semibold text-slate-800">{children}</p>
}

function Bullets({ items, className = 'text-slate-700' }: { items: string[]; className?: string }) {
  return <ul className={`list-disc space-y-0.5 pl-5 text-sm ${className}`}>{items.map((t) => <li key={t}>{t}</li>)}</ul>
}

/** Afirmaciones con su origen visible (Pandas, IA verificada, interpretación o hipótesis). */
function Outline({ items }: { items: OutlineItem[] }) {
  return (
    <ul className="space-y-1.5 text-sm text-slate-700">
      {items.map((item) => (
        <li key={item.text} className="pl-3">
          <span>
            {item.text}
            {item.refs.length > 0 && <span className="text-xs text-slate-400"> [{item.refs.join(', ')}]</span>}
          </span>
          <span className={`block text-[11px] ${item.provenance === 'pandas' ? 'text-slate-400' : 'text-blue-700'}`}>{PROVENANCE_LABELS[item.provenance]}</span>
        </li>
      ))}
    </ul>
  )
}

/** Objetivo con formato legible. Todo se muestra como texto: nunca se interpreta HTML. */
function Objective({ text }: { text: string | null }) {
  if (!text) return <p className="text-sm text-slate-500">No se registró un objetivo para esta ejecución.</p>
  return (
    <div className="space-y-2 text-sm text-slate-700" data-testid="report-objective">
      {parseObjective(text).map((block, i) =>
        block.kind === 'heading' ? (
          <p key={i} className="pt-1 font-semibold text-slate-900">{block.text}</p>
        ) : block.kind === 'paragraph' ? (
          <p key={i}>{block.text}</p>
        ) : (
          <ul key={i} className="space-y-0.5">
            {block.items.map((item, j) => (
              <li key={j} className={item.level ? 'flex gap-1.5 pl-8' : 'flex gap-1.5 pl-3'}>
                <span className="shrink-0 text-slate-500">{item.marker}</span>
                <span>{item.text}</span>
              </li>
            ))}
          </ul>
        ),
      )}
    </div>
  )
}

/** Portada del PDF, con la personalización elegida. */
function Cover({ report, p }: { report: ReportDocument; p: PdfPresentation }) {
  return (
    <header className={p.showBrand ? 'space-y-4 border-t-4 border-blue-700 pt-4' : 'space-y-4'} aria-label="Portada">
      {(p.logo || p.organization) && (
        <div className="flex items-center gap-4 border-b border-slate-200 pb-3">
          {p.logo && <img src={p.logo.dataUrl} alt="Logo de la portada" className="max-h-16 max-w-48 object-contain" />}
          {p.organization && <p className="font-semibold text-slate-800">{p.organization}</p>}
        </div>
      )}
      <div className="space-y-2 pt-4">
        <p className={`text-xs font-semibold tracking-wide uppercase ${p.showBrand ? 'text-blue-700' : 'text-slate-700'}`}>Informe de análisis de datos</p>
        <h2 className="text-3xl font-bold break-words text-slate-900">{p.title}</h2>
        <div className={`h-1 w-16 ${p.showBrand ? 'bg-blue-700' : 'bg-slate-800'}`} aria-hidden />
        {report.proposal?.interpretedObjective && <p className="text-slate-600">{report.proposal.interpretedObjective}</p>}
        <p className="text-sm text-slate-500">Proyecto: {report.projectName}</p>
      </div>
      <div className="space-y-0.5 text-sm text-slate-700">
        {p.author && <p>Responsable: {p.author}</p>}
        {p.showDate && (
          <>
            <p>Fecha: {dateOnly.format(p.date ?? report.generatedAt)}</p>
            <p className="text-xs text-slate-500">Resultados calculados el {dateTime.format(new Date(report.executedAt))}</p>
          </>
        )}
      </div>
      {p.showBrand && <p className="text-[11px] text-slate-400">Elaborado con DataDecision AI · cálculos con Python y Pandas</p>}
    </header>
  )
}

/**
 * Vista previa del informe, con el mismo contenido y orden que el PDF (Fase 5: informe ejecutivo).
 * Los gráficos son los del dashboard (sin animación) y se capturan de aquí al descargar: los
 * contenedores `data-report-chart` identifican cada uno. La personalización solo cambia la portada
 * y la presentación, nunca los resultados.
 */
export const ReportPreview = forwardRef<HTMLDivElement, { report: ReportDocument; presentation?: PdfPresentation }>(function ReportPreview(
  { report, presentation },
  ref,
) {
  const p = presentation ?? defaultPresentation(defaultReportTitle(report))
  const ai = report.interpretation?.interpretation ?? null
  const scope = report.scope
  const proposal = report.proposal
  const kpis = report.plans.flatMap((plan) => plan.kpis.map((k) => ({ ...k, plan: plan.title })))
  const others = findingsWithoutChart(report)
  const technical = new Set(report.engineNotes)
  const cautions = report.warningNotes.filter((note) => !technical.has(note.text))
  let n = 0
  const title = (t: string) => `${(n += 1)}. ${t}`
  const annexes: [string, ReactNode][] = []
  if (report.objective && report.objective !== proposal?.interpretedObjective) annexes.push(['Pedido original', <Objective key="o" text={report.objective} />])
  if (report.plans.some((plan) => plan.tables.length)) {
    annexes.push([
      'Tablas con valores exactos',
      <div key="t" className="space-y-3">
        {report.plans.flatMap((plan) =>
          plan.tables.map(({ ref: opRef, op }) =>
            op.operation === 'scatter' || op.operation === 'roc_curve' ? (
              <p key={opRef} className="text-xs text-slate-700">
                <span className="font-medium">{opRef} · {op.description && op.description !== '—' ? op.description : op.operation}</span>:{' '}
                {Object.entries(op.stats ?? {})
                  .filter(([k]) => ['pearson', 'spearman', 'n', 'auc', 'positives', 'negatives'].includes(k))
                  .map(([k, v]) => `${k}: ${typeof v === 'number' ? v.toLocaleString('es-AR', { maximumFractionDigits: 4 }) : String(v)}`)
                  .join(' · ')}
              </p>
            ) : (
              <div key={opRef} className="overflow-x-auto">
                <p className="text-xs font-medium text-slate-700">
                  {opRef} · {op.description && op.description !== '—' ? op.description : op.operation}
                </p>
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-500">
                    <tr>
                      {[...op.dimensions, ...op.measures.map((m) => measureHeader(m, op))].map((h) => (
                        <th key={h} scope="col" className="px-2 py-1 font-medium">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {op.rows.slice(0, MAX_TABLE_ROWS).map((r, i) => (
                      <tr key={i} className="border-t border-slate-100">
                        {r.keys.map((k, j) => <td key={j} className="px-2 py-0.5">{k}</td>)}
                        {r.values.map((v, j) => <td key={j} className="px-2 py-0.5 tabular-nums">{formatMeasure(v, op.measures[j])}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {op.rows.length > MAX_TABLE_ROWS && <p className="text-[11px] text-slate-400">Se listan {MAX_TABLE_ROWS} de {op.rows.length} filas.</p>}
              </div>
            ),
          ),
        )}
      </div>,
    ])
  }
  if (report.interpretation?.notes.length) {
    annexes.push(['Auditoría de la verificación de la IA', <ul key="a" className="text-xs text-slate-500">{report.interpretation.notes.map((t) => <li key={t}>{t}</li>)}</ul>])
  }

  return (
    <div ref={ref} className="space-y-6 rounded-xl border border-slate-200 bg-white p-5 sm:p-8" role="document" aria-label="Vista previa del informe">
      <Cover report={report} p={p} />

      <Section title={title('Resumen ejecutivo')}>
        <Outline items={executiveSummary(report)} />
      </Section>

      <Section title={title('Objetivo interpretado y alcance')}>
        <p className="text-sm font-semibold text-slate-900">
          {proposal?.interpretedObjective || (report.objective ? 'Ver el anexo «Pedido original».' : 'No se registró un objetivo.')}
        </p>
        {proposal && proposal.decisions.length > 0 && (
          <>
            <Sub>Decisiones que ayuda a evaluar</Sub>
            <Bullets items={proposal.decisions} />
          </>
        )}
        <p className="text-sm text-slate-700">
          Operaciones calculadas: {scope.operations.calculated} de {scope.operations.total}
          {proposal?.feasibility ? ` · Viabilidad declarada: ${FEASIBILITY_TEXT[proposal.feasibility] ?? proposal.feasibility}` : ''}.
        </p>
        {proposal && proposal.missingData.length > 0 && (
          <>
            <Sub>Datos que faltan para el resto del objetivo</Sub>
            <Bullets items={proposal.missingData} />
          </>
        )}
        <p className="text-xs text-slate-500">{scope.caveat}</p>
      </Section>

      {(kpis.length > 0 || report.derived.length > 0) && (
        <Section title={title('Indicadores principales')}>
          {kpis.length > 0 && (
            <ul className="grid gap-2 sm:grid-cols-3">
              {kpis.map((k) => (
                <li key={`${k.plan}-${k.id}`} className="rounded-lg border border-slate-200 p-2 text-sm">
                  <p className="text-xs text-slate-500">{k.label}</p>
                  <p className="font-semibold text-slate-900 tabular-nums">
                    {number.format(k.value)}
                    {k.unit && ` ${k.unit}`}
                  </p>
                </li>
              ))}
            </ul>
          )}
          {report.derived.length > 0 && (
            <>
              <Sub>Indicadores derivados (calculados a partir de los resultados de Pandas)</Sub>
              <Bullets items={report.derived.map((d) => `${d.ref} · ${d.fact}`)} />
            </>
          )}
        </Section>
      )}

      <Section title={title('Gráficos y hallazgos')}>
        <p className="text-[11px] text-slate-400">{PROVENANCE_LABELS.pandas}</p>
        <div className="grid gap-4 lg:grid-cols-2">
          {report.plans.flatMap((plan) =>
            plan.charts.map(({ chart, note, ref: opRef }) => (
              <div key={chart.id} className="space-y-1">
                <div data-report-chart={chart.id}>
                  <ChartCard chart={chart} />
                </div>
                {note && <p className="text-[11px] text-slate-500">{note}</p>}
                <Bullets items={operationFindings(report, opRef)} className="text-xs text-slate-700" />
              </div>
            )),
          )}
        </div>
        {others.length > 0 && (
          <>
            <Sub>Otros resultados calculados</Sub>
            {others.map((item) => (
              <div key={item.ref}>
                <p className="text-sm font-medium text-slate-800">{item.ref} · {item.title}</p>
                <Bullets items={item.facts} />
              </div>
            ))}
          </>
        )}
      </Section>

      <Section title={title('Interpretación orientada a decisiones')}>
        {ai ? (
          <div className="space-y-2">
            <p className="text-xs text-slate-500">
              Redactada por la IA ({report.interpretation!.usage.model}) con los resultados agregados autorizados. Cada cifra se
              recalculó sobre los resultados de Pandas; lo que no coincidía se descartó.
            </p>
            {([['Hallazgos principales', 'findings'], ['Tendencias y comparaciones', 'trends'], ['Implicaciones para el objetivo', 'implications'], ['Hipótesis a comprobar', 'hypotheses']] as const).map(([heading, key]) => {
              const list = aiItems(ai, key)
              return list.length ? (
                <div key={key}>
                  <Sub>{heading}</Sub>
                  <Outline items={list} />
                </div>
              ) : null
            })}
            {(ai.not_supported?.length ?? 0) > 0 && (
              <>
                <Sub>Lo que estos datos no permiten concluir</Sub>
                <Bullets items={ai.not_supported!} />
              </>
            )}
          </div>
        ) : (
          <p className="text-sm text-slate-500">
            No se incluyó una interpretación con IA: el informe se limita a los resultados calculados con Pandas, sin intervención de la IA.
          </p>
        )}
      </Section>

      <Section title={title('Recomendaciones y limitaciones')}>
        {ai && aiItems(ai, 'recommendations').length > 0 && (
          <>
            <Sub>Recomendaciones (condicionadas a los resultados)</Sub>
            <Outline items={aiItems(ai, 'recommendations')} />
          </>
        )}
        {ai && (ai.information_needed?.length ?? 0) > 0 && (
          <>
            <Sub>Información adicional que ayudaría a decidir</Sub>
            <Bullets items={ai.information_needed!} />
          </>
        )}
        {scope.pending.length > 0 && (
          <>
            <Sub>Cuestiones pendientes</Sub>
            <Bullets items={scope.pending} className="text-amber-900" />
          </>
        )}
        <Sub>Lo que no se puede concluir</Sub>
        <Bullets items={scope.notConcludable} />
        {(cautions.length > 0 || (ai?.limitations.length ?? 0) > 0) && (
          <>
            <Sub>Limitaciones y advertencias del cálculo</Sub>
            <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
              {cautions.map((w) => (
                <li key={w.text}>
                  {w.text}
                  {w.clarification && <p className="text-xs text-blue-800">{w.clarification}</p>}
                </li>
              ))}
              {ai?.limitations.map((t) => <li key={t}>{t}</li>)}
            </ul>
          </>
        )}
      </Section>

      <Section title={title('Metodología, fuentes y detalles técnicos')}>
        <Sub>Origen de cada contenido</Sub>
        <Bullets items={Object.values(PROVENANCE_LABELS)} className="text-xs text-slate-600" />
        <ul className="text-sm text-slate-700">
          {report.sources.map((s) => (
            <li key={s.alias}>
              Fuente {s.alias}
              {s.fileName && ` · ${s.fileName}`} · {number.format(s.rows)} registros · {s.columns} columnas
            </li>
          ))}
        </ul>
        <p className="text-sm text-slate-600">Origen de los cálculos: DataDecision AI. {METHODOLOGY_TEXT}</p>
        <Bullets items={report.engineNotes} className="text-xs text-slate-500" />
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                {['Ref.', 'Plan', 'Operación', 'Columnas', 'Filas', 'Estado'].map((h) => (
                  <th key={h} scope="col" className="px-2 py-1 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {report.methodology.map((m) => (
                <tr key={m.ref} className="border-t border-slate-100 align-top">
                  <td className="px-2 py-1 font-mono">{m.ref}</td>
                  <td className="px-2 py-1">{m.plan}</td>
                  <td className="px-2 py-1">{m.operation}</td>
                  <td className="px-2 py-1">{m.columns}</td>
                  <td className="px-2 py-1 tabular-nums">{m.rowsUsed === null ? '—' : number.format(m.rowsUsed)}</td>
                  <td className={m.status === 'ok' ? 'px-2 py-1' : 'px-2 py-1 text-red-700'}>{m.status === 'ok' ? 'Calculada' : `Falló: ${m.error ?? ''}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {ai && ai.data_quality.length > 0 && (
          <>
            <Sub>Calidad de los datos señalada en la interpretación</Sub>
            <Bullets items={ai.data_quality} />
          </>
        )}
      </Section>

      {annexes.map(([heading, content], i) => (
        <Section key={heading} title={`Anexo ${String.fromCharCode(65 + i)}. ${heading}`}>
          {content}
        </Section>
      ))}
    </div>
  )
})
