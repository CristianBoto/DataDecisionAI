import { useMemo, useState } from 'react'
import { Info } from 'lucide-react'
import { ChartCard } from '@/components/charts/ChartCard'
import {
  dimensionName,
  dimensionValues,
  freeDimensions,
  normalizeSelection,
  operationTitle,
  viewCharts,
  type ChartView as View,
  type ViewSelection,
  MAX_SERIES,
} from '@/lib/dashboard'

const select = 'h-8 max-w-[14rem] rounded border border-slate-300 bg-white px-1.5 text-xs focus:border-blue-500 focus:ring-2 focus:ring-blue-100 focus:outline-none'

/**
 * Un gráfico del dashboard. Si el resultado tiene varias dimensiones, la persona elige
 * qué va en el eje, qué categorías son series y filtra las demás. Las dimensiones que
 * definen qué se mide (indicador, unidad) solo se filtran: nunca se mezclan en un eje.
 * No se calcula nada: cada punto es un valor del motor Pandas.
 */
export function ChartViewCard({ view }: { view: View }) {
  const [selection, setSelection] = useState<ViewSelection | null>(view.selection)
  const built = useMemo(() => viewCharts(view, selection), [view, selection])
  const op = view.op
  const title = operationTitle(op)

  function change(next: Partial<ViewSelection>) {
    if (!selection) return
    setSelection(normalizeSelection(op, { ...selection, ...next }))
  }

  const free = freeDimensions(op)
  return (
    <div className="flex flex-col gap-2">
      {view.explorable && selection && (
        <div className="flex flex-wrap items-end gap-2 rounded-xl border border-slate-200 bg-slate-50 p-2.5 text-xs text-slate-600" role="group" aria-label={`Controles: ${title}`}>
          {free.length > 1 && (
            <label className="flex flex-col gap-0.5">
              Eje
              <select aria-label={`Eje de ${title}`} value={selection.x} onChange={(e) => change({ x: e.target.value })} className={select}>
                {free.map((d) => (
                  <option key={d} value={d}>{dimensionName(op, d)}</option>
                ))}
              </select>
            </label>
          )}
          {free.length > 1 && (
            <label className="flex flex-col gap-0.5">
              Series
              <select
                aria-label={`Series de ${title}`}
                value={selection.series ?? ''}
                onChange={(e) => change({ series: e.target.value || null, seriesValues: [] })}
                className={select}
              >
                <option value="">Ninguna (filtrar)</option>
                {free.filter((d) => d !== selection.x).map((d) => (
                  <option key={d} value={d}>{dimensionName(op, d)}</option>
                ))}
              </select>
            </label>
          )}
          {Object.entries(selection.filters).map(([dimension, value]) => (
            <label key={dimension} className="flex flex-col gap-0.5">
              {dimensionName(op, dimension)}
              <select
                aria-label={`Filtro ${dimension} de ${title}`}
                value={value}
                onChange={(e) => change({ filters: { ...selection.filters, [dimension]: e.target.value }, seriesValues: [] })}
                className={select}
              >
                {dimensionValues(op, dimension).map((v) => (
                  <option key={v} value={v}>{v}</option>
                ))}
              </select>
            </label>
          ))}
          {selection.series && dimensionValues(op, selection.series).length > MAX_SERIES && (
            <details className="relative">
              <summary className="cursor-pointer rounded border border-slate-300 bg-white px-2 py-1.5">
                Elegir categorías ({selection.seriesValues.length} de máx. {MAX_SERIES})
              </summary>
              <div className="absolute z-10 mt-1 max-h-56 w-56 overflow-auto rounded-lg border border-slate-200 bg-white p-2 shadow-elevated">
                {dimensionValues(op, selection.series).map((v) => {
                  const checked = selection.seriesValues.includes(v)
                  return (
                    <label key={v} className="flex items-center gap-1.5 py-0.5">
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={!checked && selection.seriesValues.length >= MAX_SERIES}
                        onChange={() =>
                          change({ seriesValues: checked ? selection.seriesValues.filter((s) => s !== v) : [...selection.seriesValues, v] })
                        }
                        className="size-3.5 accent-blue-600"
                      />
                      {v}
                    </label>
                  )
                })}
              </div>
            </details>
          )}
        </div>
      )}
      {built.charts.map((chart) => <ChartCard key={chart.id} chart={chart} />)}
      {built.notice && (
        <p className="flex items-start gap-1.5 text-xs text-slate-500">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden /> {built.notice}
        </p>
      )}
    </div>
  )
}
