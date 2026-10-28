import { forwardRef, type ReactNode } from 'react'
import { ChartCard } from '@/components/charts/ChartCard'
import { formatMeasure, measureHeader, METHODOLOGY_TEXT, splitVerified, unverifiedItems, type ReportDocument } from '@/lib/report'
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

/**
 * Vista previa del informe, con el mismo contenido y orden que el PDF. Los gráficos
 * son los del dashboard (sin animación) y se capturan de aquí al descargar: los
 * contenedores `data-report-chart` identifican cada uno.
 */
export const ReportPreview = forwardRef<HTMLDivElement, { report: ReportDocument }>(function ReportPreview({ report }, ref) {
  const ai = report.interpretation
  return (
    <div ref={ref} className="space-y-6 rounded-xl border border-slate-200 bg-white p-5 sm:p-8" role="document" aria-label="Vista previa del informe">
      <header className="space-y-1">
        <p className="text-xs font-semibold tracking-wide text-blue-700 uppercase">DataDecision AI</p>
        <h2 className="text-2xl font-bold text-slate-900">{report.title}</h2>
        <p className="text-slate-500">{report.projectName}</p>
        <p className="text-xs text-slate-500">
          Generado el {dateTime.format(report.generatedAt)} · resultados calculados el {dateTime.format(new Date(report.executedAt))}
        </p>
      </header>

      <Section title="Objetivo del análisis">
        <p className="text-sm text-slate-700">{report.objective ?? 'No se registró un objetivo para esta ejecución.'}</p>
      </Section>

      <Section title="Resumen ejecutivo (descriptivo, calculado sin IA)">
        {report.summary?.executive.length ? (
          <ul className="list-disc space-y-0.5 pl-5 text-sm text-slate-700">
            {report.summary.executive.map((line) => <li key={line}>{line}</li>)}
          </ul>
        ) : (
          <p className="text-sm text-slate-500">El backend no informó un resumen descriptivo para esta ejecución.</p>
        )}
      </Section>

      <Section title="Fuentes de datos">
        <ul className="text-sm text-slate-700">
          {report.sources.map((s) => (
            <li key={s.alias}>
              Fuente {s.alias}
              {s.fileName && ` · ${s.fileName}`} · {number.format(s.rows)} registros · {s.columns} columnas
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Operaciones y metodología">
        <p className="text-sm text-slate-600">{METHODOLOGY_TEXT}</p>
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

      <Section title="Resultados">
        {report.plans.map((plan) => (
          <div key={`${plan.sourceAlias}-${plan.title}`} className="space-y-3">
            <p className="font-semibold text-slate-900">
              {plan.title} · fuente {plan.sourceAlias}
            </p>
            {plan.kpis.length > 0 && (
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
            )}
            <div className="grid gap-3 lg:grid-cols-2">
              {plan.charts.map(({ chart, note }) => (
                <div key={chart.id} data-report-chart={chart.id} className="space-y-1">
                  <ChartCard chart={chart} />
                  {note && <p className="text-[11px] text-slate-500">{note}</p>}
                </div>
              ))}
            </div>
            {plan.tables
              .filter(({ op }) => op.operation !== 'scatter' && op.operation !== 'roc_curve')
              .map(({ ref, op }) => (
                <div key={ref} className="overflow-x-auto">
                  <p className="text-xs font-medium text-slate-700">
                    {ref} · {op.description && op.description !== '—' ? op.description : op.operation}
                  </p>
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 text-slate-500">
                      <tr>
                        {[...op.dimensions, ...op.measures.map(measureHeader)].map((h) => (
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
              ))}
            {plan.errors.length > 0 && (
              <ul className="space-y-0.5 text-xs text-red-800">
                {plan.errors.map((e) => (
                  <li key={e.title}>No se pudo calcular {e.title}: {e.message}</li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </Section>

      <Section title="Interpretación">
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
                    {item.facts.map((f) => <li key={f}>{f}</li>)}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-slate-500">El backend no informó un resumen descriptivo para esta ejecución.</p>
        )}

        <p className="pt-2 text-sm font-semibold text-slate-800">Interpretación con IA</p>
        {ai ? (
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
        ) : (
          <p className="text-sm text-slate-500">
            No se incluyó una interpretación con IA. Este informe contiene solo el resumen descriptivo calculado, sin
            intervención de la IA.
          </p>
        )}
      </Section>

      <Section title="Advertencias y limitaciones">
        <ul className="list-disc space-y-0.5 pl-5 text-sm text-slate-700">
          {[...report.warnings, ...report.engineNotes].map((w) => <li key={w}>{w}</li>)}
        </ul>
      </Section>
    </div>
  )
})
