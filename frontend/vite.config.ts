/// <reference types="vitest/config" />
import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'
import { publicBuildProblems } from './src/lib/buildChecks'
import { apiOrigin, pagesHeadersFile } from './src/lib/securityHeaders'

/** Genera `dist/_headers` (CSP y encabezados de seguridad de Cloudflare Pages) con el backend configurado. */
function securityHeaders(apiBaseUrl: string | undefined): Plugin {
  return {
    name: 'datadecision-security-headers',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: '_headers', source: pagesHeadersFile(apiOrigin(apiBaseUrl)) })
    },
  }
}

/** Corta la compilación si la versión pública quedaría en DEMO o mal configurada. */
function publicBuildGuard(env: Record<string, string | undefined>): Plugin {
  return {
    name: 'datadecision-public-build-guard',
    apply: 'build',
    buildStart() {
      const problems = publicBuildProblems(env)
      if (problems.length) throw new Error(['Configuración de compilación inválida:', ...problems].join('\n- '))
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  return {
    plugins: [
      react(),
      tailwindcss(),
      publicBuildGuard({ ...env, CF_PAGES: process.env.CF_PAGES }),
      securityHeaders(env.VITE_API_BASE_URL),
    ],
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    server: {
      port: 5173,
    },
    build: {
      rollupOptions: {
        output: {
          // Separa las librerías grandes para mejorar la caché del navegador.
          manualChunks: {
            react: ['react', 'react-dom', 'react-router-dom'],
            charts: ['recharts'],
          },
        },
      },
    },
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./src/test/setup.ts'],
      css: false,
      // Los recorridos de punta a punta (cargar → revisar → conversar → confirmar) tardan ~4 s
      // y, con la máquina cargada, superaban el límite por defecto de 5 s sin fallar ninguna aserción.
      testTimeout: 15_000,
      // Las pruebas no dependen del .env.local de quien las ejecuta (que puede apuntar a un
      // backend real con la IA habilitada): siempre corren como la demo pública, sin backend.
      env: {
        VITE_DEMO_MODE: 'true',
        VITE_BACKEND_PROFILING: 'false',
        VITE_API_BASE_URL: 'http://127.0.0.1:9',
        VITE_TURNSTILE_SITE_KEY: '',
      },
    },
  }
})
