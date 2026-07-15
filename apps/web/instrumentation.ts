import {
  sanitizeTelemetryEvent,
  sanitizeTelemetrySpan,
} from "@/lib/telemetry/sanitize"

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const dsn = process.env.SENTRY_DSN
    if (dsn) {
      const Sentry = await import("@sentry/nextjs")
      Sentry.init({
        dsn,
        tracesSampleRate: 0.1,
        beforeSend: sanitizeTelemetryEvent,
        beforeSendSpan: sanitizeTelemetrySpan,
        beforeSendTransaction: sanitizeTelemetryEvent,
      })
    }
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    const dsn = process.env.SENTRY_DSN
    if (dsn) {
      const Sentry = await import("@sentry/nextjs")
      Sentry.init({
        dsn,
        tracesSampleRate: 0.1,
        beforeSend: sanitizeTelemetryEvent,
        beforeSendSpan: sanitizeTelemetrySpan,
        beforeSendTransaction: sanitizeTelemetryEvent,
      })
    }
  }
}

export async function onRequestError(
  error: unknown,
  request: {
    path: string
    method: string
    headers: Record<string, string | string[] | undefined>
  },
  errorContext: { routerKind: string; routePath: string; routeType: string }
) {
  const Sentry = await import("@sentry/nextjs")
  Sentry.captureRequestError(error, request, errorContext)
}
