import { Link } from 'react-router-dom'
import { Compass } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/Feedback'

export function NotFoundPage() {
  return (
    <div className="flex min-h-svh items-center justify-center bg-slate-50 p-6">
      <EmptyState
        icon={<Compass className="size-6" />}
        title="Página no encontrada"
        description="La dirección no existe o el proyecto ya no está disponible."
        action={
          <Link to="/">
            <Button>Volver al inicio</Button>
          </Link>
        }
      />
    </div>
  )
}
