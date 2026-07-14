import { createClient } from "npm:@supabase/supabase-js@2.105.1"
import { Webhook } from "https://esm.sh/standardwebhooks@1.0.0"

import {
  handleResendDeliveryWebhook,
  normalizeWebhookSecret,
  toStandardWebhookHeaders,
} from "./_shared/webhook.ts"

const supabaseUrl = requiredEnv("SUPABASE_URL")
const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY")
const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

Deno.serve((request) =>
  handleResendDeliveryWebhook(request, {
    getSecret: () => Deno.env.get("RESEND_WEBHOOK_SECRET"),
    verify: (rawBody, headers, secret) => {
      const webhook = new Webhook(normalizeWebhookSecret(secret))
      return webhook.verify(rawBody, toStandardWebhookHeaders(headers))
    },
    recordEvent: async (event) => {
      const { data, error } = await supabase.rpc(
        "record_email_delivery_webhook_event",
        {
          p_provider_event_id: event.providerEventId,
          p_provider_email_id: event.providerEmailId,
          p_event_type: event.eventType,
          p_occurred_at: event.occurredAt,
          p_safe_reason: null,
        }
      )
      if (error) throw error
      if (
        !data ||
        typeof data !== "object" ||
        !(data as { matched?: boolean }).matched
      ) {
        // The provider can beat the worker's result write. Asking Resend to
        // retry preserves the signed event instead of acknowledging a race we
        // could not yet attribute to a logical delivery.
        throw new Error("Provider delivery is not attributable yet.")
      }
    },
  })
)

function requiredEnv(name: string) {
  const value = Deno.env.get(name)?.trim()
  if (!value) throw new Error(`Missing required configuration: ${name}`)
  return value
}
