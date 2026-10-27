/**
 * Encabezados de seguridad de Cloudflare Pages (`dist/_headers`), generados al compilar.
 *
 * La CSP es una segunda barrera contra XSS (React ya escapa el contenido): solo
 * se ejecutan scripts propios y el de Turnstile, y el navegador solo puede
 * conectarse al propio sitio y al backend configurado en VITE_API_BASE_URL.
 * Lo usa `vite.config.ts`; no depende del navegador.
 */

const TURNSTILE_ORIGIN = 'https://challenges.cloudflare.com'

export function apiOrigin(apiBaseUrl: string | undefined): string | null {
  if (!apiBaseUrl) return null
  try {
    const url = new URL(apiBaseUrl)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.origin : null
  } catch {
    return null
  }
}

export function contentSecurityPolicy(backendOrigin: string | null): string {
  return [
    "default-src 'self'",
    `script-src 'self' ${TURNSTILE_ORIGIN}`,
    `frame-src ${TURNSTILE_ORIGIN}`,
    ['connect-src', "'self'", backendOrigin].filter(Boolean).join(' '),
    "img-src 'self' data: blob:",
    // Recharts y Tailwind aplican estilos en línea; no permiten ejecutar código.
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    'upgrade-insecure-requests',
  ].join('; ')
}

export function pagesHeadersFile(backendOrigin: string | null): string {
  const headers = {
    'Content-Security-Policy': contentSecurityPolicy(backendOrigin),
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    'Cross-Origin-Opener-Policy': 'same-origin',
  }
  const lines = Object.entries(headers).map(([name, value]) => `  ${name}: ${value}`)
  return ['/*', ...lines, ''].join('\n')
}
