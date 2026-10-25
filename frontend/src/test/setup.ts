import '@testing-library/jest-dom/vitest'

// Red bloqueada: una prueba que necesite `fetch` debe simularlo (vi.spyOn). Así ninguna
// prueba puede llegar a un backend local real ni, a través de él, a OpenAI.
globalThis.fetch = (input: RequestInfo | URL) =>
  Promise.reject(new Error(`Red bloqueada en las pruebas: ${String(input instanceof Request ? input.url : input)}`))
