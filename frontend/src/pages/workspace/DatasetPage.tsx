import { useState } from 'react'
import { Database } from 'lucide-react'
import type { Dataset, DatasetProfile } from '@/types/domain'
import { ColumnTypeTag, DatasetPreview, SemanticTag } from '@/components/upload/DatasetPreview'
import { QualityPanel } from '@/components/upload/QualityPanel'
import { Alert } from '@/components/ui/Alert'
import { Card, CardHeader } from '@/components/ui/Card'
import { PageHeader } from '@/components/ui/PageHeader'
import { ErrorState, Skeleton } from '@/components/ui/Feedback'
import { useAsync } from '@/hooks/useAsync'
import { useService } from '@/hooks/useService'
import { useWorkspace } from '@/hooks/useWorkspace'
import { cn } from '@/lib/cn'
import { sourceAlias } from '@/lib/datasetCatalog'
import { formatBytes, formatDateTime, formatNumber } from '@/lib/format'

export function DatasetPage() {
  const { project, profile } = useWorkspace()
  const service = useService()
  const sources = project.datasets?.length ? project.datasets : [project.dataset]
  const [selectedId, setSelectedId] = useState(project.dataset.id)
  const selected = sources.find((d) => d.id === selectedId) ?? project.dataset
  const isPrimary = selected.id === project.dataset.id
  // El perfil de la fuente principal ya lo cargó el workspace; las demás se piden al seleccionarlas.
  const other = useAsync(
    () => (isPrimary ? Promise.resolve(profile) : service.getDatasetProfile(selected.id)),
    [selected.id, isPrimary, profile, service],
  )

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6 lg:p-8">
      <PageHeader
        title={sources.length > 1 ? 'Fuentes de datos' : 'Dataset'}
        description={`${selected.fileName} · ${selected.format.toUpperCase()} · ${formatBytes(selected.sizeBytes)} · cargado el ${formatDateTime(selected.uploadedAt)}`}
      />

      {sources.length > 1 && (
        <div className="space-y-2">
          <div role="tablist" aria-label="Fuentes del análisis" className="flex flex-wrap gap-2">
            {sources.map((d, index) => (
              <button
                key={d.id}
                role="tab"
                type="button"
                aria-selected={d.id === selected.id}
                onClick={() => setSelectedId(d.id)}
                className={cn(
                  'rounded-lg border px-3 py-1.5 text-xs font-medium',
                  d.id === selected.id ? 'border-blue-500 bg-blue-50 text-blue-800' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50',
                )}
              >
                {sourceAlias(index)} · {d.fileName}
              </button>
            ))}
          </div>
          <p className="text-xs text-slate-500">
            Las fuentes se perfilaron por separado y se mantienen independientes: no se unieron ni se transformaron.
          </p>
        </div>
      )}

      {isPrimary ? (
        <SourceDetail dataset={selected} profile={profile} />
      ) : other.status === 'loading' ? (
        <Skeleton className="h-64" />
      ) : other.status === 'error' ? (
        <ErrorState message={other.error} onRetry={other.retry} />
      ) : (
        <SourceDetail dataset={selected} profile={other.data} />
      )}
    </div>
  )
}

function SourceDetail({ profile }: { dataset: Dataset; profile: DatasetProfile }) {
  return (
    <>

      {profile.columns.length === 0 && (
        <Alert tone="info" title="Perfil pendiente">
          La estructura de este archivo se conocerá cuando el backend lo procese con Pandas.
        </Alert>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-6">
          {profile.columns.length > 0 && (
            <Card className="overflow-hidden">
              <CardHeader icon={<Database className="size-4" aria-hidden />} title="Perfil de columnas" description="Tipo inferido, valores vacíos y valores distintos." />
              <div className="scrollbar-thin mt-4 overflow-x-auto border-t border-slate-100">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-500">
                    <tr>
                      <th className="px-4 py-2.5 font-medium">Columna</th>
                      <th className="px-4 py-2.5 font-medium">Formato</th>
                      <th className="px-4 py-2.5 font-medium">Interpretación estimada</th>
                      <th className="px-4 py-2.5 text-right font-medium">Con valor</th>
                      <th className="px-4 py-2.5 text-right font-medium">Vacíos</th>
                      <th className="px-4 py-2.5 text-right font-medium">Posibles NA</th>
                      <th className="px-4 py-2.5 text-right font-medium">Distintos</th>
                      <th className="px-4 py-2.5 font-medium">Ejemplos</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {profile.columns.map((c) => (
                      <tr key={c.name}>
                        <td className="px-4 py-2.5 font-medium text-slate-800">{c.name}</td>
                        <td className="px-4 py-2.5"><ColumnTypeTag type={c.inferredType} /></td>
                        <td className="px-4 py-2.5">{c.semanticType ? <SemanticTag column={c} /> : <span className="text-slate-400">—</span>}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{formatNumber(c.nonNullCount)}</td>
                        <td className={`px-4 py-2.5 text-right tabular-nums ${c.nullCount > 0 ? 'font-semibold text-amber-700' : ''}`}>{formatNumber(c.nullCount)}</td>
                        <td className={`px-4 py-2.5 text-right tabular-nums ${(c.suspectedMissingCount ?? 0) > 0 ? 'font-semibold text-amber-700' : ''}`}>{c.suspectedMissingCount === undefined ? '—' : formatNumber(c.suspectedMissingCount)}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{c.uniqueCount === null ? '—' : formatNumber(c.uniqueCount)}</td>
                        <td className="max-w-64 truncate px-4 py-2.5 text-slate-500">{c.sampleValues.join(', ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
          <DatasetPreview profile={profile} />
        </div>
        <QualityPanel profile={profile} />
      </div>
    </>
  )
}
