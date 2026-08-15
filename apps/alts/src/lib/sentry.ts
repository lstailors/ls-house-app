import * as Sentry from "@sentry/react";

const dsn = import.meta.env.VITE_SENTRY_DSN;

export function initSentry() {
  if (!dsn) return;
  Sentry.init({
    dsn,
    release: import.meta.env.VITE_COMMIT || "alts-dev",
    environment: import.meta.env.PROD ? "production" : "development",
    tracesSampleRate: 0.1,
  });
}

export { Sentry };
