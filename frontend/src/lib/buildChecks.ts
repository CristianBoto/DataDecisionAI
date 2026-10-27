/**
 * Controles de la compilación pública (los usa `vite.config.ts`; no dependen del navegador).
 *
 * La versión publicada en Cloudflare Pages es la aplicación REAL con acceso por
 * invitación: el modo DEMO no puede quedar activo por olvidar una variable.
 * Cloudflare Pages define `CF_PAGES=1` al compilar.
 */

type BuildEnv = Record<string, string | undefined>

function isLocalUrl(url: URL): boolean {
  return ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
}

export function publicBuildProblems(env: BuildEnv): string[] {
  const problems: string[] = []
  const demo = env.VITE_DEMO_MODE?.trim().toLowerCase()
  if (demo !== 'true' && demo !== 'false') {
    problems.push('VITE_DEMO_MODE debe definirse explícitamente como "true" o "false" para compilar.')
  }
  const onPages = env.CF_PAGES === '1'
  if (onPages && demo !== 'false') {
    problems.push('En Cloudflare Pages se publica la aplicación real: VITE_DEMO_MODE debe ser "false".')
  }
  if (demo !== 'false') return problems

  let api: URL | null = null
  try {
    api = new URL(env.VITE_API_BASE_URL ?? '')
  } catch {
    problems.push('VITE_API_BASE_URL no es una URL válida.')
  }
  const local = api !== null && isLocalUrl(api)
  if (api && !local && api.protocol !== 'https:') {
    problems.push('VITE_API_BASE_URL debe usar https:// fuera de este equipo.')
  }
  if (onPages && local) {
    problems.push('En Cloudflare Pages, VITE_API_BASE_URL no puede apuntar a localhost.')
  }
  if (api && !local && !env.VITE_TURNSTILE_SITE_KEY?.trim()) {
    problems.push('Falta VITE_TURNSTILE_SITE_KEY: el backend público exige Cloudflare Turnstile.')
  }
  return problems
}
