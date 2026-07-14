import { createClient } from "npm:@supabase/supabase-js@2.105.1"
import { Resend } from "npm:resend@4.0.0"

import {
  handleDeliveryWorkerRequest,
  type DeliveryClaim,
  type DeliveryResult,
  type RenderedEmail,
} from "./_shared/delivery.ts"

const supabaseUrl = requiredEnv("SUPABASE_URL")
const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY")
const workerSecret = requiredEnv("DELIVERY_WORKER_SECRET")
const resolverUrl = requiredEnv("EMAIL_PAYLOAD_RESOLVER_URL")
const resolverSecret = requiredEnv("EMAIL_PAYLOAD_RESOLVER_SECRET")
const resendApiKey = requiredEnv("RESEND_API_KEY")

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})
const resend = new Resend(resendApiKey)

Deno.serve((request) =>
  handleDeliveryWorkerRequest(request, {
    authorize: (candidate) =>
      constantTimeEqual(readBearer(candidate), workerSecret),
    claimDue: async (limit) => {
      const { data, error } = await supabase.rpc("claim_due_email_deliveries", {
        p_limit: limit,
        p_lease_seconds: 120,
      })
      if (error) throw error
      return (data ?? []) as DeliveryClaim[]
    },
    resolvePayload: (claim) => resolvePayload(claim),
    sendEmail: async (payload, idempotencyKey) => {
      const result = await resend.emails.send(payload, { idempotencyKey })
      return { id: result.data?.id, error: result.error }
    },
    recordResult: async (claim, result) => recordResult(claim, result),
  })
)

async function resolvePayload(claim: DeliveryClaim): Promise<RenderedEmail> {
  const response = await fetch(resolverUrl, {
    method: "POST",
    headers: {
      authorization: `Bearer ${resolverSecret}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      companyId: claim.company_id,
      templateKey: claim.template_key,
      templateVersion: claim.template_version,
      payloadReference: claim.payload_reference,
    }),
  })

  if (!response.ok) {
    const error = new Error("Email payload resolver failed.") as Error & {
      status: number
      code: string
    }
    error.status = response.status
    error.code = "payload_resolver"
    throw error
  }

  return (await response.json()) as RenderedEmail
}

async function recordResult(claim: DeliveryClaim, result: DeliveryResult) {
  const { error } = await supabase.rpc("record_email_delivery_result", {
    p_delivery_id: claim.delivery_id,
    p_claim_token: claim.claim_token,
    p_outcome: result.outcome,
    p_provider_email_id: result.providerEmailId ?? null,
    p_error_category: result.errorCategory ?? null,
  })
  if (error) throw error
}

function requiredEnv(name: string) {
  const value = Deno.env.get(name)?.trim()
  if (!value) throw new Error(`Missing required configuration: ${name}`)
  return value
}

function readBearer(request: Request) {
  const authorization = request.headers.get("authorization") ?? ""
  return authorization.startsWith("Bearer ") ? authorization.slice(7) : ""
}

function constantTimeEqual(left: string, right: string) {
  const encoder = new TextEncoder()
  const leftBytes = encoder.encode(left)
  const rightBytes = encoder.encode(right)
  const length = Math.max(leftBytes.length, rightBytes.length)
  let mismatch = leftBytes.length ^ rightBytes.length
  for (let index = 0; index < length; index += 1) {
    mismatch |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0)
  }
  return mismatch === 0
}
