/**
 * Acceso por invitación (beta pública): token en sessionStorage, encabezado
 * Authorization, cierre ante 401, pantalla de ingreso y CSP de Cloudflare Pages.
 * La red está simulada: no hay backend real ni Cloudflare.
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AccessGate, SessionControls } from '@/components/auth/AccessGate'
import { apiOrigin, contentSecurityPolicy, pagesHeadersFile } from '@/lib/securityHeaders'
import type { AccessClient } from '@/services/accessClient'
import { accessSession } from '@/services/accessSession'
import { HttpClient } from '@/services/httpClient'

const FUTURE = new Date(Date.now() + 3_600_000).toISOString()
const SESSION = { token: 'token-de-prueba', label: 'Docente', expiresAt: FUTURE }

function okJson(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function client(overrides: Partial<AccessClient> = {}) {
  return {
    config: vi.fn(async () => ({ turnstile_required: false })),
    redeem: vi.fn(async () => SESSION),
    logout: vi.fn(async () => accessSession.clear()),
    ...overrides,
  } satisfies AccessClient
}

afterEach(() => {
  accessSession.clear()
  vi.restoreAllMocks()
})

describe('sesión y cliente HTTP', () => {
  it('agrega Authorization solo con una sesión y la guarda en sessionStorage', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => okJson({ ok: true }))
    const http = new HttpClient('http://api.test')
    await http.json('/api/ai/status')
    expect(new Headers(fetchSpy.mock.calls[0][1]?.headers).get('Authorization')).toBeNull()

    accessSession.set(SESSION)
    expect(JSON.parse(window.sessionStorage.getItem('datadecision.access')!).token).toBe('token-de-prueba')
    expect(window.localStorage.length).toBe(0) // nunca en localStorage
    await http.json('/api/ai/status')
    expect(new Headers(fetchSpy.mock.calls[1][1]?.headers).get('Authorization')).toBe('Bearer token-de-prueba')
  })

  it('un 401 del backend cierra la sesión local', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => okJson({ detail: 'La sesión no es válida o venció.' }, 401))
    accessSession.set(SESSION)
    await expect(new HttpClient('http://api.test').json('/api/ai/status')).rejects.toMatchObject({ status: 401, code: 'unauthenticated' })
    expect(accessSession.get()).toBeNull()
    expect(window.sessionStorage.getItem('datadecision.access')).toBeNull()
  })

  it('una sesión vencida no se usa', () => {
    accessSession.set({ ...SESSION, expiresAt: new Date(Date.now() - 1000).toISOString() })
    expect(accessSession.token()).toBeNull()
  })

  it('si el almacenamiento falla, la sesión sigue en memoria sin romper la app', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('bloqueado')
    })
    accessSession.set(SESSION)
    expect(accessSession.token()).toBe('token-de-prueba')
  })
})

describe('pantalla de acceso por invitación', () => {
  it('sin sesión pide el código; al canjearlo muestra la aplicación', async () => {
    const access = client()
    const user = userEvent.setup()
    render(<AccessGate enabled client={access} turnstileSiteKey={null}><p>Aplicación</p></AccessGate>)
    expect(screen.queryByText('Aplicación')).not.toBeInTheDocument()
    const button = await screen.findByRole('button', { name: 'Ingresar' })
    expect(button).toBeDisabled()
    expect(screen.getByText(/no cargues datos personales/i)).toBeInTheDocument() // aviso de privacidad
    await user.type(screen.getByLabelText('Código de invitación'), 'ddai-codigo-de-prueba')
    await waitFor(() => expect(button).toBeEnabled())
    await user.click(button)
    expect(await screen.findByText('Aplicación')).toBeInTheDocument()
    expect(access.redeem).toHaveBeenCalledWith('ddai-codigo-de-prueba', null)
  })

  it('un código inválido muestra el error del backend', async () => {
    const access = client({ redeem: vi.fn(async () => Promise.reject(new Error('El código de invitación no es válido, venció o fue revocado.'))) })
    const user = userEvent.setup()
    render(<AccessGate enabled client={access} turnstileSiteKey={null}><p>Aplicación</p></AccessGate>)
    await user.type(screen.getByLabelText('Código de invitación'), 'ddai-codigo-falso')
    await user.click(await screen.findByRole('button', { name: 'Ingresar' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('no es válido')
    expect(screen.queryByText('Aplicación')).not.toBeInTheDocument()
  })

  it('si el backend exige Turnstile y falta la clave del sitio, no deja ingresar', async () => {
    const access = client({ config: vi.fn(async () => ({ turnstile_required: true })) })
    render(<AccessGate enabled client={access} turnstileSiteKey={null}><p>Aplicación</p></AccessGate>)
    expect(await screen.findByText('Falta configurar la verificación')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ingresar' })).toBeDisabled()
  })

  it('en la demo pública (sin backend) no hay puerta de acceso', () => {
    render(<AccessGate enabled={false} client={client()}><p>Aplicación</p></AccessGate>)
    expect(screen.getByText('Aplicación')).toBeInTheDocument()
  })

  it('cerrar sesión vuelve a pedir el código y descarta la aplicación', async () => {
    accessSession.set(SESSION)
    const access = client()
    const user = userEvent.setup()
    render(
      <AccessGate enabled client={access} turnstileSiteKey={null}>
        <p>Aplicación</p>
        <SessionControls client={access} />
      </AccessGate>,
    )
    await user.click(screen.getByRole('button', { name: 'Cerrar sesión' }))
    expect(await screen.findByLabelText('Código de invitación')).toBeInTheDocument()
    expect(screen.queryByText('Aplicación')).not.toBeInTheDocument()
  })
})

describe('CSP de Cloudflare Pages', () => {
  it('solo permite conectarse al propio sitio y al backend configurado', () => {
    const origin = apiOrigin('https://datadecision-api.onrender.com/')
    expect(origin).toBe('https://datadecision-api.onrender.com')
    const csp = contentSecurityPolicy(origin)
    expect(csp).toContain("connect-src 'self' https://datadecision-api.onrender.com")
    expect(csp).toContain("script-src 'self' https://challenges.cloudflare.com")
    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).toContain("object-src 'none'")
    expect(csp).not.toContain('unsafe-eval')
    expect(contentSecurityPolicy(apiOrigin('javascript:alert(1)'))).toContain("connect-src 'self';")
    const file = pagesHeadersFile(origin)
    expect(file.startsWith('/*\n')).toBe(true)
    expect(file).toContain('  X-Frame-Options: DENY')
    expect(file).toContain('  X-Content-Type-Options: nosniff')
  })
})
