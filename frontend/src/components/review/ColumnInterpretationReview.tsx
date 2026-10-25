import type { SemanticType } from '@/types/domain'
import type { FormatChoice, MarkerDecision, SourceReview } from '@/lib/aiContext'
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

const SEMANTIC_CHOICES: SemanticType[] = ['quantitative', 'categorical', 'identifier', 'temporal', 'text']

interface Props {
  alias: string
  source: AnalysisSource
  review: SourceReview
  onChange: (review: SourceReview) => void
}

/**
 * Interpretación de las columnas de una fuente. Por defecto se aceptan las
 * sugerencias; el usuario corrige solo lo necesario. Las decisiones se guardan
 * aparte: no cambian el archivo, el perfil ni los valores (tampoco los "NA").
 */
export function ColumnInterpretationReview({ alias, source, review, onChange }: Props) {
  const { dataset, profile } = source

  function update(column: string, changes: Partial<SourceReview['columns'][string]>) {
    onChange({ ...review, columns: { ...review.columns, [column]: { ...review.columns[column], ...changes } } })
  }

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
              return (
                <tr key={column.name}>
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
              )
            })}
          </tbody>
        </table>
      </div>
    </Card>
  )
}
