import type { ReactNode } from 'react'
import { Loader2, RotateCcw } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Button } from './Button'

export function Spinner({ label = 'Cargando…', className }: { label?: string; className?: string }) {
  return (
    <div role="status" className={cn('flex items-center justify-center gap-2 py-10 text-sm text-slate-500', className)}>
      <Loader2 className="size-4 animate-spin text-blue-600" aria-hidden />
      {label}
    </div>
  )
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn('animate-pulse rounded-lg bg-slate-200/70', className)} />
}

interface EmptyStateProps {
  icon: ReactNode
  title: string
  description?: ReactNode
  action?: ReactNode
  className?: string
}

export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center px-6 py-12 text-center', className)}>
      <span className="flex size-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-500">{icon}</span>
      <h3 className="mt-4 text-base font-semibold text-slate-900">{title}</h3>
      {description && <div className="mt-1 max-w-md text-sm leading-relaxed text-slate-500">{description}</div>}
      {action && <div className="mt-5 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  )
}

export function ErrorState({ message, onRetry, action }: { message: string; onRetry?: () => void; action?: ReactNode }) {
  return (
    <div role="alert" className="flex flex-col items-center px-6 py-12 text-center">
      <p className="text-base font-semibold text-slate-900">No pudimos cargar esta sección</p>
      <p className="mt-1 max-w-md text-sm text-slate-500">{message}</p>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        {onRetry && (
          <Button variant="outline" icon={<RotateCcw className="size-4" />} onClick={onRetry}>
            Reintentar
          </Button>
        )}
        {action}
      </div>
    </div>
  )
}
