import { forwardRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { SendHorizontal } from 'lucide-react'
import { cn } from '@/lib/cn'

export const MAX_MESSAGE_LENGTH = 2000

interface ChatComposerProps {
  onSend: (text: string) => void
  disabled?: boolean
  placeholder?: string
  value?: string
  onValueChange?: (value: string) => void
  compact?: boolean
}

/**
 * Campo de texto del chat. Enter envía, Shift+Enter agrega un salto de línea.
 * Puede usarse controlado (value/onValueChange) o no controlado.
 */
export const ChatComposer = forwardRef<HTMLTextAreaElement, ChatComposerProps>(function ChatComposer(
  { onSend, disabled = false, placeholder = 'Escribí tu mensaje…', value, onValueChange, compact = false },
  ref,
) {
  const [internal, setInternal] = useState('')
  const text = value ?? internal
  const setText = onValueChange ?? setInternal
  const trimmed = text.trim()
  const tooLong = text.length > MAX_MESSAGE_LENGTH
  const canSend = !disabled && trimmed.length > 0 && !tooLong

  function submit(event?: FormEvent) {
    event?.preventDefault()
    if (!canSend) return
    onSend(trimmed)
    setText('')
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      submit()
    }
  }

  return (
    <form onSubmit={submit} className="relative">
      <label htmlFor={compact ? 'chat-input-compact' : 'chat-input'} className="sr-only">
        Mensaje para el asistente
      </label>
      <textarea
        ref={ref}
        id={compact ? 'chat-input-compact' : 'chat-input'}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        rows={compact ? 2 : 3}
        placeholder={placeholder}
        disabled={disabled}
        aria-invalid={tooLong || undefined}
        className={cn(
          'block w-full resize-none rounded-2xl border bg-white py-3 pr-14 pl-4 text-sm text-slate-800 shadow-sm transition placeholder:text-slate-400 focus:ring-4 focus:outline-none disabled:bg-slate-50',
          tooLong
            ? 'border-red-300 focus:border-red-400 focus:ring-red-100'
            : 'border-slate-300 focus:border-blue-500 focus:ring-blue-100',
        )}
      />
      <button
        type="submit"
        disabled={!canSend}
        aria-label="Enviar mensaje"
        className="absolute right-2.5 bottom-2.5 flex size-9 items-center justify-center rounded-xl bg-blue-600 text-white transition hover:bg-blue-700 disabled:bg-slate-200 disabled:text-slate-400"
      >
        <SendHorizontal className="size-4" aria-hidden />
      </button>
      <div className="mt-1.5 flex justify-between px-1 text-[11px] text-slate-400">
        <span className="hidden sm:inline">Enter para enviar · Shift + Enter para nueva línea</span>
        <span className={cn('ml-auto', tooLong && 'font-medium text-red-600')}>
          {text.length}/{MAX_MESSAGE_LENGTH}
        </span>
      </div>
    </form>
  )
})
