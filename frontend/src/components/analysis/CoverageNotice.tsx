import { useNavigate } from 'react-router-dom'
import { MessageSquareText, PencilLine } from 'lucide-react'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { adjustmentMessage, type CoverageGap } from '@/lib/planCoverage'

/** Acciones para completar el plan: el asistente con un mensaje sugerido (no se envía solo) o el objetivo. */
export function AdjustPlanActions({ missing }: { missing: CoverageGap[] }) {
  const navigate = useNavigate()
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      <Button
        size="sm"
        icon={<MessageSquareText className="size-4" />}
        onClick={() => navigate('/analisis/asistente', { state: { draft: adjustmentMessage(missing) } })}
      >
        Volver al asistente para ajustar el plan
      </Button>
      <Button size="sm" variant="outline" icon={<PencilLine className="size-4" />} onClick={() => navigate('/analisis/revisar')}>
        Cambiar el objetivo
      </Button>
    </div>
  )
}

/**
 * Aviso de partes del pedido que el plan no cubre (comprobación local, sin IA). No bloquea: ofrece
 * volver al asistente con un mensaje sugerido —editable y que NO se envía solo— o cambiar el objetivo
 * en «Revisar». Nunca pide editar JSON.
 */
export function MissingCoverageNotice({ missing, title }: { missing: CoverageGap[]; title: string }) {
  if (missing.length === 0) return null
  return (
    <div role="region" aria-label="Partes del pedido sin cubrir">
      <Alert tone="warning" title={title}>
        <ul className="mt-1 list-disc space-y-0.5 pl-5">
          {missing.map((m) => (
            <li key={m.label}>
              <strong>{m.label}:</strong> {m.detail}
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs">
          Es una comprobación automática y prudente: puede no detectar todo ni entender cada matiz. Si el plan ya
          responde lo que necesitás, podés seguir igual.
        </p>
        <AdjustPlanActions missing={missing} />
      </Alert>
    </div>
  )
}

/** Lo que DataDecision AI no puede concluir con su catálogo (causas, pronósticos, cruces de archivos). */
export function NotObtainableNotice({ items }: { items: CoverageGap[] }) {
  if (items.length === 0) return null
  return (
    <div role="region" aria-label="Conclusiones que no se pueden obtener">
      <Alert tone="info" title="Lo que estos cálculos no pueden responder">
        <ul className="mt-1 list-disc space-y-0.5 pl-5">
          {items.map((m) => (
            <li key={m.label}>
              <strong>{m.label}:</strong> {m.detail}
            </li>
          ))}
        </ul>
      </Alert>
    </div>
  )
}
