import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { ArrowRight, Bot, CheckCircle2, MessagesSquare, Play, ShieldAlert, ShieldCheck, ShieldOff, Sparkles, User } from 'lucide-react'
import { DataReviewSummary } from '@/components/ai/DataReviewSummary'
import { AuthorizedSend } from '@/components/ai/MessageAuthorization'
import { AIReplyCard } from '@/components/chat/AIReplyCard'
import { ChatComposer } from '@/components/chat/ChatComposer'
import { ChatMessage, TypingIndicator } from '@/components/chat/ChatMessage'
import { ProposalSummaryCard } from '@/components/chat/ProposalSummaryCard'
import { Alert } from '@/components/ui/Alert'
import { Badge, DemoBadge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { EmptyState, Spinner } from '@/components/ui/Feedback'
import { FeasibilityBadge } from '@/components/ui/FeasibilityBadge'
import { PageHeader } from '@/components/ui/PageHeader'
import type { AIChatTurn } from '@/context/sessionContext'
import { useAnalysisSession } from '@/hooks/useAnalysisSession'
import { useConversation } from '@/hooks/useConversation'
import { useAIGateway, useService } from '@/hooks/useService'
import { buildAIContext, MAX_HISTORY_TURNS, MAX_OBJECTIVE_CHARS, type AIHistoryTurn } from '@/lib/aiContext'
import { collectAIPlans } from '@/lib/aiPlans'
import { aiConversationStage, routeMessage } from '@/lib/conversationFlow'
import { buildDatasetCatalog } from '@/lib/datasetCatalog'
import { ApiError, getErrorMessage } from '@/services'
import { isRealAIAvailable, type AIAuthorizeResult, type AIStatus } from '@/services/aiGateway'

const MODIFY_PREFIX = 'Quisiera modificar: '
/** Mensaje del botón «Generar propuesta»: va con `request_proposal`, que obliga a la IA a proponer lo viable. */
const PROPOSAL_REQUEST = 'Armá la propuesta de análisis con lo que ya conversamos.'

/**
 * Lo que la IA ya dijo, en texto, para darle continuidad a la conversación: su mensaje,
 * sus preguntas y cada plan con sus operaciones, así puede ajustarlo en vez de repetirlo.
 */
function turnText(result: AIAuthorizeResult): string {
  const questions = result.reply.questions.map((q) => `- ${q.question}`).join('\n')
  const plans = result.reply.plans
    .map((p) => {
      const ops = p.operations
        .map((op) => `${op.operation}(${op.columns.join(', ')}${op.group_by.length ? ` por ${op.group_by.join(', ')}` : ''})`)
        .join('; ')
      return `- Plan propuesto (fuente ${p.source_alias}): ${p.title}. Operaciones: ${ops}`
    })
    .join('\n')
  return [result.reply.message, questions, plans].filter(Boolean).join('\n').slice(0, MAX_OBJECTIVE_CHARS)
}

let turnSeq = 0
const turnId = () => `t${Date.now().toString(36)}${(turnSeq += 1)}`

/** El permiso de conversación dejó de valer (vencido, revocado, configuración cambiada o tope de mensajes). */
function invalidatesGrant(err: unknown): boolean {
  if (!(err instanceof ApiError)) return false
  return err.status === 403 || err.status === 404 || err.status === 410 || /autoriz/i.test(err.message)
}

/** Motivo comprensible por el que la IA real no está disponible (o si todavía se está comprobando). */
function describeAIProblem(status: AIStatus | null, statusError: string | null): { checking: boolean; message: string } {
  if (statusError) return { checking: false, message: `No se pudo consultar al backend: ${statusError}` }
  if (!status) return { checking: true, message: '' }
  if (!status.ai_enabled) {
    return { checking: false, message: 'La IA está deshabilitada en el backend (AI_ENABLED=false). Habilitala en backend/.env y reiniciá el backend.' }
  }
  if (!status.provider_configured) {
    return { checking: false, message: 'Falta configurar OPENAI_API_KEY en backend/.env (la clave nunca se carga en el navegador).' }
  }
  return { checking: false, message: 'El backend no tiene un proveedor de IA disponible.' }
}

const timeLabel = (ms: number) => new Date(ms).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })

export function AssistantPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { mode } = useService()
  const session = useAnalysisSession()
  const { projectId, dataset, profile, sources, review, reviewConfirmed, aiChat, approvedPlanIds, aiConversationGrant: grant } = session
  const aiGateway = useAIGateway()
  // Modo real: hay backend (instalación local o privada). Ahí NUNCA se usa el asistente DEMO.
  // El asistente de respuestas fijas existe solo en la demo pública (sin backend).
  const realMode = Boolean(aiGateway)
  const { messages, proposal, loading, sending, error, send, retry } = useConversation(realMode ? null : projectId)
  const [draft, setDraft] = useState('')
  const [aiStatus, setAIStatus] = useState<AIStatus | null>(null)
  const [statusError, setStatusError] = useState<string | null>(null)
  const [statusAttempt, setStatusAttempt] = useState(0)
  // Mensaje que espera la autorización del usuario para ir a OpenAI.
  const [outgoing, setOutgoing] = useState<{ text: string; fromComposer: boolean; requestProposal: boolean } | null>(null)
  // Envío directo dentro de una conversación autorizada.
  const [aiSending, setAISending] = useState(false)
  const [aiError, setAIError] = useState<string | null>(null)
  const [grantNotice, setGrantNotice] = useState<string | null>(null)
  const [justApproved, setJustApproved] = useState(false)
  // La persona aceptó por escrito («sí») una propuesta completa: se resalta la confirmación formal.
  const [accepted, setAccepted] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [confirmError, setConfirmError] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const composerRef = useRef<HTMLTextAreaElement>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const catalog = useMemo(() => buildDatasetCatalog(sources), [sources])
  const stage = useMemo(() => aiConversationStage(aiChat, approvedPlanIds), [aiChat, approvedPlanIds])

  // Mientras hay un permiso, se revisa su vencimiento para mostrar el estado correcto.
  useEffect(() => {
    if (!grant) return
    const timer = window.setInterval(() => setNow(Date.now()), 15_000)
    return () => window.clearInterval(timer)
  }, [grant])

  useEffect(() => {
    if (!aiGateway) return
    let cancelled = false
    setStatusError(null)
    aiGateway.status().then(
      (status) => {
        if (!cancelled) setAIStatus(status)
      },
      (err: unknown) => {
        if (!cancelled) {
          setAIStatus(null)
          setStatusError(getErrorMessage(err))
        }
      },
    )
    return () => {
      cancelled = true
    }
  }, [aiGateway, statusAttempt])
  // La IA se puede usar solo si el backend confirma que está habilitada, con clave y proveedor.
  const aiReady = realMode && isRealAIAvailable(aiStatus)
  const aiProblem = realMode && !aiReady ? describeAIProblem(aiStatus, statusError) : null

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'end' })
  }, [messages.length, sending, aiChat.length, aiSending, justApproved, accepted])

  // Si se vuelve desde la confirmación con "Modificar" o con un ajuste sugerido, se prepara el mensaje
  // (editable: nunca se envía solo, sigue necesitando la autorización de siempre).
  const navState = location.state as { modify?: boolean; draft?: string } | null
  const wantsModify = navState?.modify === true
  const suggestedDraft = typeof navState?.draft === 'string' ? navState.draft.slice(0, MAX_OBJECTIVE_CHARS) : null
  useEffect(() => {
    if (wantsModify || suggestedDraft) {
      setDraft(suggestedDraft ?? MODIFY_PREFIX)
      composerRef.current?.focus()
    }
  }, [wantsModify, suggestedDraft])

  const history = useMemo<AIHistoryTurn[]>(
    () =>
      aiChat
        .slice(-MAX_HISTORY_TURNS)
        .map((t) => ({ role: t.role, content: t.result ? turnText(t.result) : t.content.slice(0, MAX_OBJECTIVE_CHARS) })),
    [aiChat],
  )

  if (dataset && profile && (!reviewConfirmed || !projectId)) {
    return (
      <EmptyState
        icon={<MessagesSquare className="size-6" />}
        title="Primero revisá tus datos"
        description="La revisión de interpretaciones y privacidad es obligatoria antes de conversar con el asistente."
        action={
          <Link to="/analisis/revisar">
            <Button>Ir a la revisión</Button>
          </Link>
        }
      />
    )
  }

  if (!projectId || !dataset || !profile) {
    return (
      <EmptyState
        icon={<MessagesSquare className="size-6" />}
        title="Primero cargá un dataset"
        description="El asistente necesita conocer el perfil de tus datos para ayudarte a definir el análisis."
        action={
          <Link to="/analisis/cargar">
            <Button>Ir a cargar datos</Button>
          </Link>
        }
      />
    )
  }

  function requestChanges() {
    setDraft(MODIFY_PREFIX)
    composerRef.current?.focus()
  }

  const objective = review?.objective.trim() ?? ''
  const started = realMode ? aiChat.length > 0 : messages.some((m) => m.role === 'user')
  const showStart = Boolean(objective) && !started && !outgoing

  const grantActive = Boolean(grant && grant.expiresAt > now && aiGateway?.sendInConversation)
  const grantExpired = Boolean(grant && !grantActive)
  // Al enviar se mira el reloj en ese momento (el estado visual se refresca cada 15 s).
  const grantLive = () => Boolean(grant && grant.expiresAt > Date.now() && aiGateway?.sendInConversation)

  function requestAuthorization(text: string, fromComposer: boolean, requestProposal = false) {
    if (grant && !grantLive()) {
      session.setAIConversationGrant(null)
      setGrantNotice('La autorización de la conversación venció. Autorizá de nuevo para seguir.')
    }
    setOutgoing({ text, fromComposer, requestProposal })
  }

  /** Cada envío nace de una acción explícita del usuario: con permiso, va directo; sin él, se pide autorización. */
  function dispatch(text: string, fromComposer: boolean, requestProposal = false) {
    if (grantLive()) void sendInConversation(text, fromComposer, requestProposal)
    else requestAuthorization(text, fromComposer, requestProposal)
  }

  function startConversation() {
    // El objetivo se escribió una sola vez, en la revisión: no hace falta copiarlo.
    if (!realMode) return void send(objective) // solo en la demo pública
    if (!aiReady) return // sin IA disponible no hay respuestas: ni reales ni simuladas
    dispatch(objective, false)
  }

  function handleComposerSend(text: string) {
    if (!realMode) return void send(text) // solo en la demo pública
    if (!aiReady) return
    const route = routeMessage(stage, text)
    // «Sí» a una propuesta completa: no hace falta volver a consultar a la IA (ni gastar presupuesto).
    // Se pasa a la confirmación formal, que es la que cambia el estado.
    if (route.action === 'accept') {
      setAccepted(true)
      return
    }
    // «Sí» a lo que la IA preguntó o sugirió: se le pide explícitamente que cierre con una propuesta.
    dispatch(text, true, route.requestProposal)
  }

  function requestProposal() {
    if (!aiReady) return
    dispatch(PROPOSAL_REQUEST, false, true)
  }

  /** «Confirmar análisis»: aprueba en el backend los planes de la propuesta vigente y pasa a Confirmar. */
  async function confirmProposal(planIds: string[]) {
    if (!aiGateway?.approvePlan) return
    setConfirming(true)
    setConfirmError(null)
    try {
      for (const id of planIds) {
        await aiGateway.approvePlan(id) // registro local en el backend: no consulta a OpenAI ni calcula nada
        session.markPlanApproved(id)
      }
      navigate('/analisis/confirmar')
    } catch (err) {
      setConfirmError(getErrorMessage(err))
    } finally {
      setConfirming(false)
    }
  }

  function appendTurns(text: string, result: AIAuthorizeResult) {
    const turns: AIChatTurn[] = [
      { id: turnId(), role: 'user', content: text },
      { id: turnId(), role: 'assistant', content: result.reply.message, result },
    ]
    session.appendAIChat(turns)
    setAccepted(false)
    void aiGateway?.status().then(setAIStatus, () => undefined)
  }

  async function sendInConversation(text: string, fromComposer: boolean, requestProposal = false) {
    if (!grant || !review || !aiGateway?.sendInConversation) return
    setAISending(true)
    setAIError(null)
    try {
      const payload = buildAIContext(catalog, review.objective, review.sources, text, history, { requestProposal })
      appendTurns(text, await aiGateway.sendInConversation(grant.id, payload))
    } catch (err) {
      if (invalidatesGrant(err)) {
        // El backend rechazó el permiso: se descarta y se pide autorizar este mensaje de nuevo.
        session.setAIConversationGrant(null)
        setGrantNotice(getErrorMessage(err))
        setOutgoing({ text, fromComposer, requestProposal })
      } else {
        // Presupuesto, límites, conexión o validación: se informa y el texto vuelve al chat. Sin reintentos.
        setAIError(getErrorMessage(err))
        if (fromComposer) setDraft(text)
      }
    } finally {
      setAISending(false)
    }
  }

  function handleSent(result: AIAuthorizeResult) {
    if (!outgoing) return
    appendTurns(outgoing.text, result)
    if (result.conversation) {
      session.setAIConversationGrant({
        id: result.conversation.conversation_id,
        expiresAt: Date.now() + result.conversation.expires_in_seconds * 1000,
        maxMessages: result.conversation.max_messages,
      })
      setNow(Date.now())
    }
    setGrantNotice(null)
    setOutgoing(null)
  }

  function revokeGrant() {
    // El proveedor de la sesión también lo revoca en el backend.
    session.setAIConversationGrant(null)
    setGrantNotice(null)
  }

  function handleCancelSend() {
    // Cancelar no borra lo escrito: vuelve al campo del chat.
    if (outgoing?.fromComposer) setDraft(outgoing.text)
    setOutgoing(null)
  }

  async function approvePlan(planId: string) {
    if (!aiGateway?.approvePlan) return
    await aiGateway.approvePlan(planId) // registro local en el backend: no consulta a OpenAI ni calcula nada
    session.markPlanApproved(planId)
    setJustApproved(true)
  }

  function keepTalking() {
    setJustApproved(false)
    composerRef.current?.focus()
  }

  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant')
  const suggestions = !realMode && !sending && lastAssistant?.suggestions ? lastAssistant.suggestions : []
  const proposedPlans = collectAIPlans(aiChat, approvedPlanIds).length

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={
          <>
            <Badge tone="blue">Paso 3 de 5</Badge>
            {realMode ? (
              aiReady ? (
                <Badge tone="green" icon={<ShieldCheck className="size-3" aria-hidden />}>
                  IA real · {aiStatus?.model}
                </Badge>
              ) : (
                <Badge tone="red" icon={<ShieldAlert className="size-3" aria-hidden />}>
                  {aiProblem?.checking ? 'Comprobando la IA…' : 'IA no disponible'}
                </Badge>
              )
            ) : (
              mode === 'demo' && <DemoBadge label="Asistente simulado" />
            )}
          </>
        }
        title="Contale al asistente qué necesitás"
        description="El asistente revisa tus datos, te hace preguntas y arma una propuesta para que la apruebes."
        actions={
          !realMode &&
          proposal && (
            <Button onClick={() => navigate('/analisis/confirmar')} iconRight={<ArrowRight className="size-4" />}>
              Revisar propuesta
            </Button>
          )
        }
      />

      {realMode && aiProblem ? (
        aiProblem.checking ? (
          <Alert tone="info" title="Comprobando la conexión con la IA…">
            Consultando al backend si OpenAI está habilitado. El chat se activa cuando lo confirme.
          </Alert>
        ) : (
          <Alert
            tone="error"
            title="La IA no está disponible"
            action={
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  // Mientras se vuelve a consultar se muestra «Comprobando…», no el motivo anterior.
                  setAIStatus(null)
                  setStatusError(null)
                  setStatusAttempt((n) => n + 1)
                }}
              >
                Reintentar
              </Button>
            }
          >
            {aiProblem.message} No se muestran respuestas simuladas: el asistente necesita OpenAI real.
          </Alert>
        )
      ) : realMode ? (
        <Alert tone="info" title="Asistente con IA real (OpenAI)">
          Cada mensaje requiere tu autorización: antes de enviarlo ves el contenido exacto y su costo máximo estimado.
          Solo se envían el objetivo, el mensaje y los metadatos autorizados, nunca tus archivos ni sus valores. La IA
          propone; los cálculos los hace Pandas en el backend de DataDecision AI cuando apruebes y ejecutes un plan.
          {aiStatus?.remaining_usd != null && aiStatus.budget_usd != null && (
            <> Presupuesto local disponible: USD {aiStatus.remaining_usd.toFixed(4)} de {aiStatus.budget_usd.toFixed(2)}.</>
          )}
        </Alert>
      ) : (
        mode === 'demo' && (
          <Alert tone="demo" title="Conversación de demostración">
            Las respuestas siguen un guion fijo basado en palabras clave y en el perfil del dataset. No hay una IA real
            conectada: revisión de datos confirmada, sin ninguna transmisión a OpenAI.
          </Alert>
        )
      )}

      {/* La configuración de datos se edita solo en el paso 2: acá, un resumen y el acceso para volver. */}
      {review && <DataReviewSummary sources={sources} review={review} />}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-4">
          <Card className="flex min-h-[520px] flex-col overflow-hidden lg:h-[calc(100svh-300px)]">
            <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-3">
              <span className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-navy-900 to-blue-600 text-white">
                <Bot className="size-4" aria-hidden />
              </span>
              <div>
                <p className="text-sm font-semibold text-slate-900">
                  {realMode ? 'Asistente de requisitos · IA real' : 'Asistente de requisitos'}
                </p>
                <p className="text-xs text-slate-500">Te ayuda a definir el análisis · Nunca inventa datos</p>
              </div>
            </div>

            <div className="scrollbar-thin flex-1 space-y-5 overflow-y-auto bg-slate-50/60 px-4 py-5 sm:px-6" aria-live="polite">
              {showStart && (
                <section
                  aria-label="Objetivo confirmado"
                  className="rounded-2xl border border-blue-100 bg-white p-4 text-sm shadow-sm"
                >
                  <p className="text-xs font-semibold tracking-wide text-blue-700 uppercase">Tu objetivo confirmado</p>
                  <p className="mt-1 leading-relaxed whitespace-pre-wrap text-slate-800">{objective}</p>
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <Button
                      icon={<Play className="size-4" />}
                      onClick={startConversation}
                      disabled={realMode ? !aiReady : sending || loading}
                    >
                      Comenzar conversación
                    </Button>
                    <span className="text-xs text-slate-500">
                      {realMode
                        ? 'Antes de enviarlo vas a ver el contenido y el costo estimado.'
                        : 'Lo escribiste en la revisión: no hace falta copiarlo.'}
                    </span>
                  </div>
                </section>
              )}

              {realMode ? (
                aiChat.map((turn) =>
                  turn.role === 'user' ? (
                    <div key={turn.id} className="flex flex-row-reverse gap-3">
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-slate-200 text-slate-600" aria-hidden>
                        <User className="size-4" />
                      </span>
                      <p className="max-w-[85%] rounded-2xl rounded-tr-md bg-blue-600 px-4 py-2.5 text-sm whitespace-pre-wrap text-white">
                        <span className="sr-only">Vos: </span>
                        {turn.content}
                      </p>
                    </div>
                  ) : (
                    <div key={turn.id} className="flex gap-3">
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-navy-900 to-blue-600 text-white" aria-hidden>
                        <Bot className="size-4" />
                      </span>
                      <div className="min-w-0 max-w-[90%] rounded-2xl rounded-tl-md border border-slate-200 bg-white px-4 py-3 shadow-sm">
                        {turn.result && (
                          <AIReplyCard
                            result={turn.result}
                            approvedPlanIds={approvedPlanIds}
                            onApprove={aiGateway?.approvePlan ? approvePlan : undefined}
                          />
                        )}
                      </div>
                    </div>
                  ),
                )
              ) : loading ? (
                <Spinner label="Preparando la conversación…" />
              ) : (
                messages.map((m) => (
                  <div key={m.id} className="space-y-3">
                    <ChatMessage message={m} />
                    {proposal && m.proposalId === proposal.id && (
                      <div className="sm:pl-11">
                        <ProposalSummaryCard
                          proposal={proposal}
                          onReview={() => navigate('/analisis/confirmar')}
                          onRequestChanges={requestChanges}
                        />
                      </div>
                    )}
                  </div>
                ))
              )}
              {realMode && justApproved && (
                <section aria-label="Plan aprobado" className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4 text-sm">
                  <p className="flex items-center gap-1.5 font-semibold text-emerald-900">
                    <CheckCircle2 className="size-4" aria-hidden /> Plan aprobado correctamente.
                  </p>
                  <p className="mt-1 text-emerald-900/80">Tu propuesta está lista para revisar en el siguiente paso.</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button size="sm" iconRight={<ArrowRight className="size-3.5" />} onClick={() => navigate('/analisis/confirmar')}>
                      Continuar a Confirmar
                    </Button>
                    <Button size="sm" variant="ghost" onClick={keepTalking}>
                      Seguir conversando
                    </Button>
                  </div>
                </section>
              )}
              {realMode && stage.kind === 'proposal' && !aiSending && !outgoing && (
                <section aria-label="Propuesta lista" className="rounded-2xl border border-blue-200 bg-blue-50/70 p-4 text-sm">
                  <p className="flex items-center gap-1.5 font-semibold text-navy-900">
                    <CheckCircle2 className="size-4 text-blue-600" aria-hidden />
                    {accepted ? 'Entendido: aceptás la propuesta.' : 'La propuesta de análisis está lista.'}
                  </p>
                  <p className="mt-1 text-slate-700">
                    {stage.planIds.length === 1 ? 'Incluye 1 plan' : `Incluye ${stage.planIds.length} planes`}, con sus operaciones
                    y limitaciones arriba. «Confirmar análisis» {stage.planIds.length === 1 ? 'lo aprueba' : 'los aprueba'} y te
                    lleva al paso Confirmar; lo que no se puede calcular queda indicado como limitación.
                  </p>
                  {confirmError && (
                    <Alert tone="error" className="mt-2">
                      {confirmError}
                    </Alert>
                  )}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      icon={<CheckCircle2 className="size-3.5" />}
                      loading={confirming}
                      disabled={!aiGateway?.approvePlan}
                      onClick={() => void confirmProposal(stage.planIds)}
                    >
                      Confirmar análisis
                    </Button>
                    <Button size="sm" variant="outline" onClick={requestChanges} disabled={confirming}>
                      Modificar propuesta
                    </Button>
                  </div>
                </section>
              )}
              {realMode && aiReady && stage.kind === 'questions' && !aiSending && !outgoing && (
                <section aria-label="Generar propuesta" className="rounded-2xl border border-slate-200 bg-white p-4 text-sm">
                  <p className="text-slate-700">
                    {stage.rounds >= 2
                      ? 'El asistente ya hizo varias preguntas. Si respondiste lo necesario, pedile que arme la propuesta con lo viable.'
                      : 'Respondé las preguntas o, si ya está todo dicho, pedile al asistente que arme la propuesta.'}
                  </p>
                  <Button size="sm" variant={stage.rounds >= 2 ? 'primary' : 'outline'} className="mt-2" onClick={requestProposal}>
                    Generar propuesta
                  </Button>
                </section>
              )}
              {(sending || aiSending) && <TypingIndicator />}
              <div ref={endRef} />
            </div>

            <div className="border-t border-slate-100 bg-white p-4">
              {aiError && realMode && (
                <Alert tone="error" className="mb-3">
                  {aiError}
                </Alert>
              )}
              {error && !realMode && (
                <Alert tone="error" className="mb-3" action={<Button size="sm" variant="outline" onClick={retry}>Reintentar</Button>}>
                  {error}
                </Alert>
              )}
              {suggestions.length > 0 && (
                <div className="mb-3 flex flex-wrap gap-2">
                  {suggestions.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => void send(s)}
                      className="inline-flex items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50/60 px-3 py-1.5 text-xs font-medium text-blue-700 transition hover:border-blue-300 hover:bg-blue-50"
                    >
                      <Sparkles className="size-3" aria-hidden />
                      {s}
                    </button>
                  ))}
                </div>
              )}
              <ChatComposer
                ref={composerRef}
                value={draft}
                onValueChange={setDraft}
                onSend={handleComposerSend}
                disabled={realMode ? !aiReady || aiSending || Boolean(outgoing) : sending || loading}
                placeholder={
                  realMode
                    ? 'Respondé las preguntas o pedí cambios…'
                    : proposal
                      ? 'Pedí cambios a la propuesta o hacé una pregunta…'
                      : 'Ej.: Quiero saber qué productos se venden más en verano'
                }
              />
              {realMode && aiReady ? (
                <div
                  role="status"
                  aria-label="Estado de la autorización"
                  className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 px-1 text-[11px] text-slate-500"
                >
                  {grantActive && grant ? (
                    <>
                      <Badge tone="green" icon={<ShieldCheck className="size-3" aria-hidden />}>
                        Conversación autorizada
                      </Badge>
                      <span>«Enviar» va directo a OpenAI · vence a las {timeLabel(grant.expiresAt)}</span>
                      <button
                        type="button"
                        onClick={revokeGrant}
                        className="inline-flex items-center gap-1 font-medium text-red-700 underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-red-200 focus-visible:outline-none"
                      >
                        <ShieldOff className="size-3" aria-hidden /> Desactivar autorización de conversación
                      </button>
                    </>
                  ) : grantExpired || grantNotice ? (
                    <>
                      <Badge tone="amber" icon={<ShieldAlert className="size-3" aria-hidden />}>
                        {grantExpired ? 'Autorización vencida' : 'Se requiere nueva autorización'}
                      </Badge>
                      <span>El próximo envío volverá a mostrar el panel de privacidad.</span>
                    </>
                  ) : (
                    <>
                      <Badge tone="neutral" icon={<ShieldCheck className="size-3" aria-hidden />}>
                        Autorización por mensaje
                      </Badge>
                      <span>«Enviar» prepara el envío a OpenAI: nada sale sin tu autorización.</span>
                    </>
                  )}
                </div>
              ) : realMode ? null : (
                <p className="mt-1 flex items-center gap-1.5 px-1 text-[11px] text-slate-500">
                  <Bot className="size-3" aria-hidden />
                  {mode === 'demo'
                    ? '«Enviar» conversa con el asistente DEMO, en este equipo. No usa OpenAI.'
                    : '«Enviar» conversa con el asistente del backend.'}
                </p>
              )}
            </div>
          </Card>
          {/* Fuera de la tarjeta del chat (altura fija): al abrirse no empuja los botones fuera de la vista. */}
          {realMode && aiGateway && review && outgoing && (
            <AuthorizedSend
              sources={sources}
              review={review}
              message={outgoing.text}
              history={history}
              requestProposal={outgoing.requestProposal}
              gateway={aiGateway}
              onSent={handleSent}
              onCancel={handleCancelSend}
              notice={grantNotice}
            />
          )}
        </div>

        <aside className="space-y-4">
          <Card className="p-5">
            <p className="text-sm font-semibold text-slate-900">Estado de la propuesta</p>
            {realMode ? (
              <p className="mt-2 text-xs leading-relaxed text-slate-600">
                {proposedPlans === 0
                  ? 'Todavía no hay planes. Comenzá la conversación y respondé las preguntas del asistente.'
                  : `${proposedPlans} ${proposedPlans === 1 ? 'plan propuesto' : 'planes propuestos'} · ${approvedPlanIds.length} ${approvedPlanIds.length === 1 ? 'aprobado' : 'aprobados'}. Los cálculos llegan en la próxima etapa.`}
              </p>
            ) : proposal ? (
              <div className="mt-3 space-y-2 text-xs text-slate-600">
                <div className="flex items-center justify-between">
                  <span>Versión {proposal.version}</span>
                  <FeasibilityBadge value={proposal.feasibility} />
                </div>
                <p className="leading-relaxed">{proposal.feasibilityReason}</p>
              </div>
            ) : (
              <p className="mt-2 text-xs leading-relaxed text-slate-500">
                Todavía no hay propuesta. Respondé las preguntas del asistente para generarla.
              </p>
            )}
          </Card>
        </aside>
      </div>
    </div>
  )
}
