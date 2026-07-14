import assert from "node:assert/strict"
import test from "node:test"

import {
  classifyProviderFailure,
  handleDeliveryWorkerRequest,
  type DeliveryClaim,
  type DeliveryResult,
} from "./delivery.ts"

const claim: DeliveryClaim = {
  delivery_id: "delivery-1",
  company_id: "company-1",
  template_key: "workspace_invite",
  template_version: "1",
  payload_reference: "fixture:invite:one",
  recipient_email: "recipient@example.test",
  idempotency_key: "fixture-idempotency-1",
  attempt_number: 1,
  claim_token: "claim-1",
}

test("rejects requests before touching the queue", async () => {
  let claimed = false
  const response = await handleDeliveryWorkerRequest(
    new Request("https://example.test/worker", { method: "POST" }),
    {
      authorize: () => false,
      claimDue: async () => {
        claimed = true
        return []
      },
      resolvePayload: async () => {
        throw new Error("not reached")
      },
      sendEmail: async () => ({ id: "not-reached" }),
      recordResult: async () => undefined,
    }
  )

  assert.equal(response.status, 401)
  assert.equal(claimed, false)
})

test("uses one stable application idempotency key with fixture-only provider injection", async () => {
  const providerKeys: string[] = []
  const recorded: DeliveryResult[] = []
  const response = await handleDeliveryWorkerRequest(
    new Request("https://example.test/worker", {
      method: "POST",
      body: JSON.stringify({ limit: 10 }),
    }),
    {
      authorize: () => true,
      claimDue: async () => [claim],
      resolvePayload: async () => ({
        from: "Mandala <email@example.test>",
        subject: "Fixture",
        html: "<p>Fixture</p>",
        text: "Fixture",
      }),
      sendEmail: async (payload, idempotencyKey) => {
        assert.deepEqual(payload.to, ["recipient@example.test"])
        providerKeys.push(idempotencyKey)
        return { id: "provider-email-1" }
      },
      recordResult: async (_claim, result) => {
        recorded.push(result)
      },
    }
  )

  assert.equal(response.status, 200)
  assert.deepEqual(providerKeys, ["mandala-delivery:delivery-1"])
  assert.deepEqual(recorded, [
    { outcome: "sent", providerEmailId: "provider-email-1" },
  ])
  assert.deepEqual(await response.json(), {
    claimed: 1,
    sent: 1,
    retrying: 0,
    failed: 0,
  })
})

test("classifies fixture provider throttling as retryable without sending email", async () => {
  const recorded: DeliveryResult[] = []
  const response = await handleDeliveryWorkerRequest(
    new Request("https://example.test/worker", {
      method: "POST",
      body: "{}",
    }),
    {
      authorize: () => true,
      claimDue: async () => [claim],
      resolvePayload: async () => ({
        from: "Mandala <email@example.test>",
        subject: "Fixture",
        html: "<p>Fixture</p>",
        text: "Fixture",
      }),
      sendEmail: async () => ({
        error: { statusCode: 429, name: "rate_limit" },
      }),
      recordResult: async (_claim, result) => {
        recorded.push(result)
      },
    }
  )

  assert.equal(response.status, 200)
  assert.deepEqual(recorded, [
    {
      outcome: "transient_failure",
      errorCategory: "transient_rate_limit",
    },
  ])
})

test("invalid rendered payloads fail permanently before provider invocation", async () => {
  let providerCalled = false
  const recorded: DeliveryResult[] = []
  await handleDeliveryWorkerRequest(
    new Request("https://example.test/worker", { method: "POST", body: "{}" }),
    {
      authorize: () => true,
      claimDue: async () => [claim],
      resolvePayload: async () => ({
        from: "",
        subject: "",
        html: "",
        text: "",
      }),
      sendEmail: async () => {
        providerCalled = true
        return { id: "must-not-send" }
      },
      recordResult: async (_claim, result) => {
        recorded.push(result)
      },
    }
  )

  assert.equal(providerCalled, false)
  assert.deepEqual(recorded, [
    {
      outcome: "permanent_failure",
      errorCategory: "permanent_error",
    },
  ])
})

test("provider failure classification keeps only safe categories", () => {
  assert.deepEqual(
    classifyProviderFailure({ status: 400, code: "Invalid Recipient!" }),
    {
      outcome: "permanent_failure",
      errorCategory: "permanent_invalid_recipient_",
    }
  )
  assert.deepEqual(
    classifyProviderFailure(new Error("network details are not persisted")),
    {
      outcome: "transient_failure",
      errorCategory: "transient_error",
    }
  )
})
