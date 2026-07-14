export type DeliveryClaim = {
  delivery_id: string
  company_id: string
  template_key: string
  template_version: string
  payload_reference: string
  recipient_email: string
  idempotency_key: string
  attempt_number: number
  claim_token: string
}

export type RenderedEmail = {
  from: string
  subject: string
  html: string
  text: string
  tags?: Array<{ name: string; value: string }>
}

export type DeliveryResult = {
  outcome: "sent" | "transient_failure" | "permanent_failure"
  providerEmailId?: string
  errorCategory?: string
}

export type DeliveryWorkerDependencies = {
  authorize: (request: Request) => boolean
  claimDue: (limit: number) => Promise<DeliveryClaim[]>
  resolvePayload: (claim: DeliveryClaim) => Promise<RenderedEmail>
  sendEmail: (
    payload: RenderedEmail & { to: string[] },
    idempotencyKey: string
  ) => Promise<{ id?: string; error?: unknown }>
  recordResult: (claim: DeliveryClaim, result: DeliveryResult) => Promise<void>
}

export async function handleDeliveryWorkerRequest(
  request: Request,
  dependencies: DeliveryWorkerDependencies
) {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed." }, 405)
  }

  if (!dependencies.authorize(request)) {
    return jsonResponse({ error: "Unauthorized." }, 401)
  }

  let limit = 25
  try {
    const body = await request.json().catch(() => ({}))
    if (body && typeof body === "object" && "limit" in body) {
      limit = Number((body as { limit: unknown }).limit)
    }
  } catch {
    return jsonResponse({ error: "Invalid request." }, 400)
  }

  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    return jsonResponse({ error: "Invalid request." }, 400)
  }

  let claims: DeliveryClaim[]
  try {
    claims = await dependencies.claimDue(limit)
  } catch {
    return jsonResponse({ error: "Delivery queue unavailable." }, 503)
  }

  let sent = 0
  let retrying = 0
  let failed = 0

  for (const claim of claims) {
    let result: DeliveryResult
    try {
      const rendered = await dependencies.resolvePayload(claim)
      validateRenderedEmail(rendered)
      const providerResult = await dependencies.sendEmail(
        { ...rendered, to: [claim.recipient_email] },
        providerIdempotencyKey(claim)
      )

      if (providerResult.error || !providerResult.id) {
        result = classifyProviderFailure(providerResult.error)
      } else {
        result = { outcome: "sent", providerEmailId: providerResult.id }
      }
    } catch (error) {
      result = classifyProviderFailure(error)
    }

    try {
      await dependencies.recordResult(claim, result)
    } catch {
      // A stale lease or database outage must not cause an untracked second
      // provider send in this invocation. The stable idempotency key protects a
      // later retry while operators retain the attempt for diagnosis.
      failed += 1
      continue
    }

    if (result.outcome === "sent") sent += 1
    else if (result.outcome === "transient_failure") retrying += 1
    else failed += 1
  }

  return jsonResponse({ claimed: claims.length, sent, retrying, failed }, 200)
}

export function classifyProviderFailure(error: unknown): DeliveryResult {
  const status =
    readFiniteNumber(error, "statusCode") ?? readFiniteNumber(error, "status")
  const code =
    readString(error, "name") ?? readString(error, "code") ?? "unknown"
  const transient =
    status === undefined ||
    status === 408 ||
    status === 409 ||
    status === 425 ||
    status === 429 ||
    status >= 500

  return {
    outcome: transient ? "transient_failure" : "permanent_failure",
    errorCategory: transient
      ? `transient_${safeCategory(code)}`
      : `permanent_${safeCategory(code)}`,
  }
}

export function providerIdempotencyKey(claim: DeliveryClaim) {
  return `mandala-delivery:${claim.delivery_id}`
}

function validateRenderedEmail(rendered: RenderedEmail) {
  if (
    !rendered ||
    !rendered.from?.trim() ||
    !rendered.subject?.trim() ||
    !rendered.html?.trim() ||
    !rendered.text?.trim()
  ) {
    const error = new Error(
      "Renderer returned an incomplete email."
    ) as Error & { status: number; code: string }
    error.status = 422
    error.code = "invalid_render"
    throw error
  }
}

function readFiniteNumber(value: unknown, key: string) {
  if (!value || typeof value !== "object" || !(key in value)) return undefined
  const candidate = Number((value as Record<string, unknown>)[key])
  return Number.isFinite(candidate) ? candidate : undefined
}

function readString(value: unknown, key: string) {
  if (!value || typeof value !== "object" || !(key in value)) return undefined
  const candidate = (value as Record<string, unknown>)[key]
  return typeof candidate === "string" && candidate.trim()
    ? candidate.trim()
    : undefined
}

function safeCategory(value: string) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, "_")
      .slice(0, 80) || "unknown"
  )
}

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}
