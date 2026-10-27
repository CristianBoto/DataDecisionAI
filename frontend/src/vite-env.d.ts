/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DEMO_MODE?: string
  readonly VITE_API_BASE_URL?: string
  readonly VITE_BACKEND_PROFILING?: string
  readonly VITE_MAX_UPLOAD_MB?: string
  readonly VITE_TURNSTILE_SITE_KEY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
