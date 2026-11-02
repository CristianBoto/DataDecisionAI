import { Activity, ClipboardCheck } from 'lucide-react'
import type { ColumnProfile, QualityFinding } from '@/types/domain'
import { Badge } from '@/components/ui/Badge'
import { formatNumber } from '@/lib/format'

const SEVERITY: Record<QualityFinding['severity'], { label: string; tone: 'red' | 'amber' | 'neutral' }> = {
  alta: { label: 'Alta', tone: 'red' },
  media: { label: 'Media', tone: 'amber' },
  baja: { label: 'Baja', tone: 'neutral' },
}

const num = (value: number | null | undefined) => (value === null || value === undefined ? '—' : formatNumber(value, 2))

/**
 * Diagnóstico de calidad calculado con Pandas (Fase 5): qué se detectó, dónde y qué impacto tiene
 * en el análisis. Nada se corrige automáticamente: el archivo original no cambia.
 */
export function QualityDiagnosis({ findings }: { findings: QualityFinding[] }) {
  return (
    <section className="px-5 pt-4" aria-label="Diagnóstico de calidad">
      <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
        <ClipboardCheck className="size-3.5 text-slate-500" aria-hidden /> Diagnóstico de calidad
      </p>
      {findings.length === 0 ? (
        <p className="mt-1 text-xs text-slate-500">
          No se detectaron faltantes, duplicados, categorías inconsistentes, fechas inválidas ni valores atípicos.
        </p>
      ) : (
        <>
          <p className="mt-0.5 text-[11px] text-slate-400">
            Nada se corrige automáticamente: no se eliminan duplicados, no se unifican categorías ni se completan faltantes.
          </p>
          <ul className="mt-2 space-y-2">
            {findings.map((f, i) => (
              <li key={i} className="rounded-lg border border-slate-200 px-3 py-2 text-xs leading-relaxed">
                <p className="flex flex-wrap items-center gap-1.5 text-slate-800">
                  <Badge tone={SEVERITY[f.severity].tone}>{SEVERITY[f.severity].label}</Badge>
                  {f.column && <span className="font-semibold">{f.column}</span>}
                  <span>{f.message}</span>
                </p>
                <p className="mt-0.5 text-slate-500">
                  <span className="font-medium text-slate-600">Impacto:</span> {f.impact}
                </p>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}

/** Estadísticas descriptivas de las columnas numéricas (n, media, desvío, cuartiles y atípicos IQR). */
export function NumericSummary({ columns }: { columns: ColumnProfile[] }) {
  const numeric = columns.filter((c) => c.stats && c.stats.count > 0)
  if (numeric.length === 0) return null
  return (
    <section className="px-5 pt-4" aria-label="Estadísticas descriptivas">
      <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
        <Activity className="size-3.5 text-slate-500" aria-hidden /> Estadísticas descriptivas
      </p>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[520px] text-left text-[11px] tabular-nums">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              {['Columna', 'n', 'Media', 'Desvío', 'Mín.', 'Mediana', 'Máx.', 'Atípicos'].map((h) => (
                <th key={h} scope="col" className="px-2 py-1 font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {numeric.map((c) => (
              <tr key={c.name} className="border-t border-slate-100">
                <th scope="row" className="px-2 py-1 font-medium text-slate-800">{c.name}</th>
                <td className="px-2 py-1">{formatNumber(c.stats!.count)}</td>
                <td className="px-2 py-1">{num(c.stats!.mean)}</td>
                <td className="px-2 py-1">{num(c.stats!.std)}</td>
                <td className="px-2 py-1">{num(c.stats!.min)}</td>
                <td className="px-2 py-1">{num(c.stats!.median)}</td>
                <td className="px-2 py-1">{num(c.stats!.max)}</td>
                <td className="px-2 py-1">{formatNumber(c.stats!.outliers ?? 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-1 text-[11px] text-slate-400">
        Calculado con Pandas sobre los valores presentes. Atípicos: fuera de Q1 − 1,5·IQR y Q3 + 1,5·IQR (criterio de Tukey).
      </p>
    </section>
  )
}
