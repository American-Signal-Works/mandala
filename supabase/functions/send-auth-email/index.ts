import { Webhook } from "https://esm.sh/standardwebhooks@1.0.0"
import { createClient } from "npm:@supabase/supabase-js@2.105.1"
import { Resend } from "npm:resend@4.0.0"

import {
  handleSendAuthEmailRequest,
  normalizeWebhookSecret,
  type AuthEmailDelivery,
  type ResendEmailPayload,
  type SendAuthEmailConfig,
} from "./_shared/magic-link-email.ts"
import type {
  DeliveryClaim,
  DeliveryResult,
} from "../email-delivery-worker/_shared/delivery.ts"

Deno.serve((request) =>
  handleSendAuthEmailRequest(request, {
    claimDelivery: (deliveryId, config) => claimDelivery(deliveryId, config),
    enqueueDelivery: (input) => enqueueDelivery(input),
    getEnv: (name) => Deno.env.get(name),
    recordDeliveryResult: (claim, result, config) =>
      recordDeliveryResult(claim, result, config),
    sendEmail: (payload, config, idempotencyKey) =>
      sendWithResend(payload, config, idempotencyKey),
    verifyWebhook: (payload, headers, secret) => {
      const webhook = new Webhook(normalizeWebhookSecret(secret))
      return webhook.verify(payload, headers)
    },
  })
)

async function sendWithResend(
  payload: ResendEmailPayload,
  config: SendAuthEmailConfig,
  idempotencyKey: string
) {
  const resend = new Resend(config.resendApiKey)
  const result = await resend.emails.send(payload, { idempotencyKey })
  return { id: result.data?.id, error: result.error }
}

async function enqueueDelivery({
  config,
  recipientEmail,
  templateKey,
  userId,
  webhookId,
}: {
  config: SendAuthEmailConfig
  recipientEmail: string
  templateKey: "auth_magic_link" | "auth_recovery"
  userId: string
  webhookId: string
}): Promise<AuthEmailDelivery> {
  const supabase = adminClient(config)
  const { data, error } = await supabase.rpc("enqueue_auth_email_delivery", {
    p_recipient_email: recipientEmail,
    p_template_key: templateKey,
    p_user_id: userId,
    p_webhook_id: webhookId,
  })
  if (error || !data?.id || !data.state)
    throw error ?? new Error("enqueue_failed")
  return { deliveryId: data.id, state: data.state }
}

async function claimDelivery(
  deliveryId: string,
  config: SendAuthEmailConfig
): Promise<DeliveryClaim | null> {
  const supabase = adminClient(config)
  const { data, error } = await supabase.rpc(
    "claim_inline_auth_email_delivery",
    { p_delivery_id: deliveryId }
  )
  if (error) throw error
  return (data?.[0] as DeliveryClaim | undefined) ?? null
}

async function recordDeliveryResult(
  claim: DeliveryClaim,
  result: DeliveryResult,
  config: SendAuthEmailConfig
) {
  const supabase = adminClient(config)
  const { error } = await supabase.rpc("record_email_delivery_result", {
    p_claim_token: claim.claim_token,
    p_delivery_id: claim.delivery_id,
    p_error_category: result.errorCategory ?? null,
    p_outcome: result.outcome,
    p_provider_email_id: result.providerEmailId ?? null,
  })
  if (error) throw error
}

function adminClient(config: SendAuthEmailConfig) {
  return createClient(config.supabaseUrl, config.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}
