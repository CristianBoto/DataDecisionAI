import type { AIReply } from '@/services/aiGateway'

/** Viabilidad del objetivo declarada por la IA y ajustada por el backend a los planes que superaron la validación. */
export const FEASIBILITY: Record<NonNullable<AIReply['feasibility']>, { label: string; tone: 'green' | 'amber' | 'red' | 'blue' }> = {
  viable: { label: 'Viable', tone: 'green' },
  partial: { label: 'Parcialmente viable', tone: 'amber' },
  not_viable: { label: 'No viable con estos datos', tone: 'red' },
  needs_information: { label: 'Falta información', tone: 'blue' },
}
