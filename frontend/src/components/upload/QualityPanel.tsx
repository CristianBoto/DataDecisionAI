import type { ReactNode } from 'react'
import { AlertTriangle, Info, ShieldCheck, XCircle } from 'lucide-react'
import type { DatasetProfile, IssueSeverity } from '@/types/domain'
import { Badge, DemoBadge } from '@/components/ui/Badge'
import { Card, CardHeader } from '@/components/ui/Card'
import { SemanticTag } from '@/components/upload/DatasetPreview'
import { formatNumber } from '@/lib/format'
import { COMPLETENESS_CRITERIA, formatCompleteness, getCompleteness, getSuspectedMissingCells } from '@/lib/profileMetrics'

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

/** Resumen de calidad de datos. Con perfil del backend, todas las cifras vienen de Pandas. */
export function QualityPanel({ profile }: { profile: DatasetProfile }) {
  const completeness = getCompleteness(profile)
  const suspectedCells = getSuspectedMissingCells(profile)
  const origin = ORIGIN_LABEL[profile.origin]
  const interpreted = profile.columns.filter((c) => c.semanticType)

  const stats = [
    {
      label: 'Filas',
      value: profile.rowCount === null ? 'Pendiente' : `${profile.rowCountIsEstimate ? '≥ ' : ''}${formatNumber(profile.rowCount)}`,
    },
    { label: 'Columnas', value: profile.columnCount > 0 ? formatNumber(profile.columnCount) : 'Pendiente' },
    { label: 'Completitud', value: completeness === null ? 'Pendiente' : formatCompleteness(completeness) },
  ]
  if (profile.duplicateRowCount !== undefined && profile.duplicateRowCount !== null) {
    stats.push({ label: 'Filas duplicadas', value: formatNumber(profile.duplicateRowCount) })
  }
  if (suspectedCells > 0) {
    stats.push({ label: 'Posibles marcadores de ausencia', value: formatNumber(suspectedCells) })
  }

  return (
    <Card>
      <CardHeader
        icon={<ShieldCheck className="size-4" aria-hidden />}
        title="Calidad de los datos"
        description={profile.note}
        actions={profile.origin === 'demo' ? <DemoBadge label="FICTICIO" /> : <Badge tone={origin.tone}>{origin.label}</Badge>}
      />
      <div className={`grid gap-3 px-5 pt-4 ${stats.length > 3 ? 'grid-cols-2' : 'grid-cols-3'}`}>
        {stats.map((s) => (
          <div key={s.label} className="rounded-xl bg-slate-50 px-3 py-2.5">
            <p className="text-[11px] font-medium text-slate-500">{s.label}</p>
            <p className="mt-0.5 text-base font-bold text-slate-900 tabular-nums">{s.value}</p>
          </div>
        ))}
      </div>
      <p className="px-5 pt-2 text-[11px] leading-relaxed text-slate-400">Completitud: {COMPLETENESS_CRITERIA}</p>

      {interpreted.length > 0 && (
        <div className="px-5 pt-4">
          <p className="text-xs font-semibold text-slate-700">Interpretación estimada de las columnas</p>
          <p className="mt-0.5 text-[11px] text-slate-400">Inferencia con reglas generales: confirmala antes de calcular.</p>
          <ul className="mt-2 space-y-2">
            {interpreted.map((c) => (
              <li key={c.name} className="text-xs leading-relaxed text-slate-600">
                <span className="flex flex-wrap items-center gap-1.5">
                  <span className="font-semibold text-slate-800">{c.name}</span>
                  <SemanticTag column={c} />
                </span>
                {c.semanticReason && <span className="block text-slate-500">{c.semanticReason}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

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
