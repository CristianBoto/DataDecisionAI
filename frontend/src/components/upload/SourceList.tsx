import { useRef } from 'react'
import { CheckCircle2, FileSpreadsheet, Loader2, RefreshCw, Trash2, XCircle } from 'lucide-react'
import type { DatasetProfile } from '@/types/domain'
import { Alert } from '@/components/ui/Alert'
import { DemoBadge } from '@/components/ui/Badge'
import { Card } from '@/components/ui/Card'
import { cn } from '@/lib/cn'
import { ACCEPT_ATTRIBUTE } from '@/lib/fileValidation'
import { formatBytes, formatNumber } from '@/lib/format'
import { formatCompleteness, getCompleteness, getSuspectedMissingCells } from '@/lib/profileMetrics'

export interface UploadItem {
  /** Clave local del elemento (no cambia al reemplazar el archivo). */
  key: string
  name: string
  /** -1 para el dataset ficticio de ejemplo. */
  size: number
  status: 'uploading' | 'ready' | 'error'
  /** Dataset asociado cuando el archivo está (o estuvo) listo. */
  datasetId?: string
  profile?: DatasetProfile
  isDemo?: boolean
  error?: string
}

interface SourceListProps {
  items: UploadItem[]
  activeKey: string | null
  busy: boolean
  uploadingText: string
  errorTitle: string
  onSelect: (key: string) => void
  onRemove: (key: string) => void
  onReplace: (key: string, file: File) => void
}

/** Fuentes del análisis: cada archivo se muestra, quita o reemplaza por separado. */
export function SourceList({ items, activeKey, busy, uploadingText, errorTitle, onSelect, onRemove, onReplace }: SourceListProps) {
  return (
    <ul className="space-y-3" aria-label="Fuentes del análisis">
      {items.map((item, index) => (
        <SourceItem
          key={item.key}
          item={item}
          position={index + 1}
          active={item.key === activeKey}
          busy={busy}
          uploadingText={uploadingText}
          errorTitle={errorTitle}
          onSelect={onSelect}
          onRemove={onRemove}
          onReplace={onReplace}
        />
      ))}
    </ul>
  )
}

function SourceItem({
  item,
  position,
  active,
  busy,
  uploadingText,
  errorTitle,
  onSelect,
  onRemove,
  onReplace,
}: Omit<SourceListProps, 'items' | 'activeKey'> & { item: UploadItem; position: number; active: boolean }) {
  const replaceRef = useRef<HTMLInputElement>(null)
  const profile = item.profile
  const completeness = profile ? getCompleteness(profile) : null
  const suspected = profile ? getSuspectedMissingCells(profile) : 0
  const interpreted = profile ? profile.columns.filter((c) => c.semanticType).length : 0
  const selectable = item.status === 'ready' && !!profile

  return (
    <li>
      <Card className={cn('p-4 transition-shadow', active && 'ring-2 ring-blue-500')} aria-live="polite">
        <div className="flex items-center gap-4">
          <button
            type="button"
            disabled={!selectable}
            onClick={() => onSelect(item.key)}
            aria-pressed={active}
            aria-label={`Ver detalle de ${item.name}`}
            className="flex min-w-0 flex-1 items-center gap-4 text-left disabled:cursor-default"
          >
            <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-600">
              <FileSpreadsheet className="size-5" aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <span className="text-xs font-bold text-slate-400">Fuente {position}</span>
                <span className="truncate">{item.name}</span>
                {item.isDemo && <DemoBadge label="FICTICIO" />}
              </span>
              <span className="block text-xs text-slate-500">
                {formatBytes(item.size)} ·{' '}
                {item.status === 'uploading' ? uploadingText : item.status === 'error' ? 'No se pudo cargar' : 'Listo para continuar'}
              </span>
              {profile && item.status === 'ready' && (
                <span className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-slate-500">
                  <span>{profile.rowCount === null ? 'Filas pendientes' : `${profile.rowCountIsEstimate ? '≥ ' : ''}${formatNumber(profile.rowCount)} filas`}</span>
                  <span>{formatNumber(profile.columnCount)} columnas</span>
                  {completeness !== null && <span>Completitud {formatCompleteness(completeness)}</span>}
                  {suspected > 0 && <span className="text-amber-700">{formatNumber(suspected)} {suspected === 1 ? 'posible NA' : 'posibles NA'}</span>}
                  {interpreted > 0 && <span>{interpreted} columnas interpretadas</span>}
                </span>
              )}
            </span>
          </button>
          {item.status === 'ready' && <CheckCircle2 className="size-5 shrink-0 text-emerald-600" aria-label="Archivo listo" />}
          {item.status === 'error' && <XCircle className="size-5 shrink-0 text-red-600" aria-label="Error" />}
          {item.status === 'uploading' && <Loader2 className="size-5 shrink-0 animate-spin text-blue-600" aria-hidden />}
        </div>

        {item.status === 'uploading' && (
          <div className="mt-3 h-1 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full w-2/3 animate-pulse rounded-full bg-gradient-to-r from-blue-600 to-cyan-400" />
          </div>
        )}

        {item.error && (
          <div className="mt-3">
            <Alert tone="error" title={errorTitle}>
              {item.error}
            </Alert>
          </div>
        )}

        {item.status !== 'uploading' && (
          <div className="mt-3 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
            {!item.isDemo && (
              <button
                type="button"
                disabled={busy}
                onClick={() => replaceRef.current?.click()}
                className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50"
              >
                <RefreshCw className="size-3.5" aria-hidden /> Reemplazar
                <span className="sr-only"> {item.name}</span>
              </button>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={() => onRemove(item.key)}
              className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
            >
              <Trash2 className="size-3.5" aria-hidden /> Quitar
              <span className="sr-only"> {item.name}</span>
            </button>
            <input
              ref={replaceRef}
              type="file"
              accept={ACCEPT_ATTRIBUTE}
              className="sr-only"
              tabIndex={-1}
              data-testid={`replace-input-${position}`}
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) onReplace(item.key, file)
                e.target.value = ''
              }}
            />
          </div>
        )}
      </Card>
    </li>
  )
}
