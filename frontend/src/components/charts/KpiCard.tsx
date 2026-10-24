import type { ReactNode } from 'react'
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react'
import type { Indicator } from '@/types/domain'
import { Card } from '@/components/ui/Card'
import { cn } from '@/lib/cn'
import { formatChange, formatValue } from '@/lib/format'

interface KpiCardProps {
  indicator: Indicator
  icon?: ReactNode
}

export function KpiCard({ indicator, icon }: KpiCardProps) {
  const { change } = indicator
  const trend = change === undefined ? null : change > 0 ? 'up' : change < 0 ? 'down' : 'flat'
  const TrendIcon = trend === 'up' ? ArrowUpRight : trend === 'down' ? ArrowDownRight : Minus

  return (
    <Card className="group relative overflow-hidden p-5 transition-shadow hover:shadow-elevated">
      <span className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-blue-600 via-cyan-400 to-transparent opacity-70" aria-hidden />
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-medium text-slate-500">{indicator.label}</p>
        {icon && <span className="text-slate-400 transition-colors group-hover:text-blue-600">{icon}</span>}
      </div>
      <p className="mt-2 text-2xl font-bold tracking-tight text-slate-900 tabular-nums">
        {formatValue(indicator.value, indicator.format)}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        {trend && change !== undefined && (
          <span
            className={cn(
              'inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 font-semibold',
              trend === 'up' && 'bg-emerald-50 text-emerald-700',
              trend === 'down' && 'bg-red-50 text-red-700',
              trend === 'flat' && 'bg-slate-100 text-slate-600',
            )}
          >
            <TrendIcon className="size-3" aria-hidden />
            {formatChange(change)}
          </span>
        )}
        {indicator.changeLabel && <span className="text-slate-400">{indicator.changeLabel}</span>}
      </div>
      <p className="mt-3 text-[11px] leading-relaxed text-slate-400">{indicator.description}</p>
    </Card>
  )
}
