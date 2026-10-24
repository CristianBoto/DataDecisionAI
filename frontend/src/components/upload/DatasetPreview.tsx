import { Calendar, CircleHelp, Hash, ToggleLeft, Type } from 'lucide-react'
import type { ColumnProfile, ColumnType, DatasetProfile } from '@/types/domain'
import { Card, CardHeader } from '@/components/ui/Card'
import { cn } from '@/lib/cn'
import { formatNumber } from '@/lib/format'
import { CONFIDENCE_LABEL, SEMANTIC_LABEL } from '@/lib/profileMetrics'

const TYPE_META: Record<ColumnType, { label: string; Icon: typeof Hash; className: string }> = {
  numeric: { label: 'Numérica', Icon: Hash, className: 'bg-blue-50 text-blue-700' },
  text: { label: 'Texto', Icon: Type, className: 'bg-slate-100 text-slate-700' },
  date: { label: 'Fecha', Icon: Calendar, className: 'bg-cyan-50 text-cyan-800' },
  boolean: { label: 'Sí/No', Icon: ToggleLeft, className: 'bg-violet-50 text-violet-700' },
  unknown: { label: 'Sin datos', Icon: CircleHelp, className: 'bg-amber-50 text-amber-800' },
}

export function ColumnTypeTag({ type }: { type: ColumnType }) {
  const { label, Icon, className } = TYPE_META[type]
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium', className)}>
      <Icon className="size-3" aria-hidden />
      {label}
    </span>
  )
}

/** Rol estadístico estimado por el backend, con su nivel de confianza (nunca como certeza). */
export function SemanticTag({ column }: { column: ColumnProfile }) {
  if (!column.semanticType) return null
  const confidence = column.semanticConfidence ?? 'low'
  return (
    <span
      title={column.semanticReason}
      className={cn(
        'inline-flex items-center rounded-md border px-1.5 py-0.5 text-[11px] font-medium',
        confidence === 'low' ? 'border-amber-300 bg-amber-50 text-amber-800' : 'border-slate-200 bg-white text-slate-600',
      )}
    >
      {SEMANTIC_LABEL[column.semanticType]}
      {confidence === 'high' ? '' : '?'} · {CONFIDENCE_LABEL[confidence]}
    </span>
  )
}

/** Tabla con columnas detectadas y primeras filas del dataset. */
export function DatasetPreview({ profile }: { profile: DatasetProfile }) {
  if (profile.columns.length === 0) return null
  const columns = profile.columns

  return (
    <Card className="overflow-hidden">
      <CardHeader
        title="Vista previa"
        description={`Primeras ${profile.previewRows.length} filas · ${profile.columnCount} columnas`}
      />
      <div className="scrollbar-thin mt-4 overflow-x-auto border-t border-slate-100">
        <table className="w-full min-w-max text-left text-xs">
          <thead className="bg-slate-50">
            <tr>
              {columns.map((col) => (
                <th key={col.name} scope="col" className="px-3 py-2.5 align-top">
                  <span className="block font-semibold text-slate-800">{col.name}</span>
                  <span className="mt-1 block">
                    <ColumnTypeTag type={col.inferredType} />
                  </span>
                  {col.semanticType && (
                    <span className="mt-1 block">
                      <SemanticTag column={col} />
                    </span>
                  )}
                  <span className={cn('mt-1 block text-[11px] font-normal', col.nullCount > 0 ? 'text-amber-700' : 'text-slate-400')}>
                    {formatNumber(col.nullCount)} {col.nullCount === 1 ? 'vacío' : 'vacíos'}
                  </span>
                  {(col.suspectedMissingCount ?? 0) > 0 && (
                    <span className="block text-[11px] font-normal text-amber-700">
                      {formatNumber(col.suspectedMissingCount ?? 0)} posible(s) NA
                    </span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {profile.previewRows.map((row, i) => (
              <tr key={i} className="hover:bg-slate-50/60">
                {columns.map((col) => {
                  const value = row[col.name] ?? ''
                  return (
                    <td key={col.name} className={cn('max-w-56 truncate px-3 py-2', value.trim() === '' ? 'text-slate-300 italic' : 'text-slate-700')}>
                      {value.trim() === '' ? 'vacío' : value}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}
