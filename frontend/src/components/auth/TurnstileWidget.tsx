import { useEffect, useRef } from 'react'

/**
 * Widget de Cloudflare Turnstile (verificación de persona). El token que entrega
 * se valida en el BACKEND al canjear la invitación; aquí solo se obtiene.
 * El script viene de challenges.cloudflare.com (permitido en la CSP).
 */

interface TurnstileApi {
  render(element: HTMLElement, options: Record<string, unknown>): string
  remove(widgetId: string): void
}

declare global {
  interface Window {
    turnstile?: TurnstileApi
  }
}

const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
let loading: Promise<TurnstileApi> | null = null

function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile)
  loading ??= new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = SCRIPT_URL
    script.async = true
    script.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('Turnstile no disponible')))
    script.onerror = () => {
      loading = null
      reject(new Error('No se pudo cargar la verificación de Cloudflare.'))
    }
    document.head.appendChild(script)
  })
  return loading
}

interface TurnstileWidgetProps {
  siteKey: string
  onToken: (token: string | null) => void
  onError: (message: string) => void
}

export function TurnstileWidget({ siteKey, onToken, onError }: TurnstileWidgetProps) {
  const container = useRef<HTMLDivElement>(null)
  // Las funciones se leen por referencia para no volver a crear el widget en cada render.
  const callbacks = useRef({ onToken, onError })
  useEffect(() => {
    callbacks.current = { onToken, onError }
  })

  useEffect(() => {
    let widgetId: string | null = null
    let cancelled = false
    loadTurnstile()
      .then((turnstile) => {
        if (cancelled || !container.current) return
        widgetId = turnstile.render(container.current, {
          sitekey: siteKey,
          action: 'redeem',
          language: 'es',
          callback: (token: string) => callbacks.current.onToken(token),
          'expired-callback': () => callbacks.current.onToken(null),
          'error-callback': () => {
            callbacks.current.onToken(null)
            callbacks.current.onError('La verificación de Cloudflare falló. Recargá la página e intentá de nuevo.')
          },
        })
      })
      .catch((error: Error) => callbacks.current.onError(error.message))
    return () => {
      cancelled = true
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId)
    }
  }, [siteKey])

  return <div ref={container} className="min-h-[65px]" data-testid="turnstile" />
}
