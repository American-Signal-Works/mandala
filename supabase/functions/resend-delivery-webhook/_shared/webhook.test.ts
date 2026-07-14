import assert from "node:assert/strict"
import test from "node:test"

import {
  handleResendDeliveryWebhook,
  normalizeWebhookSecret,
  RESEND_EVENT_TYPES,
  toStandardWebhookHeaders,
} from "./webhook.ts"

test("verifies the exact raw body with the dedicated Resend secret", async () => {
  const rawBody = JSON.stringify({
    type: "email.delivered",
    created_at: "2026-07-14T12:00:00.000Z",
    data: { email_id: "provider-email-1" },
  })
  const recorded: unknown[] = []
  const request = new Request("https://example.test/webhook", {
    method: "POST",
    headers: { "svix-id": "provider-event-1", "x-fixture-signature": "valid" },
    body: rawBody,
  })
  const response = await handleResendDeliveryWebhook(request, {
    getSecret: () => "v1,whsec_resend-only-secret",
    verify: (body, headers, secret) => {
      assert.equal(body, rawBody)
      assert.equal(headers["x-fixture-signature"], "valid")
      assert.equal(secret, "resend-only-secret")
      return JSON.parse(body)
    },
    recordEvent: async (event) => {
      recorded.push(event)
    },
  })

  assert.equal(response.status, 200)
  assert.deepEqual(recorded, [
    {
      providerEventId: "provider-event-1",
      providerEmailId: "provider-email-1",
      eventType: "delivered",
      occurredAt: "2026-07-14T12:00:00.000Z",
    },
  ])
})

test("maps every supported Resend delivery event", async () => {
  const recorded: string[] = []
  for (const [providerType, eventType] of Object.entries(RESEND_EVENT_TYPES)) {
    const response = await handleResendDeliveryWebhook(
      new Request("https://example.test/webhook", {
        method: "POST",
        headers: { "svix-id": `event-${eventType}` },
        body: JSON.stringify({
          type: providerType,
          created_at: "2026-07-14T12:00:00.000Z",
          data: { email_id: "provider-email-1" },
        }),
      }),
      {
        getSecret: () => "resend-secret",
        verify: (body) => JSON.parse(body),
        recordEvent: async (event) => {
          recorded.push(event.eventType)
        },
      }
    )
    assert.equal(response.status, 200)
  }

  assert.deepEqual(recorded, [
    "sent",
    "delivered",
    "delayed",
    "failed",
    "bounced",
    "suppressed",
    "complained",
  ])
})

test("rejects invalid signatures without recording payload data", async () => {
  let recorded = false
  const response = await handleResendDeliveryWebhook(
    new Request("https://example.test/webhook", {
      method: "POST",
      body: "sensitive raw body",
    }),
    {
      getSecret: () => "resend-secret",
      verify: () => {
        throw new Error("invalid")
      },
      recordEvent: async () => {
        recorded = true
      },
    }
  )

  assert.equal(response.status, 401)
  assert.equal(recorded, false)
})

test("acknowledges signed out-of-scope events without persistence", async () => {
  let recorded = false
  const response = await handleResendDeliveryWebhook(
    new Request("https://example.test/webhook", {
      method: "POST",
      headers: { "svix-id": "opened-event" },
      body: JSON.stringify({
        type: "email.opened",
        created_at: "2026-07-14T12:00:00.000Z",
        data: { email_id: "provider-email-1" },
      }),
    }),
    {
      getSecret: () => "resend-secret",
      verify: (body) => JSON.parse(body),
      recordEvent: async () => {
        recorded = true
      },
    }
  )

  assert.equal(response.status, 200)
  assert.equal(recorded, false)
})

test("normalizes only the supported secret wrapper", () => {
  assert.equal(normalizeWebhookSecret("v1,whsec_value"), "value")
  assert.equal(normalizeWebhookSecret("plain-value"), "plain-value")
})

test("adapts Resend svix signature headers for standardwebhooks", () => {
  assert.deepEqual(
    toStandardWebhookHeaders({
      "svix-id": "event-1",
      "svix-timestamp": "1720987200",
      "svix-signature": "v1,signature",
    }),
    {
      "webhook-id": "event-1",
      "webhook-timestamp": "1720987200",
      "webhook-signature": "v1,signature",
    }
  )
})
