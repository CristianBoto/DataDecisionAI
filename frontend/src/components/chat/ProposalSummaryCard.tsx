import { BarChart3, ClipboardCheck, Gauge, PencilLine } from 'lucide-react'
import type { AnalysisProposal } from '@/types/domain'
import { Button } from '@/components/ui/Button'
import { DemoBadge } from '@/components/ui/Badge'
import { FeasibilityBadge } from '@/components/ui/FeasibilityBadge'

interface ProposalSummaryCardProps {
  proposal: AnalysisProposal
  onReview: () => void
  onRequestChanges: () => void
}

/** Resumen compacto de la propuesta, mostrado dentro del chat. */
export function ProposalSummaryCard({ proposal, onReview, onRequestChanges }: ProposalSummaryCardProps) {
  return (
    <div className="animate-slide-up overflow-hidden rounded-2xl border border-blue-200 bg-gradient-to-b from-blue-50/80 to-white shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-blue-100 px-5 py-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-navy-900">
          <ClipboardCheck className="size-4 text-blue-600" aria-hidden />
          Propuesta de análisis · v{proposal.version}
        </div>
        <div className="flex items-center gap-1.5">
          <FeasibilityBadge value={proposal.feasibility} />
          {proposal.isDemo && <DemoBadge />}
        </div>
      </div>
      <div className="space-y-3 px-5 py-4">
        <p className="text-sm leading-relaxed text-slate-700">{proposal.summary}</p>
        <div className="flex flex-wrap gap-4 text-xs text-slate-500">
          <span className="inline-flex items-center gap-1.5">
            <Gauge className="size-3.5 text-blue-600" aria-hidden />
            {proposal.indicators.length} indicadores
          </span>
          <span className="inline-flex items-center gap-1.5">
            <BarChart3 className="size-3.5 text-blue-600" aria-hidden />
            {proposal.charts.length} gráficos
          </span>
          {proposal.missingInformation.length > 0 && (
            <span className="font-medium text-amber-700">
              Falta información: {proposal.missingInformation.join(', ')}
            </span>
          )}
        </div>
        <div className="flex flex-col gap-2 pt-1 sm:flex-row">
          <Button onClick={onReview} icon={<ClipboardCheck className="size-4" />}>
            Revisar y aprobar
          </Button>
          <Button variant="outline" onClick={onRequestChanges} icon={<PencilLine className="size-4" />}>
            Solicitar modificaciones
          </Button>
        </div>
      </div>
    </div>
  )
}
