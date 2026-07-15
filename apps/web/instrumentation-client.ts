import * as Sentry from "@sentry/nextjs"
import {
  sanitizeTelemetryEvent,
  sanitizeTelemetrySpan,
  sanitizeTelemetryText,
  stripUrlSecrets,
} from "@/lib/telemetry/sanitize"

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN
if (dsn) {
  Sentry.init({
    dsn,
    tracesSampleRate: 0.1,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
    beforeSend: sanitizeTelemetryEvent,
    beforeSendSpan: sanitizeTelemetrySpan,
    beforeSendTransaction: sanitizeTelemetryEvent,
    beforeBreadcrumb(breadcrumb) {
      // Strip query strings from fetch/xhr/navigation breadcrumbs (may contain tokens).
      if (
        breadcrumb.category === "fetch" ||
        breadcrumb.category === "xhr" ||
        breadcrumb.category === "navigation"
      ) {
        if (breadcrumb.data?.url && typeof breadcrumb.data.url === "string") {
          breadcrumb.data.url = stripUrlSecrets(breadcrumb.data.url)
        }
      }
      if (breadcrumb.message) {
        breadcrumb.message = sanitizeTelemetryText(breadcrumb.message)
      }
      return breadcrumb
    },
  })
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart
