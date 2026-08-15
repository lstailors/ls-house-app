/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_BACKEND_URL?: string;
  readonly VITE_ALTS_PUBLIC_URL?: string;
  readonly VITE_APP_PUBLIC_URL?: string;
  readonly VITE_SENTRY_DSN?: string;
  readonly VITE_COMMIT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
