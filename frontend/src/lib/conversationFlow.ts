import type { AIChatTurn } from '@/context/sessionContext'

/**
 * Estado EXPLÍCITO de la conversación con la IA real, derivado de las respuestas ya validadas
 * por el backend (`aiChat`) y de los planes aprobados. La pantalla decide qué mostrar con este
 * estado, no con el texto de la IA:
 * - `idle`: todavía no hay respuestas;
 * - `questions`: la última respuesta solo pregunta (`rounds` = respuestas seguidas sin planes);
 * - `proposal`: la última respuesta trae planes sin aprobar (`planIds`); `openQuestions` indica si,
 *   además, preguntó algo (una respuesta con datos nuevos se le envía, no se toma como aceptación);
 * - `approved`: los planes de la última respuesta ya están aprobados.
 */
export type AIConversationStage =
  | { kind: 'idle' }
  | { kind: 'questions'; rounds: number }
  | { kind: 'proposal'; planIds: string[]; openQuestions: boolean }
  | { kind: 'approved' }

export function aiConversationStage(aiChat: AIChatTurn[], approvedPlanIds: string[]): AIConversationStage {
  const replies = aiChat.filter((t) => t.role === 'assistant' && t.result)
  const last = replies[replies.length - 1]?.result
  if (!last) return { kind: 'idle' }
  const ids = last.plan_ids.filter(Boolean)
  if (last.reply.plans.length > 0 && ids.length > 0) {
    const pending = ids.filter((id) => !approvedPlanIds.includes(id))
    return pending.length ? { kind: 'proposal', planIds: pending, openQuestions: last.reply.questions.length > 0 } : { kind: 'approved' }
  }
  let rounds = 0
  for (let i = replies.length - 1; i >= 0 && replies[i].result!.reply.plans.length === 0; i -= 1) rounds += 1
  return { kind: 'questions', rounds }
}

const normalize = (text: string) =>
  text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9ñ\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const PHRASE = '(si+p?|claro( que si)?|correcto|exacto|confirmo|confirmado|dale|ok|okay|okey|de acuerdo|perfecto|esta bien|adelante|me parece bien|genial|listo|asi es|eso es|afirmativo|totalmente|por supuesto|armalo|hacelo)'
const ACCEPT = new RegExp(`^${PHRASE}\\b`)
const ONLY_ACCEPT = new RegExp(`^${PHRASE}( ${PHRASE})*$`)
/** Palabras que convierten la respuesta en un pedido de cambio o en una negativa. */
const CHANGE = /\b(no|pero|aunque|excepto|salvo|cambi\w*|modific\w*|agreg\w*|quit\w*|sac\w*|ademas|tambien|otro|otra|en vez|en lugar)\b/

/**
 * ¿La persona acepta lo que se le propuso o preguntó? Solo respuestas breves y claras («sí»,
 * «correcto», «confirmo», «dale, armalo»). Un pedido de cambio («sí, pero sin el canal») no cuenta.
 */
export function isAffirmative(text: string): boolean {
  const value = normalize(text)
  // Una pregunta («¿sí?», «¿ok?») no es una aceptación.
  if (!value || /[?¿]/.test(text) || value.split(' ').length > 8) return false
  return ACCEPT.test(value) && !CHANGE.test(value)
}

/** Aceptación sin ningún dato adicional («sí», «sí, correcto», «dale»): no responde a ninguna pregunta. */
export function isPureAcceptance(text: string): boolean {
  return !/[?¿]/.test(text) && ONLY_ACCEPT.test(normalize(text))
}

/**
 * Qué hacer con un mensaje de la persona según el estado:
 * - `accept`: acepta una propuesta completa → confirmación formal, sin consultar a la IA;
 * - `send`: se envía a la IA; `requestProposal` le pide cerrar con una propuesta (la persona aceptó
 *   lo que la IA preguntó o sugirió).
 */
export function routeMessage(stage: AIConversationStage, text: string): { action: 'accept' } | { action: 'send'; requestProposal: boolean } {
  const accepts = isAffirmative(text)
  if (stage.kind === 'proposal' && (isPureAcceptance(text) || (accepts && !stage.openQuestions))) return { action: 'accept' }
  return { action: 'send', requestProposal: accepts && (stage.kind === 'questions' || stage.kind === 'proposal') }
}
