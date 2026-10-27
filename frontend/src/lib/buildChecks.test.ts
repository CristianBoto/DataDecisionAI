import { publicBuildProblems } from './buildChecks'

const REAL = {
  CF_PAGES: '1',
  VITE_DEMO_MODE: 'false',
  VITE_API_BASE_URL: 'https://datadecision-api.onrender.com',
  VITE_TURNSTILE_SITE_KEY: 'clave-publica-de-prueba',
}

describe('compilación pública: el modo DEMO no puede activarse por accidente', () => {
  it('la configuración real de Cloudflare Pages compila', () => {
    expect(publicBuildProblems(REAL)).toEqual([])
  })

  it('en Pages, VITE_DEMO_MODE ausente o "true" corta la compilación', () => {
    expect(publicBuildProblems({ ...REAL, VITE_DEMO_MODE: undefined }).join(' ')).toMatch(/explícitamente/)
    expect(publicBuildProblems({ ...REAL, VITE_DEMO_MODE: 'true' }).join(' ')).toMatch(/debe ser "false"/)
    expect(publicBuildProblems({ ...REAL, VITE_DEMO_MODE: 'si' })).not.toEqual([])
  })

  it('el backend público exige https y la clave de Turnstile', () => {
    expect(publicBuildProblems({ ...REAL, VITE_API_BASE_URL: 'http://api.ejemplo.com' }).join(' ')).toMatch(/https/)
    expect(publicBuildProblems({ ...REAL, VITE_API_BASE_URL: 'http://127.0.0.1:8000' }).join(' ')).toMatch(/localhost/)
    expect(publicBuildProblems({ ...REAL, VITE_API_BASE_URL: 'no es una url' }).join(' ')).toMatch(/válida/)
    expect(publicBuildProblems({ ...REAL, VITE_TURNSTILE_SITE_KEY: '' }).join(' ')).toMatch(/TURNSTILE/)
  })

  it('fuera de Pages se puede compilar contra el backend local o la demo explícita', () => {
    expect(publicBuildProblems({ VITE_DEMO_MODE: 'false', VITE_API_BASE_URL: 'http://127.0.0.1:8000' })).toEqual([])
    expect(publicBuildProblems({ VITE_DEMO_MODE: 'true' })).toEqual([])
  })
})
