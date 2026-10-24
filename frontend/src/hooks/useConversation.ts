import { useCallback, useEffect, useState } from 'react'
import type { AnalysisProposal, AssistantMessage } from '@/types/domain'
import { getErrorMessage } from '@/services'
import { useService } from './useService'

/** Estado y acciones de la conversación con el asistente de un proyecto. */
export function useConversation(projectId: string | null) {
  const service = useService()
  const [messages, setMessages] = useState<AssistantMessage[]>([])
  const [proposal, setProposal] = useState<AnalysisProposal | null>(null)
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!projectId) return
    let cancelled = false
    setLoading(true)
    setError(null)
    Promise.all([service.getConversation(projectId), service.getCurrentProposal(projectId)])
      .then(([history, current]) => {
        if (cancelled) return
        setMessages(history)
        setProposal(current)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(getErrorMessage(err))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [projectId, service, attempt])

  const send = useCallback(
    async (content: string) => {
      if (!projectId) return
      setSending(true)
      setError(null)
      try {
        const reply = await service.sendMessage(projectId, { content })
        setMessages((current) => [...current, ...reply.messages])
        setProposal(reply.proposal)
      } catch (err) {
        setError(getErrorMessage(err))
      } finally {
        setSending(false)
      }
    },
    [projectId, service],
  )

  const retry = useCallback(() => setAttempt((n) => n + 1), [])

  return { messages, proposal, loading, sending, error, send, retry }
}
