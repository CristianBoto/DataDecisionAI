/**
 * Sesión de acceso por invitación (token del backend) guardada en `sessionStorage`.
 *
 * - `sessionStorage` y no `localStorage`: se borra al cerrar la pestaña y no se
 *   comparte entre pestañas. No se usan cookies: el token viaja solo en
 *   `Authorization`, así que otro sitio no puede usarlo por el navegador (CSRF).
 * - Un script inyectado (XSS) sí podría leerlo: lo mitigan React (escapa el
 *   contenido) y la CSP de Cloudflare Pages (`public/_headers`, generado al compilar).
 * - Si el almacenamiento falla (modo privado, bloqueado), la sesión vive solo en memoria.
 * - Nunca se guarda el código de invitación.
 */

export interface AccessSession {
  token: string
  label: string
  /** ISO 8601, informado por el backend. */
  expiresAt: string
}

const STORAGE_KEY = 'datadecision.access'
const listeners = new Set<() => void>()

function isValid(value: unknown): value is AccessSession {
  if (typeof value !== 'object' || value === null) return false
  const s = value as Record<string, unknown>
  return (
    typeof s.token === 'string' &&
    s.token.length > 0 &&
    typeof s.label === 'string' &&
    typeof s.expiresAt === 'string' &&
    Date.parse(s.expiresAt) > Date.now()
  )
}

function readStored(): AccessSession | null {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    return isValid(parsed) ? parsed : null
  } catch {
    return null
  }
}

let current: AccessSession | null = typeof window === 'undefined' ? null : readStored()

function notify() {
  listeners.forEach((listener) => listener())
}

export const accessSession = {
  get(): AccessSession | null {
    if (current && !isValid(current)) accessSession.clear() // venció
    return current
  },
  token(): string | null {
    return accessSession.get()?.token ?? null
  },
  set(session: AccessSession) {
    current = session
    try {
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session))
    } catch {
      // Sin almacenamiento disponible: la sesión sigue en memoria hasta recargar.
    }
    notify()
  },
  clear() {
    const had = current !== null
    current = null
    try {
      window.sessionStorage.removeItem(STORAGE_KEY)
    } catch {
      // Nada que borrar.
    }
    if (had) notify()
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
}
