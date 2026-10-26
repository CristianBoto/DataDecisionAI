/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
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
    },
  },
})
