import { forwardRef, type ReactNode } from 'react'
import { ChartCard } from '@/components/charts/ChartCard'
import { parseObjective } from '@/lib/objectiveMarkdown'
import { defaultPresentation, type PdfPresentation } from '@/lib/pdfCustomization'
import { defaultReportTitle, findingFacts, formatMeasure, measureHeader, METHODOLOGY_TEXT, splitVerified, unverifiedItems, type ReportDocument } from '@/lib/report'
import type { AIInterpretation, InterpretationItem } from '@/services/aiGateway'

const dateTime = new Intl.DateTimeFormat('es-AR', { dateStyle: 'long', timeStyle: 'short' })
const number = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 })
/** Mismo límite que el PDF: la vista previa muestra lo que se va a descargar. */
const MAX_TABLE_ROWS = 25

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2" aria-label={title}>
      <h3 className="border-b border-slate-200 pb-1 text-base font-semibold text-blue-800">{title}</h3>
      {children}
    </section>
  )
}

/** Solo las afirmaciones con cifras recalculadas sobre los resultados («respaldadas por los cálculos»). */
function Items({ title, interpretation, section }: { title: string; interpretation: AIInterpretation; section: 'executive_summary' | 'findings' | 'trends' | 'recommendations' }) {
  const values: InterpretationItem[] = splitVerified(interpretation, section).verified
  if (!values.length) return null
  return (
    <div>
      <p className="text-sm font-semibold text-slate-800">{title}</p>
      <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-slate-700">
        {values.map((v) => (
          <li key={v.text}>
            {v.text} <span className="text-xs text-slate-400">[{v.evidence.join(', ')}]</span>
          </li>
        ))}
      </ul>
    </div>
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
    <header className={p.showBrand ? 'space-y-3 border-t-4 border-blue-700 pt-3' : 'space-y-3'} aria-label="Portada">
      {p.showBrand && <p className="text-xs font-semibold tracking-wide text-blue-700 uppercase">DataDecision AI</p>}
      {p.logo && <img src={p.logo.dataUrl} alt="Logo de la portada" className="max-h-20 max-w-56 object-contain" />}
      <div className="space-y-1 pt-2">
        {p.organization && <p className="font-semibold text-slate-500">{p.organization}</p>}
        <h2 className="text-2xl font-bold break-words text-slate-900">{p.title}</h2>
        <p className="text-slate-500">Proyecto: {report.projectName}</p>
        {p.author && <p className="text-sm text-slate-700">Responsable: {p.author}</p>}
        {p.showDate && (
          <p className="text-xs text-slate-500">
            Elaborado el {dateTime.format(report.generatedAt)} · resultados calculados el {dateTime.format(new Date(report.executedAt))}
          </p>
        )}
      </div>
      <p className={report.scope.tone === 'ok' ? 'text-xs text-slate-500' : 'text-xs text-amber-800'}>{report.scope.headline}</p>
      {p.showBrand && <p className="text-[11px] text-slate-400">Elaborado con DataDecision AI · cálculos con Python y Pandas</p>}
    </header>
  )
}

/**
 * Vista previa del informe, con el mismo contenido y orden que el PDF. Los gráficos
 * son los del dashboard (sin animación) y se capturan de aquí al descargar: los
 * contenedores `data-report-chart` identifican cada uno. La personalización solo
 * cambia la portada y la presentación, nunca los resultados.
 */
export const ReportPreview = forwardRef<HTMLDivElement, { report: ReportDocument; presentation?: PdfPresentation }>(function ReportPreview(
  { report, presentation },
  ref,
) {
  const p = presentation ?? defaultPresentation(defaultReportTitle(report))
  const ai = report.interpretation
  const scope = report.scope
  let n = 0
  const title = (t: string) => `${(n += 1)}. ${t}`
  return (
    <div ref={ref} className="space-y-6 rounded-xl border border-slate-200 bg-white p-5 sm:p-8" role="document" aria-label="Vista previa del informe">
      <Cover report={report} p={p} />

      <Section title={title('Objetivo original del análisis')}>
        <Objective text={report.objective} />
      </Section>

      <Section title={title('Alcance real y estado de cobertura')}>
        <p className={scope.tone === 'ok' ? 'text-sm font-semibold text-slate-900' : 'text-sm font-semibold text-amber-900'}>{scope.headline}</p>
        <p className="text-sm text-slate-700">
          Operaciones aprobadas y ejecutadas: {scope.operations.calculated} de {scope.operations.total} calculadas (
          {scope.operations.plans === 1 ? '1 plan' : `${scope.operations.plans} planes`}).
        </p>
        {scope.calculated.length > 0 && (
          <>
            <p className="text-sm font-semibold text-slate-800">Resultados efectivamente calculados</p>
            <ul className="list-disc space-y-0.5 pl-5 text-sm text-slate-700">{scope.calculated.map((c) => <li key={c}>{c}</li>)}</ul>
          </>
        )}
        <p className={scope.pending.length ? 'text-xs text-amber-800' : 'text-xs text-slate-500'}>
          {scope.pending.length
            ? `Cuestiones pendientes detectadas: ${scope.pending.length}. El detalle está en la sección «Cuestiones pendientes, advertencias y limitaciones».`
            : 'No se detectaron cuestiones pendientes.'}
        </p>
        <p className="text-xs text-slate-500">{scope.caveat}</p>
      </Section>

      <Section title={title('Resumen ejecutivo (descriptivo, calculado sin IA)')}>
        {report.summary?.executive.length ? (
          <ul className="list-disc space-y-0.5 pl-5 text-sm text-slate-700">
            {report.summary.executive.map((line) => <li key={line}>{line}</li>)}
          </ul>
        ) : (
          <p className="text-sm text-slate-500">El backend no informó un resumen descriptivo para esta ejecución.</p>
        )}
      </Section>

      <Section title={title('Fuentes de datos y metodología')}>
        <ul className="text-sm text-slate-700">
          {report.sources.map((s) => (
            <li key={s.alias}>
              Fuente {s.alias}
              {s.fileName && ` · ${s.fileName}`} · {number.format(s.rows)} registros · {s.columns} columnas
            </li>
          ))}
        </ul>
        <p className="text-sm text-slate-600">Origen de los cálculos: DataDecision AI. {METHODOLOGY_TEXT}</p>
        <p className="text-sm text-slate-500">
          {ai
            ? `Interpretación: incluye una interpretación redactada por la IA (${ai.usage.model}) que la persona autorizó; cada cifra se verificó contra los resultados.`
            : 'No se incluyó una interpretación con IA: el informe contiene solo resultados calculados con Pandas, sin intervención de la IA.'}
        </p>
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
                  <td className={m.status === 'ok' ? 'px-2 py-1' : 'px-2 py-1 text-red-700'}>
                    {m.status === 'ok' ? 'Calculada' : `Falló: ${m.error ?? ''}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title={title('Indicadores y resultados calculados')}>
        {report.plans
          .filter((plan) => plan.kpis.length > 0)
          .map((plan) => (
            <div key={`${plan.sourceAlias}-${plan.title}`} className="space-y-2">
              <p className="font-semibold text-slate-900">
                {plan.title} · fuente {plan.sourceAlias}
              </p>
              <ul className="grid gap-2 sm:grid-cols-3">
                {plan.kpis.map((k) => (
                  <li key={k.id} className="rounded-lg border border-slate-200 p-2 text-sm">
                    <p className="text-xs text-slate-500">{k.label}</p>
                    <p className="font-semibold text-slate-900 tabular-nums">
                      {number.format(k.value)}
                      {k.unit && ` ${k.unit}`}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        {report.derived.length > 0 && (
          <div>
            <p className="text-sm font-semibold text-slate-800">Indicadores derivados (calculados a partir de los resultados de Pandas)</p>
            <p className="text-xs text-slate-500">
              Variación entre el primer y el último período de cada serie. No es una operación aparte del catálogo: se
              obtiene de los valores ya calculados.
            </p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-slate-700">
              {report.derived.map((d) => (
                <li key={d.fact}>
                  {d.ref} · {d.fact}
                </li>
              ))}
            </ul>
          </div>
        )}
        <p className="text-sm font-semibold text-slate-800">Hallazgos calculados (resumen descriptivo con Pandas, sin IA)</p>
        {report.summary ? (
          <ul className="space-y-2 text-sm text-slate-700">
            {report.summary.items.map((item) => (
              <li key={item.ref}>
                <span className="font-medium">
                  {item.ref} · {item.title}
                </span>
                {item.status === 'error' ? (
                  <p className="text-red-800">No se pudo calcular: {item.error}</p>
                ) : (
                  <ul className="list-disc pl-5">
                    {findingFacts(item, report.derived).map((f) => <li key={f}>{f}</li>)}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-slate-500">El backend no informó un resumen descriptivo para esta ejecución.</p>
        )}
      </Section>

      {report.plans.some((plan) => plan.charts.length > 0) && (
        <Section title={title('Gráficos')}>
          {report.plans
            .filter((plan) => plan.charts.length > 0)
            .map((plan) => (
              <div key={`${plan.sourceAlias}-${plan.title}`} className="space-y-2">
                <p className="font-semibold text-slate-900">
                  {plan.title} · fuente {plan.sourceAlias}
                </p>
                <div className="grid gap-3 lg:grid-cols-2">
                  {plan.charts.map(({ chart, note }) => (
                    <div key={chart.id} data-report-chart={chart.id} className="space-y-1">
                      <ChartCard chart={chart} />
                      {note && <p className="text-[11px] text-slate-500">{note}</p>}
                    </div>
                  ))}
                </div>
              </div>
            ))}
        </Section>
      )}

      <Section title={title('Tablas con valores exactos')}>
        {report.plans.map((plan) => (
          <div key={`${plan.sourceAlias}-${plan.title}`} className="space-y-3">
            <p className="font-semibold text-slate-900">
              {plan.title} · fuente {plan.sourceAlias}
            </p>
            {plan.tables.map(({ ref, op }) =>
              op.operation === 'scatter' || op.operation === 'roc_curve' ? (
                <p key={ref} className="text-xs text-slate-700">
                  <span className="font-medium">{ref} · {op.description && op.description !== '—' ? op.description : op.operation}</span>:{' '}
                  {Object.entries(op.stats ?? {})
                    .filter(([k]) => ['pearson', 'spearman', 'n', 'auc', 'positives', 'negatives'].includes(k))
                    .map(([k, v]) => `${k}: ${typeof v === 'number' ? v.toLocaleString('es-AR', { maximumFractionDigits: 4 }) : String(v)}`)
                    .join(' · ')}
                </p>
              ) : (
                <div key={ref} className="overflow-x-auto">
                  <p className="text-xs font-medium text-slate-700">
                    {ref} · {op.description && op.description !== '—' ? op.description : op.operation}
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
                          {r.values.map((v, j) => (
                            <td key={j} className="px-2 py-0.5 tabular-nums">{formatMeasure(v, op.measures[j])}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {op.rows.length > MAX_TABLE_ROWS && (
                    <p className="text-[11px] text-slate-400">Se listan {MAX_TABLE_ROWS} de {op.rows.length} filas.</p>
                  )}
                </div>
              ),
            )}
          </div>
        ))}
      </Section>

      {ai && (
        <Section title={title('Interpretación con IA')}>
          <div className="space-y-3">
            <p className="text-xs text-slate-500">
              Redactada por la IA ({ai.usage.model}) a partir de los resultados agregados autorizados. Cada cifra se
              recalculó sobre los resultados de Pandas (operación, categoría, período y unidad); entre corchetes, las
              operaciones que la respaldan.
            </p>
            <Items title="Resumen ejecutivo" interpretation={ai.interpretation} section="executive_summary" />
            <Items title="Hallazgos principales" interpretation={ai.interpretation} section="findings" />
            <Items title="Tendencias y comparaciones" interpretation={ai.interpretation} section="trends" />
            <Items title="Recomendaciones y líneas de análisis" interpretation={ai.interpretation} section="recommendations" />
            {unverifiedItems(ai.interpretation).length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-2">
                <p className="text-sm font-semibold text-amber-900">No verificadas automáticamente (sin cifras)</p>
                <ul className="list-disc pl-5 text-sm text-amber-900">
                  {unverifiedItems(ai.interpretation).map(({ section, item }) => (
                    <li key={item.text}>
                      {section}: {item.text} <span className="text-xs">[{item.evidence.join(', ')}]</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {ai.interpretation.data_quality.length > 0 && (
              <div>
                <p className="text-sm font-semibold text-slate-800">Calidad de los datos</p>
                <ul className="list-disc pl-5 text-sm text-slate-700">{ai.interpretation.data_quality.map((t) => <li key={t}>{t}</li>)}</ul>
              </div>
            )}
            {ai.interpretation.limitations.length > 0 && (
              <div>
                <p className="text-sm font-semibold text-slate-800">Limitaciones señaladas por la IA</p>
                <ul className="list-disc pl-5 text-sm text-slate-700">{ai.interpretation.limitations.map((t) => <li key={t}>{t}</li>)}</ul>
              </div>
            )}
            {ai.notes.length > 0 && (
              <div>
                <p className="text-sm font-semibold text-slate-800">Verificación automática de la interpretación</p>
                <ul className="text-xs text-slate-500">{ai.notes.map((n) => <li key={n}>{n}</li>)}</ul>
              </div>
            )}
          </div>
        </Section>
      )}

      <Section title={title('Cuestiones pendientes, advertencias y limitaciones')}>
        <p className="text-sm font-semibold text-slate-800">Cuestiones pendientes detectadas</p>
        {scope.pending.length ? (
          <ul className="list-disc space-y-0.5 pl-5 text-sm text-amber-900">{scope.pending.map((t) => <li key={t}>{t}</li>)}</ul>
        ) : (
          <p className="text-sm text-slate-500">No se detectaron partes del objetivo sin calcular.</p>
        )}
        <p className="text-sm font-semibold text-slate-800">Lo que estos resultados no permiten concluir</p>
        <ul className="list-disc space-y-0.5 pl-5 text-sm text-slate-700">{scope.notConcludable.map((t) => <li key={t}>{t}</li>)}</ul>
        {report.warningNotes.length > 0 && (
          <>
            <p className="text-sm font-semibold text-slate-800">Advertencias del cálculo y limitaciones de los planes</p>
            <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
              {report.warningNotes.map((w) => (
                <li key={w.text}>
                  {w.text}
                  {w.clarification && <p className="text-xs text-blue-800">{w.clarification}</p>}
                </li>
              ))}
            </ul>
          </>
        )}
        <p className="text-xs text-slate-500">{scope.caveat}</p>
      </Section>
    </div>
  )
})
