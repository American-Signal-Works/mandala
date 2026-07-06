import { Webhook } from "https://esm.sh/standardwebhooks@1.0.0"
import { Resend } from "npm:resend@4.0.0"

import {
  handleSendAuthEmailRequest,
  normalizeWebhookSecret,
  type ResendEmailPayload,
  type SendAuthEmailConfig,
} from "./_shared/magic-link-email.ts"

Deno.serve((request) =>
  handleSendAuthEmailRequest(request, {
    getEnv: (name) => Deno.env.get(name),
    sendEmail: (payload, config) => sendWithResend(payload, config),
    verifyWebhook: (payload, headers, secret) => {
      const webhook = new Webhook(normalizeWebhookSecret(secret))
      return webhook.verify(payload, headers)
    },
  })
)

async function sendWithResend(
  payload: ResendEmailPayload,
  config: SendAuthEmailConfig
) {
  const resend = new Resend(config.resendApiKey)
  return resend.emails.send(payload)
}
