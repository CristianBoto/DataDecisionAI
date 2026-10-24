import { CircleAlert, CircleCheck, CircleX } from 'lucide-react'
import type { Feasibility } from '@/types/domain'
import { Badge } from './Badge'

const config: Record<Feasibility, { label: string; tone: 'green' | 'amber' | 'red'; Icon: typeof CircleCheck }> = {
  viable: { label: 'Viable', tone: 'green', Icon: CircleCheck },
  partial: { label: 'Viable parcialmente', tone: 'amber', Icon: CircleAlert },
  insufficient: { label: 'Datos insuficientes', tone: 'red', Icon: CircleX },
}

export function FeasibilityBadge({ value }: { value: Feasibility }) {
  const { label, tone, Icon } = config[value]
  return (
    <Badge tone={tone} icon={<Icon className="size-3" aria-hidden />}>
      {label}
    </Badge>
  )
}
