import { FlaskConical } from 'lucide-react'
import { useService } from '@/hooks/useService'

/** Franja fija que recuerda que la app funciona con datos ficticios. */
export function DemoBanner() {
  const { mode } = useService()
  if (mode !== 'demo') return null
  return (
    <div className="bg-amber-400/95 px-4 py-1.5 text-center text-xs font-medium text-amber-950">
      <FlaskConical className="mr-1.5 inline size-3.5 -translate-y-px" aria-hidden />
      <strong>Modo DEMO:</strong> respuestas simuladas y resultados con datos ficticios. No hay conexión con el backend.
    </div>
  )
}
