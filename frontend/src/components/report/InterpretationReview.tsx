import { useMemo, type ReactNode } from 'react'
import { Calculator, Send, ShieldCheck, ShieldOff, Wallet } from 'lucide-react'
import { summarizeInterpretationPayload } from '@/lib/interpretationSummary'
import type { PreparedInterpretation } from '@/services/aiGateway'

function Block({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
        {icon} {title}
      </p>
      <div className="pl-5 text-sm text-slate-700">{children}</div>
    </div>
  )
}

/**
 * Revisión del envío para interpretar resultados, pensada para personas sin conocimientos técnicos:
 * primero un resumen en lenguaje natural (calculado en el navegador, sin IA) y, al final, el contenido
 * exacto en «Ver detalles técnicos». El resumen sale del mismo contenido que se autoriza: no lo
 * reemplaza ni lo resume de menos (las categorías que viajan se listan todas).
 */
export function InterpretationReview({ prepared, executive }: { prepared: PreparedInterpretation; executive: string[] }) {
  const summary = useMemo(() => summarizeInterpretationPayload(prepared.payload), [prepared.payload])
  // El primer renglón del resumen ejecutivo es el conteo de operaciones; las cifras vienen después.
  const figures = executive.slice(1).filter((line) => !line.startsWith('Sin resultados:'))

  return (
    <div className="space-y-4">
      <Block icon={<Calculator className="size-4 text-slate-500" aria-hidden />} title="Qué se calculó">
        <p>
          {summary.calculated.length} de {summary.calculated.length + summary.failed.length} operaciones tienen resultados
          {summary.calculated.length ? `: ${summary.calculated.map((c) => c.title).join('; ')}.` : '.'}
        </p>
        {summary.failed.length > 0 && (
          <p className="mt-1 text-amber-900">
            Sin resultados: {summary.failed.map((f) => `${f.title} (${f.reason})`).join('; ')}. De estas no se sacan conclusiones.
          </p>
        )}
        {figures.length > 0 && (
          <>
            <p className="mt-2 font-medium text-slate-800">Principales cifras (calculadas con Pandas):</p>
            <ul className="list-disc space-y-0.5 pl-5">
              {figures.map((f) => <li key={f}>{f}</li>)}
            </ul>
          </>
        )}
      </Block>

      <Block icon={<Send className="size-4 text-slate-500" aria-hidden />} title="Qué se enviará a OpenAI">
        <ul className="list-disc space-y-1 pl-5">
          {summary.objective && <li>Tu objetivo, tal como lo escribiste: «{summary.objective}».</li>}
          {summary.sources.length > 0 && <li>El tamaño de cada fuente (sin el nombre del archivo): {summary.sources.join('; ')}.</li>}
          {summary.sent.map((op) => (
            <li key={op.ref}>
              <span className="font-medium">{op.title}</span>: {op.content}.
              {op.values.map((d) => (
                <span key={d.dimension} className="block text-xs text-slate-600">
                  Valores de «{d.dimension}» que se envían ({d.values.length}): {d.values.join(', ')}
                </span>
              ))}
            </li>
          ))}
          {summary.facts > 0 && <li>Las {summary.facts} frases del resumen descriptivo (las mismas cifras de arriba).</li>}
        </ul>
        {summary.personDimensions.length > 0 && (
          <div className="mt-2 rounded-lg border border-red-200 bg-red-50 px-2 py-1.5 text-xs text-red-900" role="note" aria-label="Posibles nombres de personas">
            <p className="font-semibold">Posibles nombres de personas o entidades</p>
            {summary.personDimensions.map((d) => (
              <p key={d.dimension}>
                «{d.dimension}» parece identificar personas o entidades. Se enviarían estos {d.values.length} valores tal cual: {d.values.join(', ')}.
              </p>
            ))}
            <p className="mt-1">Si son personas reales, no autorices el envío sin su consentimiento: podés quitar esa columna en «Revisar».</p>
          </div>
        )}
        {summary.includesDataValues && (
          <p className="mt-2 rounded-lg bg-amber-100/70 px-2 py-1.5 text-xs text-amber-950">
            Los nombres de categorías, períodos y cifras se envían <strong>tal como aparecen en tus resultados</strong>: no se
            anonimizan. Si alguno identifica a una persona o es confidencial, no autorices el envío.
          </p>
        )}
      </Block>

      <Block icon={<ShieldOff className="size-4 text-slate-500" aria-hidden />} title="Qué no se envía">
        <p>Nunca se envían: los archivos, las filas originales, los nombres de archivo ni los puntos de una dispersión o curva ROC.</p>
      </Block>

      <Block icon={<Wallet className="size-4 text-slate-500" aria-hidden />} title="Costo">
        <p>
          Costo máximo estimado: {prepared.estimated_max_cost_usd != null ? `USD ${prepared.estimated_max_cost_usd.toFixed(4)}` : 'sin estimar'} ·
          ~{prepared.estimated_input_tokens ?? '?'} tokens de entrada. Se descuenta de tu cuota. La autorización vale para un solo envío.
        </p>
      </Block>

      <details className="rounded-lg border border-slate-200 bg-white">
        <summary className="flex cursor-pointer items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700">
          <ShieldCheck className="size-3.5" aria-hidden /> Ver detalles técnicos (contenido exacto que se enviaría)
        </summary>
        <pre className="scrollbar-thin max-h-72 overflow-auto px-3 pb-3 text-[11px] text-slate-700" aria-label="Contenido exacto de la interpretación">
          {JSON.stringify(prepared.payload, null, 2)}
        </pre>
      </details>
    </div>
  )
}
