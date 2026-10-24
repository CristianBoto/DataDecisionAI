import { useEffect, useRef } from 'react'
import { Bot, X } from 'lucide-react'
import { ChatComposer } from '@/components/chat/ChatComposer'
import { ChatMessage, TypingIndicator } from '@/components/chat/ChatMessage'
import { Alert } from '@/components/ui/Alert'
import { DemoBadge } from '@/components/ui/Badge'
import { Spinner } from '@/components/ui/Feedback'
import { useConversation } from '@/hooks/useConversation'
import { useService } from '@/hooks/useService'

interface AssistantPanelProps {
  projectId: string
  onClose: () => void
}

/** Conversación con el asistente dentro del workspace (historial + nuevas preguntas). */
export function AssistantPanel({ projectId, onClose }: AssistantPanelProps) {
  const { mode } = useService()
  const { messages, loading, sending, error, send, retry } = useConversation(projectId)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'end' })
  }, [messages.length, sending])

  return (
    <aside className="flex h-full flex-col bg-slate-50" aria-label="Conversación con el asistente">
      <div className="flex items-center justify-between gap-2 border-b border-slate-200 bg-white px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span className="flex size-8 items-center justify-center rounded-lg bg-gradient-to-br from-navy-900 to-blue-600 text-white">
            <Bot className="size-4" aria-hidden />
          </span>
          <div>
            <p className="text-sm font-semibold text-slate-900">Asistente</p>
            <p className="text-[11px] text-slate-500">Historial del proyecto</p>
          </div>
          {mode === 'demo' && <DemoBadge />}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Cerrar panel del asistente"
          className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>

      <div className="scrollbar-thin flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {loading ? (
          <Spinner label="Cargando conversación…" />
        ) : (
          messages.map((m) => <ChatMessage key={m.id} message={m} compact />)
        )}
        {sending && <TypingIndicator />}
        <div ref={endRef} />
      </div>

      <div className="border-t border-slate-200 bg-white p-3">
        {error && (
          <Alert tone="error" className="mb-2" action={<button className="text-xs font-semibold underline" onClick={retry}>Reintentar</button>}>
            {error}
          </Alert>
        )}
        <ChatComposer compact onSend={send} disabled={sending || loading} placeholder="Preguntá sobre los resultados…" />
      </div>
    </aside>
  )
}
