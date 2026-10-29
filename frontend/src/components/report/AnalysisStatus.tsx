import { CheckCircle2, CircleDashed, Lock } from 'lucide-react'
import { AdjustPlanActions } from '@/components/analysis/CoverageNotice'
import type { PlanCoverage } from '@/lib/planCoverage'
import type { DescriptiveSummary } from '@/services/analysisEngine'

/**
 * Estado del análisis en tres grupos, para no confundir lo que ya está calculado con lo que falta:
 * resultados calculados (Pandas), cuestiones pendientes (operaciones sin resultado o partes del
 * pedido sin cubrir) y conclusiones que todavía no pueden obtenerse con este catálogo.
 * Todo se deriva localmente de los resultados existentes: no consulta a la IA.
 */
export function AnalysisStatus({ summary, coverage }: { summary: DescriptiveSummary | null; coverage: PlanCoverage }) {
  const items = summary?.items ?? []
  const calculated = items.filter((i) => i.status === 'ok')
  const failed = items.filter((i) => i.status !== 'ok')
  return (
    <div className="space-y-3" role="region" aria-label="Estado del análisis">
      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-3" role="group" aria-label="Resultados calculados">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-emerald-900">
            <CheckCircle2 className="size-4" aria-hidden /> Resultados calculados
          </p>
          {calculated.length ? (
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-slate-700">
              {calculated.map((i) => <li key={i.ref}>{i.title}</li>)}
            </ul>
          ) : (
            <p className="mt-1 text-sm text-slate-600">Ninguna operación produjo resultados.</p>
          )}
        </div>
        <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-3" role="group" aria-label="Cuestiones pendientes">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-amber-900">
            <CircleDashed className="size-4" aria-hidden /> Cuestiones pendientes
          </p>
          {failed.length || coverage.missing.length ? (
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-slate-700">
              {failed.map((i) => (
                <li key={i.ref}>
                  {i.title}: no se pudo calcular ({i.error}).
                </li>
              ))}
              {coverage.missing.map((m) => (
                <li key={m.label}>
                  {m.label}: {m.detail}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-sm text-slate-600">No se detectaron partes del pedido sin calcular.</p>
          )}
          {coverage.missing.length > 0 && <AdjustPlanActions missing={coverage.missing} />}
        </div>
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3" role="group" aria-label="Conclusiones que todavía no pueden obtenerse">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
            <Lock className="size-4" aria-hidden /> Todavía no se puede concluir
          </p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-slate-700">
            {coverage.notObtainable.map((m) => (
              <li key={m.label}>
                {m.label}: {m.detail}
              </li>
            ))}
            {!coverage.notObtainable.some((m) => m.label === 'Causas o motivos') && (
              <li>Causas: los resultados describen qué pasó y cuánto, no por qué.</li>
            )}
            {failed.length > 0 && <li>Nada sobre las operaciones sin resultado.</li>}
          </ul>
        </div>
      </div>
    </div>
  )
}
