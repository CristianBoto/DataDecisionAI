import { CheckCircle2, ShieldCheck, SlidersHorizontal } from 'lucide-react'
import type { AnalysisReviewState } from '@/context/sessionContext'
import { Badge } from '@/components/ui/Badge'
import { LinkButton } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { buildDatasetCatalog, type AnalysisSource } from '@/lib/datasetCatalog'

interface Props {
  sources: AnalysisSource[]
  review: AnalysisReviewState
}

/**
 * Resumen compacto de la revisión confirmada (paso 3). La configuración se
 * edita solo en el paso 2: acá no hay selectores, solo el estado y el acceso.
 */
export function DataReviewSummary({ sources, review }: Props) {
  const catalog = buildDatasetCatalog(sources)
  return (
    <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center" aria-label="Resumen de la revisión de datos" role="region">
      <div className="min-w-0 flex-1 space-y-1.5">
        <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-900">
          <Badge tone="green" icon={<CheckCircle2 className="size-3" aria-hidden />}>
            Datos revisados
          </Badge>
          {sources.length} {sources.length === 1 ? 'fuente' : 'fuentes'}
        </p>
        <ul className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-slate-600">
          {catalog.sources.map((source) => {
            const decisions = review.sources.find((r) => r.alias === source.alias)
            const shared = source.columns.filter((c) => decisions?.columns[c.name]?.include).length
            return (
              <li key={source.alias}>
                Fuente {source.alias} · {source.fileName}: {shared} de {source.columns.length} columnas autorizadas para la IA
              </li>
            )
          })}
        </ul>
        <p className="flex items-center gap-1.5 text-xs font-medium text-amber-800">
          <ShieldCheck className="size-3.5" aria-hidden /> Ninguna información se envía automáticamente a OpenAI.
        </p>
      </div>
      <LinkButton to="/analisis/revisar" icon={<SlidersHorizontal className="size-4" />}>
        Modificar configuración de datos
      </LinkButton>
    </Card>
  )
}
