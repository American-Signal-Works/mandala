export const RESEND_EVENT_TYPES = {
  "email.sent": "sent",
  "email.delivered": "delivered",
  "email.delivery_delayed": "delayed",
  "email.failed": "failed",
  "email.bounced": "bounced",
  "email.suppressed": "suppressed",
  "email.complained": "complained",
} as const

type SupportedEventType =
  (typeof RESEND_EVENT_TYPES)[keyof typeof RESEND_EVENT_TYPES]

export type ResendWebhookDependencies = {
  getSecret: () => string | undefined
  verify: (
    rawBody: string,
    headers: Record<string, string>,
    secret: string
  ) => unknown
  recordEvent: (event: {
    providerEventId: string
    providerEmailId: string
    eventType: SupportedEventType
    occurredAt: string
  }) => Promise<void>
}

export async function handleResendDeliveryWebhook(
  request: Request,
  dependencies: ResendWebhookDependencies
) {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed." }, 405)
  }

  const secret = dependencies.getSecret()?.trim()
  if (!secret) {
    return jsonResponse({ error: "Webhook is not configured." }, 500)
  }

  const rawBody = await request.text()
  const headers = Object.fromEntries(request.headers.entries())
  let verified: unknown
  try {
    verified = dependencies.verify(
      rawBody,
      headers,
      normalizeWebhookSecret(secret)
    )
  } catch {
    return jsonResponse({ error: "Invalid webhook signature." }, 401)
  }

  const parsed = parseResendEvent(verified, request.headers)
  if (parsed === null) {
    // Valid Resend events outside this cycle (for example opened/clicked) are
    // acknowledged but intentionally not persisted.
    return jsonResponse({}, 200)
  }
  if (parsed === undefined) {
    return jsonResponse({ error: "Invalid webhook payload." }, 400)
  }

  try {
    await dependencies.recordEvent(parsed)
  } catch {
    return jsonResponse({ error: "Webhook could not be recorded." }, 503)
  }

  return jsonResponse({}, 200)
}

export function parseResendEvent(payload: unknown, headers: Headers) {
  if (!payload || typeof payload !== "object") return undefined
  const object = payload as Record<string, unknown>
  const providerType = typeof object.type === "string" ? object.type : ""
  if (!(providerType in RESEND_EVENT_TYPES))
    return providerType ? null : undefined

  const data = object.data
  const providerEmailId =
    data &&
    typeof data === "object" &&
    typeof (data as Record<string, unknown>).email_id === "string"
      ? ((data as Record<string, unknown>).email_id as string).trim()
      : ""
  const providerEventId = (
    headers.get("svix-id") ??
    headers.get("webhook-id") ??
    ""
  ).trim()
  const occurredAt =
    typeof object.created_at === "string" ? object.created_at : ""

  if (!providerEmailId || !providerEventId || !isValidTimestamp(occurredAt)) {
    return undefined
  }

  return {
    providerEventId,
    providerEmailId,
    eventType:
      RESEND_EVENT_TYPES[providerType as keyof typeof RESEND_EVENT_TYPES],
    occurredAt,
  }
}

export function normalizeWebhookSecret(secret: string) {
  return secret.trim().replace(/^v1,whsec_/, "")
}

export function toStandardWebhookHeaders(headers: Record<string, string>) {
  return {
    "webhook-id": headers["svix-id"] ?? headers["webhook-id"] ?? "",
    "webhook-timestamp":
      headers["svix-timestamp"] ?? headers["webhook-timestamp"] ?? "",
    "webhook-signature":
      headers["svix-signature"] ?? headers["webhook-signature"] ?? "",
  }
}

function isValidTimestamp(value: string) {
  return value.length > 0 && Number.isFinite(Date.parse(value))
}

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}
