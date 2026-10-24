import type { ReactNode } from 'react'
import { FlaskConical } from 'lucide-react'
import { cn } from '@/lib/cn'

export type BadgeTone = 'neutral' | 'blue' | 'cyan' | 'green' | 'amber' | 'red' | 'demo'

const tones: Record<BadgeTone, string> = {
  neutral: 'bg-slate-100 text-slate-700 ring-slate-200',
  blue: 'bg-blue-50 text-blue-700 ring-blue-200',
  cyan: 'bg-cyan-50 text-cyan-800 ring-cyan-200',
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  amber: 'bg-amber-50 text-amber-800 ring-amber-200',
  red: 'bg-red-50 text-red-700 ring-red-200',
  demo: 'bg-amber-100 text-amber-900 ring-amber-300',
}

interface BadgeProps {
  tone?: BadgeTone
  icon?: ReactNode
  children: ReactNode
  className?: string
}

export function Badge({ tone = 'neutral', icon, children, className }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap ring-1 ring-inset',
        tones[tone],
        className,
      )}
    >
      {icon}
      {children}
    </span>
  )
}

/** Marca visible para todo contenido simulado o ficticio. */
export function DemoBadge({ label = 'DEMO' }: { label?: string }) {
  return (
    <Badge tone="demo" icon={<FlaskConical className="size-3" aria-hidden />}>
      {label}
    </Badge>
  )
}
