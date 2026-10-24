import { Bot, User } from 'lucide-react'
import type { AssistantMessage } from '@/types/domain'
import { cn } from '@/lib/cn'
import { formatTime } from '@/lib/format'

interface ChatMessageProps {
  message: AssistantMessage
  compact?: boolean
}

export function ChatMessage({ message, compact = false }: ChatMessageProps) {
  const isUser = message.role === 'user'
  return (
    <div className={cn('flex animate-slide-up gap-3', isUser && 'flex-row-reverse')}>
      <span
        className={cn(
          'flex shrink-0 items-center justify-center rounded-full',
          compact ? 'size-7' : 'size-8',
          isUser ? 'bg-slate-200 text-slate-600' : 'bg-gradient-to-br from-navy-900 to-blue-600 text-white',
        )}
        aria-hidden
      >
        {isUser ? <User className="size-4" /> : <Bot className="size-4" />}
      </span>
      <div className={cn('flex min-w-0 max-w-[85%] flex-col gap-1', isUser && 'items-end')}>
        <div
          className={cn(
            'rounded-2xl px-4 py-2.5 leading-relaxed whitespace-pre-wrap',
            compact ? 'text-[13px]' : 'text-sm',
            isUser
              ? 'rounded-tr-md bg-blue-600 text-white'
              : 'rounded-tl-md border border-slate-200 bg-white text-slate-800 shadow-sm',
            message.kind === 'notice' && !isUser && 'border-amber-200 bg-amber-50/60',
          )}
        >
          <span className="sr-only">{isUser ? 'Vos: ' : 'Asistente: '}</span>
          {message.content}
        </div>
        <span className="flex items-center gap-1.5 px-1 text-[11px] text-slate-400">
          {!isUser && message.isDemo && (
            <span className="font-semibold text-amber-700">Respuesta simulada · DEMO</span>
          )}
          {!isUser && message.isDemo && <span aria-hidden>·</span>}
          <time dateTime={message.createdAt}>{formatTime(message.createdAt)}</time>
        </span>
      </div>
    </div>
  )
}

export function TypingIndicator() {
  return (
    <div className="flex items-center gap-3" role="status" aria-label="El asistente está escribiendo">
      <span className="flex size-8 items-center justify-center rounded-full bg-gradient-to-br from-navy-900 to-blue-600 text-white" aria-hidden>
        <Bot className="size-4" />
      </span>
      <span className="flex gap-1 rounded-2xl rounded-tl-md border border-slate-200 bg-white px-4 py-3.5 shadow-sm">
        {[0, 150, 300].map((delay) => (
          <span
            key={delay}
            className="size-1.5 animate-pulse-dot rounded-full bg-slate-400"
            style={{ animationDelay: `${delay}ms` }}
          />
        ))}
      </span>
    </div>
  )
}
