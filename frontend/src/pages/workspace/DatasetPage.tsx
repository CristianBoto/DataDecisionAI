import { Database } from 'lucide-react'
import { ColumnTypeTag, DatasetPreview } from '@/components/upload/DatasetPreview'
import { QualityPanel } from '@/components/upload/QualityPanel'
import { Alert } from '@/components/ui/Alert'
import { Card, CardHeader } from '@/components/ui/Card'
import { PageHeader } from '@/components/ui/PageHeader'
import { useWorkspace } from '@/hooks/useWorkspace'
import { formatBytes, formatDateTime, formatNumber } from '@/lib/format'

export function DatasetPage() {
  const { project, profile } = useWorkspace()
  const { dataset } = project

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6 lg:p-8">
      <PageHeader
        title="Dataset"
        description={`${dataset.fileName} · ${dataset.format.toUpperCase()} · ${formatBytes(dataset.sizeBytes)} · cargado el ${formatDateTime(dataset.uploadedAt)}`}
      />

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
                      <th className="px-4 py-2.5 font-medium">Tipo</th>
                      <th className="px-4 py-2.5 text-right font-medium">Con valor</th>
                      <th className="px-4 py-2.5 text-right font-medium">Vacíos</th>
                      <th className="px-4 py-2.5 text-right font-medium">Distintos</th>
                      <th className="px-4 py-2.5 font-medium">Ejemplos</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {profile.columns.map((c) => (
                      <tr key={c.name}>
                        <td className="px-4 py-2.5 font-medium text-slate-800">{c.name}</td>
                        <td className="px-4 py-2.5"><ColumnTypeTag type={c.inferredType} /></td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{formatNumber(c.nonNullCount)}</td>
                        <td className={`px-4 py-2.5 text-right tabular-nums ${c.nullCount > 0 ? 'font-semibold text-amber-700' : ''}`}>{formatNumber(c.nullCount)}</td>
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
    </div>
  )
}
