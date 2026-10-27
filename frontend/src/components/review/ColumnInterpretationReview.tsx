import { Fragment } from 'react'
import type { Additivity, ColumnProfile, SemanticType } from '@/types/domain'
import { effectiveMeasure, type FormatChoice, type MarkerDecision, type SourceReview } from '@/lib/aiContext'
import type { AnalysisSource } from '@/lib/datasetCatalog'
import { ColumnTypeTag, SemanticTag } from '@/components/upload/DatasetPreview'
import { Card, CardHeader } from '@/components/ui/Card'
import { cn } from '@/lib/cn'
import { formatNumber } from '@/lib/format'
import { SEMANTIC_LABEL } from '@/lib/profileMetrics'

const FORMAT_LABEL: Record<FormatChoice, string> = {
  integer: 'Entero',
  decimal: 'Decimal',
  text: 'Texto',
  date: 'Fecha',
  boolean: 'Sí/No',
}

const MARKER_LABEL: Record<MarkerDecision, string> = {
  pending: 'Decidir más adelante',
  treat_as_missing: 'Tratar como faltante',
  valid_value: 'Es un valor válido',
}

const ADDITIVITY_LABEL: Record<Additivity, string> = {
  additive: 'Sí: importe, cantidad o conteo',
  non_additive: 'No: tasa, %, promedio, índice o stock',
}

const SEMANTIC_CHOICES: SemanticType[] = ['quantitative', 'categorical', 'identifier', 'temporal', 'text']

interface Props {
  alias: string
  source: AnalysisSource
  review: SourceReview
  onChange: (review: SourceReview) => void
}

const input = 'h-8 rounded border border-slate-200 px-1.5 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 focus:outline-none'

/**
 * Interpretación de las columnas de una fuente. Por defecto se aceptan las
 * sugerencias; el usuario corrige solo lo necesario. Las decisiones se guardan
 * aparte: no cambian el archivo, el perfil ni los valores (tampoco los "NA").
 *
 * Para cada medida (columna cuantitativa) se decide además su unidad, si se puede
 * sumar y de qué columnas depende su significado: con eso el motor nunca suma
 * tasas ni mezcla indicadores o unidades distintas.
 */
export function ColumnInterpretationReview({ alias, source, review, onChange }: Props) {
  const { dataset, profile } = source

  function update(column: string, changes: Partial<SourceReview['columns'][string]>) {
    onChange({ ...review, columns: { ...review.columns, [column]: { ...review.columns[column], ...changes } } })
  }

  // Columnas que pueden definir qué mide un valor: categóricas o códigos compartidos con la IA.
  const splitCandidates = (measure: ColumnProfile) =>
    profile.columns.filter((c) => {
      if (c.name === measure.name || !review.columns[c.name]?.include) return false
      const type = review.columns[c.name]?.semanticType ?? c.semanticType
      return type === 'categorical' || type === 'identifier'
    })

  return (
    <Card>
      <CardHeader
        title={`Fuente ${alias} · ${dataset.fileName}`}
        description={`${profile.rowCount === null ? '' : `${formatNumber(profile.rowCount)} filas · `}${profile.columnCount} columnas. Dejá «Aceptar» donde la sugerencia sea correcta.`}
      />
      <div className="scrollbar-thin mt-3 overflow-x-auto border-t border-slate-100">
        <table className="w-full min-w-[720px] text-left text-xs">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="px-4 py-2.5 font-medium">Columna</th>
              <th className="px-4 py-2.5 font-medium">Detectado automáticamente</th>
              <th className="px-4 py-2.5 font-medium">Formato</th>
              <th className="px-4 py-2.5 font-medium">Significado estadístico</th>
              <th className="px-4 py-2.5 font-medium">Posibles marcadores de ausencia</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {profile.columns.map((column) => {
              const decision = review.columns[column.name]
              const suspected = column.suspectedMissingCount ?? 0
              const measure = decision?.include ? effectiveMeasure(column, review) : null
              const candidates = measure ? splitCandidates(column) : []
              const missingValues = decision?.missingValues ?? []
              const missingSuggestions = (column.missingValueSuggestions ?? []).filter((v) => !missingValues.map((m) => m.trim()).includes(v))
              return (
                <Fragment key={column.name}>
                  <tr>
                    <td className="px-4 py-2.5 font-medium text-slate-800">{column.name}</td>
                    <td className="px-4 py-2.5">
                      <span className="flex flex-wrap items-center gap-1">
                        <ColumnTypeTag type={column.inferredType} />
                        <SemanticTag column={column} />
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <select
                        aria-label={`Formato de ${column.name} (fuente ${alias})`}
                        value={decision?.format ?? ''}
                        onChange={(e) => update(column.name, { format: (e.target.value || null) as FormatChoice | null })}
                        className={cn('h-8 rounded border px-1.5', decision?.format ? 'border-blue-400 bg-blue-50' : 'border-slate-200')}
                      >
                        <option value="">Aceptar</option>
                        {(Object.keys(FORMAT_LABEL) as FormatChoice[]).map((f) => (
                          <option key={f} value={f}>
                            {FORMAT_LABEL[f]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-2.5">
                      <select
                        aria-label={`Significado de ${column.name} (fuente ${alias})`}
                        value={decision?.semanticType ?? ''}
                        onChange={(e) => update(column.name, { semanticType: (e.target.value || null) as SemanticType | null })}
                        className={cn('h-8 rounded border px-1.5', decision?.semanticType ? 'border-blue-400 bg-blue-50' : 'border-slate-200')}
                      >
                        <option value="">{column.semanticType ? `Aceptar (${SEMANTIC_LABEL[column.semanticType]})` : 'Aceptar'}</option>
                        {SEMANTIC_CHOICES.map((t) => (
                          <option key={t} value={t}>
                            {SEMANTIC_LABEL[t]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-2.5">
                      {suspected > 0 ? (
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-amber-700">{formatNumber(suspected)}</span>
                          <select
                            aria-label={`Marcadores de ausencia de ${column.name} (fuente ${alias})`}
                            value={decision?.markers ?? 'pending'}
                            onChange={(e) => update(column.name, { markers: e.target.value as MarkerDecision })}
                            className="h-8 rounded border border-amber-300 bg-amber-50 px-1.5"
                          >
                            {(Object.keys(MARKER_LABEL) as MarkerDecision[]).map((m) => (
                              <option key={m} value={m}>
                                {MARKER_LABEL[m]}
                              </option>
                            ))}
                          </select>
                        </span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                  </tr>
                  {measure && (
                    <tr className="bg-slate-50/60">
                      <td colSpan={5} className="px-4 pt-1 pb-3">
                        <div className="flex flex-wrap items-start gap-x-5 gap-y-2" role="group" aria-label={`Medida ${column.name} (fuente ${alias})`}>
                          <label className="flex flex-col gap-1 text-slate-600">
                            Unidad
                            <input
                              aria-label={`Unidad de ${column.name} (fuente ${alias})`}
                              value={decision?.unit ?? measure.unit ?? ''}
                              onChange={(e) => update(column.name, { unit: e.target.value.slice(0, 24) })}
                              placeholder="ARS, %, kg…"
                              title={column.unitReason ?? undefined}
                              className={cn(input, 'w-28')}
                            />
                          </label>
                          <label className="flex flex-col gap-1 text-slate-600">
                            ¿Se puede sumar?
                            <select
                              aria-label={`¿Se puede sumar ${column.name}? (fuente ${alias})`}
                              value={measure.additivity ?? 'additive'}
                              onChange={(e) => update(column.name, { additivity: e.target.value as Additivity })}
                              title={column.additivityReason ?? undefined}
                              className={input}
                            >
                              {(Object.keys(ADDITIVITY_LABEL) as Additivity[]).map((a) => (
                                <option key={a} value={a}>
                                  {ADDITIVITY_LABEL[a]}
                                </option>
                              ))}
                            </select>
                          </label>
                          {candidates.length > 0 && (
                            <fieldset className="flex flex-col gap-1 text-slate-600">
                              <legend className="mb-1">¿Su significado depende de otra columna? (indicador, unidad)</legend>
                              <span className="flex flex-wrap gap-x-3 gap-y-1">
                                {candidates.map((c) => (
                                  <label key={c.name} className="flex items-center gap-1">
                                    <input
                                      type="checkbox"
                                      aria-label={`${column.name} depende de ${c.name} (fuente ${alias})`}
                                      checked={measure.splitBy.includes(c.name)}
                                      onChange={(e) =>
                                        update(column.name, {
                                          splitBy: e.target.checked
                                            ? [...measure.splitBy, c.name]
                                            : measure.splitBy.filter((n) => n !== c.name),
                                        })
                                      }
                                      className="size-3.5 accent-blue-600"
                                    />
                                    {c.name}
                                  </label>
                                ))}
                              </span>
                            </fieldset>
                          )}
                          <label className="flex flex-col gap-1 text-slate-600">
                            Otros valores faltantes
                            <input
                              aria-label={`Valores faltantes de ${column.name} (fuente ${alias})`}
                              value={missingValues.join(',')}
                              onChange={(e) => update(column.name, { missingValues: e.target.value.split(',').slice(0, 20) })}
                              placeholder="-99, 9999…"
                              className={cn(input, 'w-32')}
                            />
                          </label>
                          {missingSuggestions.length > 0 && (
                            <button
                              type="button"
                              onClick={() => update(column.name, { missingValues: [...missingValues.filter((v) => v.trim()), ...missingSuggestions] })}
                              className="self-end rounded border border-amber-300 bg-amber-50 px-2 py-1 text-amber-900 hover:bg-amber-100"
                            >
                              Tratar {missingSuggestions.join(', ')} como faltante
                            </button>
                          )}
                        </div>
                        <ul className="mt-1.5 space-y-0.5 text-[11px] text-slate-500">
                          {column.splitReason && measure.splitBy.length > 0 && <li>Sugerencia: {column.splitReason}</li>}
                          {column.additivityReason && <li>{column.additivityReason}</li>}
                          {missingSuggestions.length > 0 && (
                            <li className="text-amber-800">
                              {missingSuggestions.join(', ')} {missingSuggestions.length === 1 ? 'está' : 'están'} fuera del rango del resto: ¿indica un dato faltante?
                            </li>
                          )}
                        </ul>
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="border-t border-slate-100 px-4 py-2.5 text-[11px] text-slate-500">
        La unidad, si se puede sumar y de qué columnas depende cada medida se comparten con la IA como metadatos. Los
        valores faltantes que escribas son valores de tus datos: se usan solo para calcular, nunca se envían a la IA.
      </p>
    </Card>
  )
}
