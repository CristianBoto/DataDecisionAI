import { FlaskConical } from 'lucide-react'
import { useService } from '@/hooks/useService'
import { SessionControls } from '@/components/auth/AccessGate'

/** Franja fija que recuerda el alcance de la demo pública. */
export function DemoBanner() {
  const { mode, profiling } = useService()
  if (mode !== 'demo') return null
  if (profiling === 'backend') {
    // Con backend todo es real: perfilado y cálculos con Pandas, conversación con OpenAI.
    return (
      <div role="note" className="bg-sky-100 px-4 py-1.5 text-center text-xs font-medium text-sky-950">
        <strong>Ejecución con backend:</strong> datos, IA y cálculos reales (OpenAI y Pandas) · sin respuestas ni
        resultados simulados
        <SessionControls />
      </div>
    )
  }
  return (
    <div role="note" className="bg-amber-400/95 px-4 py-1.5 text-center text-xs font-medium text-amber-950">
      <FlaskConical className="mr-1.5 inline size-3.5 -translate-y-px" aria-hidden />
      <strong>Demo pública:</strong> los análisis y gráficos de ejemplo son ficticios
      <span className="hidden sm:inline"> · las funciones avanzadas todavía requieren backend</span>
      {' · '}
      <strong>no cargues datos confidenciales</strong>.
    </div>
  )
}
