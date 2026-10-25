import type { AIChatTurn } from '@/context/sessionContext'
import type { AIPlan, AIReply, AIUsage } from '@/services/aiGateway'

/**
 * Única fuente de verdad de los planes de la IA real: las respuestas validadas
 * por el backend que quedaron en la conversación de la sesión (`aiChat`) y los
 * identificadores aprobados (`approvedPlanIds`). El asistente y el paso
 * «Confirmar» leen de acá: nunca se reconstruye un plan desde texto libre.
 */
export interface SessionAIPlan {
  planId: string
  plan: AIPlan
  /** Respuesta completa de la que forma parte (advertencias, objetivo interpretado). */
  reply: AIReply
  usage: AIUsage
  /** Número de propuesta (1 = primera respuesta con planes). */
  proposal: number
  approved: boolean
}

export function collectAIPlans(aiChat: AIChatTurn[], approvedPlanIds: string[]): SessionAIPlan[] {
  const plans: SessionAIPlan[] = []
  let proposal = 0
  for (const turn of aiChat) {
    const result = turn.result
    if (!result || result.reply.plans.length === 0) continue
    proposal += 1
    result.reply.plans.forEach((plan, i) => {
      const planId = result.plan_ids[i]
      if (!planId) return
      plans.push({ planId, plan, reply: result.reply, usage: result.usage, proposal, approved: approvedPlanIds.includes(planId) })
    })
  }
  return plans
}

/** Planes aprobados, en el orden en que el usuario los aprobó. */
export function approvedAIPlans(aiChat: AIChatTurn[], approvedPlanIds: string[]): SessionAIPlan[] {
  const byId = new Map(collectAIPlans(aiChat, approvedPlanIds).map((p) => [p.planId, p]))
  return approvedPlanIds.map((id) => byId.get(id)).filter((p): p is SessionAIPlan => p !== undefined)
}

/** Lo que el usuario aclaró en la conversación (sus mensajes, sin repetir el objetivo). */
export function conversationClarifications(aiChat: AIChatTurn[], objective: string): string[] {
  return aiChat.filter((t) => t.role === 'user' && t.content.trim() !== objective.trim()).map((t) => t.content)
}
