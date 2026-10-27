import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { KeyRound, ShieldCheck } from 'lucide-react'
import { useAccessSession } from '@/hooks/useAccessSession'
import { appConfig } from '@/lib/config'
import { getErrorMessage } from '@/services'
import { defaultAccessClient, type AccessClient } from '@/services/accessClient'
import { accessSession } from '@/services/accessSession'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Logo } from '@/components/ui/Logo'
import { TurnstileWidget } from './TurnstileWidget'

interface AccessGateProps {
  children: ReactNode
  /** false en la demo pública (sin backend): no hay nada que proteger. */
  enabled: boolean
  client?: AccessClient
  turnstileSiteKey?: string | null
}

/** Sin una sesión de invitación vigente, muestra el ingreso en lugar de la aplicación. */
export function AccessGate({ children, enabled, client = defaultAccessClient, turnstileSiteKey = appConfig.turnstileSiteKey }: AccessGateProps) {
  const session = useAccessSession()
  if (!enabled || session) return <>{children}</>
  return <InvitationScreen client={client} turnstileSiteKey={turnstileSiteKey} />
}

function InvitationScreen({ client, turnstileSiteKey }: { client: AccessClient; turnstileSiteKey: string | null }) {
  const [code, setCode] = useState('')
  const [turnstileRequired, setTurnstileRequired] = useState<boolean | null>(null)
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null)
  // Cada token de Turnstile sirve una sola vez: tras un intento se vuelve a mostrar el widget.
  const [attempt, setAttempt] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    client
      .config()
      .then((config) => active && setTurnstileRequired(config.turnstile_required))
      .catch((err: unknown) => {
        if (!active) return
        setTurnstileRequired(false)
        setError(getErrorMessage(err))
      })
    return () => {
      active = false
    }
  }, [client])

  const missingSiteKey = turnstileRequired === true && !turnstileSiteKey
  const canSubmit =
    code.trim().length >= 8 && turnstileRequired !== null && !missingSiteKey && (!turnstileRequired || turnstileToken !== null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!canSubmit) return
    setSubmitting(true)
    setError(null)
    try {
      accessSession.set(await client.redeem(code, turnstileToken))
    } catch (err) {
      setError(getErrorMessage(err))
      setTurnstileToken(null)
      setAttempt((n) => n + 1)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-svh items-center justify-center bg-navy-950 px-4 py-10">
      <Card className="w-full max-w-md p-6 sm:p-8">
        <Logo />
        <h1 className="mt-6 text-xl font-semibold text-slate-900">Acceso por invitación</h1>
        <p className="mt-1 text-sm text-slate-600">
          DataDecision AI está en beta cerrada. Ingresá el código individual que recibiste.
        </p>
        <form className="mt-6 space-y-4" onSubmit={submit} noValidate>
          <label className="block text-sm font-medium text-slate-800">
            Código de invitación
            <input
              type="text"
              name="invitation-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              maxLength={80}
              className="mt-1.5 block w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm focus:border-blue-500 focus:ring-4 focus:ring-blue-100 focus:outline-none"
            />
          </label>
          {turnstileRequired && turnstileSiteKey && (
            <TurnstileWidget key={attempt} siteKey={turnstileSiteKey} onToken={setTurnstileToken} onError={setError} />
          )}
          {missingSiteKey && (
            <Alert tone="error" title="Falta configurar la verificación">
              El servidor exige Cloudflare Turnstile, pero el sitio no tiene VITE_TURNSTILE_SITE_KEY.
            </Alert>
          )}
          {error && <Alert tone="error">{error}</Alert>}
          <Button type="submit" className="w-full" loading={submitting} disabled={!canSubmit} icon={<KeyRound className="size-4" aria-hidden />}>
            Ingresar
          </Button>
        </form>
        <div className="mt-6 flex gap-2 rounded-xl bg-slate-50 p-3 text-xs leading-relaxed text-slate-600">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden />
          <p>
            <strong>Privacidad:</strong> no cargues datos personales ni confidenciales. Los archivos se procesan en memoria
            y no se guardan. A OpenAI solo se envían el objetivo y los metadatos de columnas que revises y autorices; nunca
            las filas. La sesión vence sola y se borra al cerrar la pestaña.
          </p>
        </div>
      </Card>
    </div>
  )
}

/** Etiqueta del visitante y cierre de sesión (solo si hay una sesión). */
export function SessionControls({ client = defaultAccessClient }: { client?: AccessClient }) {
  const session = useAccessSession()
  if (!session) return null
  return (
    <span className="ml-2 inline-flex items-center gap-2">
      <span className="hidden sm:inline">· {session.label}</span>
      <button type="button" className="underline underline-offset-2 hover:no-underline" onClick={() => void client.logout().catch(() => undefined)}>
        Cerrar sesión
      </button>
    </span>
  )
}
