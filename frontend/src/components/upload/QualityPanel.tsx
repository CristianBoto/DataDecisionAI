import type { ReactNode } from 'react'
import { AlertTriangle, Info, ShieldCheck, XCircle } from 'lucide-react'
import type { DatasetProfile, IssueSeverity } from '@/types/domain'
import { Badge, DemoBadge } from '@/components/ui/Badge'
import { Card, CardHeader } from '@/components/ui/Card'
import { formatNumber } from '@/lib/format'

const SEVERITY_ICON: Record<IssueSeverity, ReactNode> = {
  error: <XCircle className="size-4 shrink-0 text-red-600" aria-hidden />,
  warning: <AlertTriangle className="size-4 shrink-0 text-amber-600" aria-hidden />,
  info: <Info className="size-4 shrink-0 text-blue-600" aria-hidden />,
}

const ORIGIN_LABEL = {
  'local-preview': { label: 'Estimación local preliminar', tone: 'cyan' as const },
  backend: { label: 'Perfil del backend', tone: 'green' as const },
  demo: { label: 'Dataset ficticio', tone: 'demo' as const },
}

/** Resumen de calidad de datos. Hoy es preliminar; el backend devolverá el definitivo. */
export function QualityPanel({ profile }: { profile: DatasetProfile }) {
  const totalCells = (profile.rowCount ?? 0) * profile.columnCount
  const nullCells = profile.columns.reduce((sum, c) => sum + c.nullCount, 0)
  const completeness = totalCells > 0 ? 1 - nullCells / totalCells : null
  const origin = ORIGIN_LABEL[profile.origin]

  const stats = [
    {
      label: 'Filas',
      value: profile.rowCount === null ? 'Pendiente' : `${profile.rowCountIsEstimate ? '≥ ' : ''}${formatNumber(profile.rowCount)}`,
    },
    { label: 'Columnas', value: profile.columnCount > 0 ? formatNumber(profile.columnCount) : 'Pendiente' },
    {
      label: 'Completitud',
      value: completeness === null ? 'Pendiente' : `${(completeness * 100).toLocaleString('es-AR', { maximumFractionDigits: 1 })} %`,
    },
  ]

  return (
    <Card>
      <CardHeader
        icon={<ShieldCheck className="size-4" aria-hidden />}
        title="Calidad de los datos"
        description={profile.note}
        actions={profile.origin === 'demo' ? <DemoBadge label="FICTICIO" /> : <Badge tone={origin.tone}>{origin.label}</Badge>}
      />
      <div className="grid grid-cols-3 gap-3 px-5 pt-4">
        {stats.map((s) => (
          <div key={s.label} className="rounded-xl bg-slate-50 px-3 py-2.5">
            <p className="text-[11px] font-medium text-slate-500">{s.label}</p>
            <p className="mt-0.5 text-base font-bold text-slate-900 tabular-nums">{s.value}</p>
          </div>
        ))}
      </div>
      <div className="p-5">
        <p className="mb-2 text-xs font-semibold text-slate-700">Observaciones</p>
        {profile.issues.length === 0 ? (
          <p className="text-xs text-slate-500">No se detectaron observaciones en la vista previa.</p>
        ) : (
          <ul className="space-y-2">
            {profile.issues.map((issue, i) => (
              <li key={i} className="flex gap-2 text-xs leading-relaxed text-slate-600">
                {SEVERITY_ICON[issue.severity]}
                <span>{issue.message}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  )
}
