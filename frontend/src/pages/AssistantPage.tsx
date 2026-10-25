import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { ArrowRight, Bot, Database, MessagesSquare, ShieldCheck, Sparkles } from 'lucide-react'
import { AIContextReview } from '@/components/ai/AIContextReview'
import { ChatComposer } from '@/components/chat/ChatComposer'
import { ChatMessage, TypingIndicator } from '@/components/chat/ChatMessage'
import { ProposalSummaryCard } from '@/components/chat/ProposalSummaryCard'
import { ColumnTypeTag } from '@/components/upload/DatasetPreview'
import { Alert } from '@/components/ui/Alert'
import { Badge, DemoBadge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardHeader } from '@/components/ui/Card'
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
  const { projectId, dataset, profile, sources } = useAnalysisSession()
  const aiGateway = useAIGateway()
  const [reviewOpen, setReviewOpen] = useState(false)
  const { messages, proposal, loading, sending, error, send, retry } = useConversation(projectId)
  const [draft, setDraft] = useState('')
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

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={
          <>
            <Badge tone="blue">Paso 2 de 3</Badge>
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
          conectada todavía: se integrará con OpenAI desde el backend.
        </Alert>
      )}

      {reviewOpen && (
        <AIContextReview
          sources={sources}
          initialObjective={[...messages].reverse().find((m) => m.role === 'user')?.content ?? ''}
          gateway={aiGateway}
          onClose={() => setReviewOpen(false)}
        />
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
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
            <ChatComposer
              ref={composerRef}
              value={draft}
              onValueChange={setDraft}
              onSend={(text) => void send(text)}
              disabled={sending || loading}
              placeholder={proposal ? 'Pedí cambios a la propuesta o hacé una pregunta…' : 'Ej.: Quiero saber qué productos se venden más en verano'}
            />
          </div>
        </Card>

        <aside className="space-y-4">
          <Card>
            <CardHeader
              icon={<Database className="size-4" aria-hidden />}
              title={dataset.name}
              description={`${dataset.fileName} · ${profile.columnCount > 0 ? `${profile.columnCount} columnas` : 'estructura pendiente'}`}
            />
            <div className="p-5 pt-4">
              {profile.columns.length > 0 ? (
                <ul className="scrollbar-thin max-h-72 space-y-1.5 overflow-y-auto">
                  {profile.columns.map((c) => (
                    <li key={c.name} className="flex items-center justify-between gap-2 text-xs">
                      <span className="truncate font-medium text-slate-700">{c.name}</span>
                      <ColumnTypeTag type={c.inferredType} />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-slate-500">Las columnas se conocerán cuando el backend procese el archivo.</p>
              )}
            </div>
          </Card>

          <Card className="p-5">
            <p className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <ShieldCheck className="size-4 text-blue-600" aria-hidden /> IA real y privacidad
            </p>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">
              Antes de conectar la IA real, revisá qué información mínima se compartiría. Nada se envía sin tu autorización.
            </p>
            <Button variant="outline" size="sm" className="mt-3 w-full" onClick={() => setReviewOpen(true)} disabled={reviewOpen}>
              Revisar qué se enviaría a la IA
            </Button>
          </Card>

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
