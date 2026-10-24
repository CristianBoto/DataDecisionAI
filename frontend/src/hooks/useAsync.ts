import { useCallback, useEffect, useRef, useState } from 'react'
import { getErrorMessage } from '@/services'

export type AsyncState<T> =
  | { status: 'loading'; data: null; error: null }
  | { status: 'success'; data: T; error: null }
  | { status: 'error'; data: null; error: string }

/**
 * Ejecuta una función asíncrona al montar (y cuando cambian sus dependencias)
 * y expone estado de carga, datos, error y una función para reintentar.
 */
export function useAsync<T>(fn: () => Promise<T>, deps: readonly unknown[]) {
  const [state, setState] = useState<AsyncState<T>>({ status: 'loading', data: null, error: null })
  const [attempt, setAttempt] = useState(0)
  const fnRef = useRef(fn)
  fnRef.current = fn

  useEffect(() => {
    let cancelled = false
    setState({ status: 'loading', data: null, error: null })
    fnRef
      .current()
      .then((data) => {
        if (!cancelled) setState({ status: 'success', data, error: null })
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ status: 'error', data: null, error: getErrorMessage(error) })
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, attempt])

  const retry = useCallback(() => setAttempt((n) => n + 1), [])
  return { ...state, retry }
}
