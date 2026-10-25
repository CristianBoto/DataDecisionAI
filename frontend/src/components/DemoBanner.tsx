import { FlaskConical } from 'lucide-react'
import { useService } from '@/hooks/useService'

/** Franja fija que recuerda el alcance de la demo pública. */
export function DemoBanner() {
  const { mode, profiling } = useService()
  if (mode !== 'demo') return null
  if (profiling === 'backend') {
    // Ejecución local con backend: el perfilado es real; el resto de la sesión vive en el navegador.
    return (
      <div role="note" className="bg-sky-100 px-4 py-1.5 text-center text-xs font-medium text-sky-950">
        <strong>Ejecución local:</strong> perfilado real con Pandas en tu backend · los resultados y gráficos de
        ejemplo siguen siendo ficticios
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
