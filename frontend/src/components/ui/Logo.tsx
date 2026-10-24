import { cn } from '@/lib/cn'

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn('size-8', className)} aria-hidden>
      <rect width="32" height="32" rx="9" fill="#0b1f4a" />
      <rect x="8" y="17" width="4" height="7" rx="1.5" fill="#22d3ee" />
      <rect x="14" y="12" width="4" height="12" rx="1.5" fill="#3b82f6" />
      <rect x="20" y="8" width="4" height="16" rx="1.5" fill="#93c5fd" />
    </svg>
  )
}

export function Logo({ inverted = false, className }: { inverted?: boolean; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <LogoMark />
      <span className={cn('text-[15px] font-bold tracking-tight', inverted ? 'text-white' : 'text-navy-900')}>
        DataDecision <span className={inverted ? 'text-cyan-300' : 'text-blue-600'}>AI</span>
      </span>
    </span>
  )
}
