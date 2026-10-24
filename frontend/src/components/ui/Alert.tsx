import type { ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, FlaskConical, Info, XCircle } from 'lucide-react'
import { cn } from '@/lib/cn'

type Tone = 'info' | 'warning' | 'error' | 'success' | 'demo'

const styles: Record<Tone, { box: string; icon: ReactNode }> = {
  info: { box: 'border-blue-200 bg-blue-50/70 text-blue-950', icon: <Info className="size-4 text-blue-600" aria-hidden /> },
  warning: { box: 'border-amber-200 bg-amber-50 text-amber-950', icon: <AlertTriangle className="size-4 text-amber-600" aria-hidden /> },
  error: { box: 'border-red-200 bg-red-50 text-red-950', icon: <XCircle className="size-4 text-red-600" aria-hidden /> },
  success: { box: 'border-emerald-200 bg-emerald-50 text-emerald-950', icon: <CheckCircle2 className="size-4 text-emerald-600" aria-hidden /> },
  demo: { box: 'border-amber-300 bg-amber-50 text-amber-950', icon: <FlaskConical className="size-4 text-amber-700" aria-hidden /> },
}

interface AlertProps {
  tone?: Tone
  title?: ReactNode
  children?: ReactNode
  action?: ReactNode
  className?: string
}

export function Alert({ tone = 'info', title, children, action, className }: AlertProps) {
  const style = styles[tone]
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn('flex flex-col gap-3 rounded-xl border px-4 py-3 text-sm sm:flex-row', style.box, className)}
    >
      <div className="flex min-w-0 flex-1 gap-3">
        <span className="mt-0.5 shrink-0">{style.icon}</span>
        <div className="min-w-0 flex-1">
          {title && <p className="font-semibold">{title}</p>}
          {children && <div className={cn('leading-relaxed', title ? 'mt-0.5 opacity-90' : undefined)}>{children}</div>}
        </div>
      </div>
      {action && <div className="shrink-0 self-start sm:self-center">{action}</div>}
    </div>
  )
}
