import { CheckCircle2, EyeOff, Info, ShieldAlert } from 'lucide-react'

interface ConsentSummaryProps {
  /** Qué se enviaría, en lenguaje simple. */
  sends: string[]
  /** Qué nunca se envía. */
  neverSends: string[]
  /** Para qué se usa el envío. */
  purpose: string
  /** Qué queda disponible si no se autoriza. */
  withoutConsent: string
  /** Contenido que podría ser confidencial aunque no sean filas (nombres de columnas, categorías, períodos…). */
  sensitive?: string[]
}

/**
 * Resumen del consentimiento antes de un envío a la IA externa (Fase 5): qué se envía, qué no, para qué,
 * qué podría ser confidencial y qué se puede hacer sin autorizar. Complementa el contenido exacto (JSON).
 */
export function ConsentSummary({ sends, neverSends, purpose, withoutConsent, sensitive = [] }: ConsentSummaryProps) {
  return (
    <div className="grid gap-2 text-xs leading-relaxed sm:grid-cols-2" role="group" aria-label="Resumen del envío">
      <div className="rounded-lg border border-slate-200 p-2.5">
        <p className="flex items-center gap-1.5 font-semibold text-slate-800">
          <CheckCircle2 className="size-3.5 text-violet-600" aria-hidden /> Se envía
        </p>
        <ul className="mt-1 list-disc space-y-0.5 pl-4 text-slate-700">{sends.map((s) => <li key={s}>{s}</li>)}</ul>
      </div>
      <div className="rounded-lg border border-slate-200 p-2.5">
        <p className="flex items-center gap-1.5 font-semibold text-slate-800">
          <EyeOff className="size-3.5 text-emerald-600" aria-hidden /> Nunca se envía
        </p>
        <ul className="mt-1 list-disc space-y-0.5 pl-4 text-slate-700">{neverSends.map((s) => <li key={s}>{s}</li>)}</ul>
      </div>
      {sensitive.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-2.5 sm:col-span-2">
          <p className="flex items-center gap-1.5 font-semibold text-amber-900">
            <ShieldAlert className="size-3.5" aria-hidden /> Podría ser confidencial
          </p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-amber-900">{sensitive.map((s) => <li key={s}>{s}</li>)}</ul>
        </div>
      )}
      <p className="flex gap-1.5 text-slate-600 sm:col-span-2">
        <Info className="mt-0.5 size-3.5 shrink-0 text-slate-400" aria-hidden />
        <span>
          <span className="font-medium text-slate-700">Para qué:</span> {purpose}{' '}
          <span className="font-medium text-slate-700">Si no autorizás:</span> {withoutConsent}
        </span>
      </p>
    </div>
  )
}
