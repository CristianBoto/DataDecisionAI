import { appConfig } from '@/lib/config'
import { accessSession, type AccessSession } from './accessSession'
import { HttpClient } from './httpClient'

/** Acceso por invitación: el código se canjea en el backend por un token de sesión. */
export interface AccessClient {
  /** Si el backend exige Cloudflare Turnstile para canjear. */
  config(): Promise<{ turnstile_required: boolean }>
  redeem(code: string, turnstileToken: string | null): Promise<AccessSession>
  logout(): Promise<void>
}

interface RedeemResponse {
  token: string
  label: string
  expires_at: string
}

export function createAccessClient(baseUrl: string): AccessClient {
  const http = new HttpClient(baseUrl)
  return {
    config: () => http.json('/api/auth/config', { timeoutMs: 10_000 }),
    async redeem(code, turnstileToken) {
      const response = await http.json<RedeemResponse>('/api/auth/redeem', {
        method: 'POST',
        body: { code: code.trim(), turnstile_token: turnstileToken },
        timeoutMs: 15_000,
      })
      return { token: response.token, label: response.label, expiresAt: response.expires_at }
    },
    async logout() {
      try {
        await http.empty('/api/auth/logout', { method: 'POST', timeoutMs: 10_000 })
      } finally {
        accessSession.clear() // aunque el backend no responda, el navegador olvida el token
      }
    },
  }
}

export const defaultAccessClient = createAccessClient(appConfig.apiBaseUrl)
