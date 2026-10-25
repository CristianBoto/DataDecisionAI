import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { ArrowRight, Bot, MessagesSquare, PencilLine, Sparkles } from 'lucide-react'
import { DataReviewSummary } from '@/components/ai/DataReviewSummary'
import { MessageAuthorization } from '@/components/ai/MessageAuthorization'
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
import { useAnalysisSession } from '@/hooks/useAnalysisSession'
import { useConversation } from '@/hooks/useConversation'
import { useAIGateway, useService } from '@/hooks/useService'

const MODIFY_PREFIX = 'Quisiera modificar: '

export function AssistantPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { mode } = useService()
  const { projectId, dataset, profile, sources, review, reviewConfirmed } = useAnalysisSession()
  const aiGateway = useAIGateway()
  const { messages, proposal, loading, sending, error, send, retry } = useConversation(projectId)
  // El objetivo de la revisión se precarga, pero no se envía solo: el usuario lo manda.
  const fromReview = (location.state as { fromReview?: boolean } | null)?.fromReview === true
  const [draft, setDraft] = useState(() => (fromReview ? (review?.objective ?? '') : ''))
  const composerRef = useRef<HTMLTextAreaElement>(null)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'end' })
  }, [messages.length, sending])

  // Si se vuelve desde la confirmación con "Modificar", se prepara el mensaje.
  const wantsModify = (location.state as { modify?: boolean } | null)?.modify === true
  useEffect(() => {
    if (wantsModify) {
      setDraft(MODIFY_PREFIX)
      composerRef.current?.focus()
    }
  }, [wantsModify])

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

  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant')
  const suggestions = !sending && lastAssistant?.suggestions ? lastAssistant.suggestions : []
  // El objetivo del paso 2 queda listo como primer mensaje, hasta que el usuario lo envíe.
  const objectiveReady =
    fromReview && Boolean(review?.objective.trim()) && draft.trim() !== '' && !messages.some((m) => m.role === 'user')

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={
          <>
            <Badge tone="blue">Paso 3 de 4</Badge>
            {mode === 'demo' && <DemoBadge label="Asistente simulado" />}
          </>
        }
        title="Contale al asistente qué necesitás"
        description="Escribí tu objetivo con tus palabras. El asistente revisa tus datos, te hace preguntas y arma una propuesta para que la apruebes."
        actions={
          proposal && (
            <Button onClick={() => navigate('/analisis/confirmar')} iconRight={<ArrowRight className="size-4" />}>
              Revisar propuesta
            </Button>
          )
        }
      />

      {mode === 'demo' && (
        <Alert tone="demo" title="Conversación de demostración">
          Las respuestas siguen un guion fijo basado en palabras clave y en el perfil del dataset. No hay una IA real
          conectada todavía: se integrará con OpenAI desde el backend. Revisión de datos confirmada; no hay ninguna
          transmisión a OpenAI.
        </Alert>
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
                <p className="text-sm font-semibold text-slate-900">Asistente de requisitos</p>
                <p className="text-xs text-slate-500">Te ayuda a definir el análisis · Nunca inventa datos</p>
              </div>
            </div>

            <div className="scrollbar-thin flex-1 space-y-5 overflow-y-auto bg-slate-50/60 px-4 py-5 sm:px-6" aria-live="polite">
              {loading ? (
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
              {sending && <TypingIndicator />}
              <div ref={endRef} />
            </div>

            <div className="border-t border-slate-100 bg-white p-4">
              {error && (
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
              {objectiveReady && (
                <p className="mb-2 flex items-start gap-1.5 rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-800" role="status">
                  <PencilLine className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                  <span>
                    <strong>Tu objetivo está preparado. Enviá para comenzar la conversación.</strong> Es el que escribiste en
                    la revisión; podés editarlo antes de enviarlo.
                  </span>
                </p>
              )}
              <ChatComposer
                ref={composerRef}
                value={draft}
                onValueChange={setDraft}
                onSend={(text) => void send(text)}
                disabled={sending || loading}
                placeholder={proposal ? 'Pedí cambios a la propuesta o hacé una pregunta…' : 'Ej.: Quiero saber qué productos se venden más en verano'}
              />
              {mode === 'demo' && (
                <p className="mt-1 flex items-center gap-1.5 px-1 text-[11px] text-slate-500">
                  <Bot className="size-3" aria-hidden />
                  «Enviar» conversa con el asistente DEMO, en este equipo. No usa OpenAI.
                </p>
              )}
            </div>
          </Card>
          {/* Fuera de la tarjeta del chat (altura fija): al abrirse no empuja los botones fuera de la vista. */}
          {review && <MessageAuthorization sources={sources} review={review} message={draft} gateway={aiGateway} />}
        </div>

        <aside className="space-y-4">
          <Card className="p-5">
            <p className="text-sm font-semibold text-slate-900">Estado de la propuesta</p>
            {proposal ? (
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
