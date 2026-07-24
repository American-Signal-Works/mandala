import { describe, expect, it, vi } from "vitest"

import {
  MANDALA_MAGIC_LINK_EMAIL_THEME,
  MAGIC_LINK_EMAIL_SUBJECT,
  RECOVERY_EMAIL_SUBJECT,
  buildSupabaseVerifyUrl,
  createResendEmailPayload,
  formatSender,
  handleSendAuthEmailRequest,
  normalizeWebhookSecret,
} from "../../../../supabase/functions/send-auth-email/_shared/magic-link-email"

const config = {
  fromAddress: "auth@example.com",
  hookSecret: "v1,whsec_secret",
  resendApiKey: "re_test",
  serviceRoleKey: "service-role-test",
  supabaseUrl: "https://project.supabase.co",
}

const hookPayload = {
  user: {
    email: "person@example.com",
    id: "71000000-0000-4000-8000-000000000001",
  },
  email_data: {
    email_action_type: "email",
    redirect_to:
      "https://usebackdesk.com/callback?next=%2Flogin%3Fauth%3Dsuccess&method=email",
    token_hash: "token-hash",
  },
}

const delivery = {
  deliveryId: "73000000-0000-4000-8000-000000000001",
  state: "queued",
}

const claim = {
  attempt_number: 1,
  claim_token: "74000000-0000-4000-8000-000000000001",
  company_id: "72000000-0000-4000-8000-000000000001",
  delivery_id: delivery.deliveryId,
  idempotency_key: "auth-hook:msg_123",
  payload_reference: "auth_hook:msg_123",
  recipient_email: "person@example.com",
  template_key: "auth_magic_link",
  template_version: "1",
}

const runtimeEnvironment = {
  RESEND_API_KEY: "re_test",
  RESEND_AUTH_EMAIL_FROM_ADDRESS: "auth@example.com",
  SEND_EMAIL_HOOK_SECRET: "v1,whsec_secret",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-test",
  SUPABASE_URL: "https://project.supabase.co",
}

function requestFor(payload: unknown = hookPayload) {
  return new Request("https://example.com", {
    body: JSON.stringify(payload),
    headers: {
      "webhook-id": "msg_123",
      "webhook-signature": "sig",
      "webhook-timestamp": "123",
    },
    method: "POST",
  })
}

describe("Mandala magic-link email", () => {
  it("builds the Supabase verification URL with the callback redirect", () => {
    expect(
      buildSupabaseVerifyUrl({
        emailActionType: "email",
        redirectTo:
          "https://usebackdesk.com/callback?next=%2Flogin%3Fauth%3Dsuccess&method=email",
        supabaseUrl: "https://project.supabase.co/",
        tokenHash: "token-hash",
      })
    ).toBe(
      "https://project.supabase.co/auth/v1/verify?token=token-hash&type=email&redirect_to=https%3A%2F%2Fusebackdesk.com%2Fcallback%3Fnext%3D%252Flogin%253Fauth%253Dsuccess%26method%3Demail"
    )
  })

  it("forces the Mandala sender display name", () => {
    expect(formatSender("auth@example.com")).toBe("Mandala <auth@example.com>")
  })

  it("rejects sender values that could add email headers", () => {
    expect(() =>
      formatSender("auth@example.com\nBcc: other@example.com")
    ).toThrow("Email hook payload is invalid")
  })

  it("normalizes Supabase hook secrets for Standard Webhooks", () => {
    expect(normalizeWebhookSecret("v1,whsec_base64secret")).toBe("base64secret")
    expect(normalizeWebhookSecret("base64secret")).toBe("base64secret")
  })

  it("creates a Resend payload with the approved subject, copy, and footer", () => {
    const payload = createResendEmailPayload(hookPayload, config)

    expect(payload).toMatchObject({
      from: "Mandala <auth@example.com>",
      subject: MAGIC_LINK_EMAIL_SUBJECT,
      text: expect.stringContaining("after 1 hour"),
      to: ["person@example.com"],
    })
    expect(payload.html).toContain("Sign in to Mandala")
    expect(payload.html).toContain("after 1 hour")
    expect(payload.html).toContain("Sign in")
    expect(payload.html).toContain("&copy; American Signal Works")
    expect(payload.html).toContain("Sheridan, WY")
    expect(payload.html).toContain("token=token-hash")
    expect(payload.html).toContain('name="color-scheme" content="light dark"')
    expect(payload.html).toContain("@media (prefers-color-scheme: dark)")
    expect(payload.html).toContain("mandala-email-mark-light")
    expect(payload.html).toContain("mandala-email-mark-dark")
    expect(payload.html).toContain(
      "raw.githubusercontent.com/American-Signal-Works/mandala"
    )
    expect(payload.html).toContain("auth-icon-light.png")
    expect(payload.html).toContain("auth-icon-dark.png")
    expect(payload.html).toContain("&#8599;")
    expect(payload.html).not.toContain("<svg")
    expect("attachments" in payload).toBe(false)
    expect(payload.html).toContain(
      `background:${MANDALA_MAGIC_LINK_EMAIL_THEME.light.shellBackground}`
    )
    expect(payload.html).toContain(
      `background: ${MANDALA_MAGIC_LINK_EMAIL_THEME.dark.shellBackground} !important`
    )
  })

  it("routes recovery actions to recovery-specific copy", () => {
    const payload = createResendEmailPayload(
      {
        ...hookPayload,
        email_data: {
          ...hookPayload.email_data,
          email_action_type: "recovery",
        },
      },
      config
    )

    expect(payload).toMatchObject({
      subject: RECOVERY_EMAIL_SUBJECT,
      tags: [{ name: "category", value: "auth_recovery" }],
      text: expect.stringContaining("Reset your password"),
    })
    expect(payload.html).toContain("Reset password")
    expect(payload.html).toContain("after 1 hour")
  })

  it("uses the sign-in email for a safely created unknown user", () => {
    const payload = createResendEmailPayload(
      {
        ...hookPayload,
        email_data: {
          ...hookPayload.email_data,
          email_action_type: "signup",
        },
      },
      config
    )

    expect(payload).toMatchObject({
      subject: MAGIC_LINK_EMAIL_SUBJECT,
      tags: [{ name: "category", value: "auth_magic_link" }],
      to: ["person@example.com"],
    })
    expect(payload.html).toContain("Sign in to Mandala")
    expect(payload.html).toContain("type=signup")
  })

  it.each(["invite", "email_change", "reauthentication", "unknown"])(
    "fails closed for unsupported auth action type %s",
    (emailActionType) => {
      expect(() =>
        createResendEmailPayload(
          {
            ...hookPayload,
            email_data: {
              ...hookPayload.email_data,
              email_action_type: emailActionType,
            },
          },
          config
        )
      ).toThrow("Email hook payload is invalid")
    }
  )

  it("sends verified hook requests through the injected email provider", async () => {
    const signupHookPayload = {
      ...hookPayload,
      email_data: {
        ...hookPayload.email_data,
        email_action_type: "signup",
      },
    }
    const claimDelivery = vi.fn().mockResolvedValue(claim)
    const enqueueDelivery = vi.fn().mockResolvedValue(delivery)
    const recordDeliveryResult = vi.fn().mockResolvedValue(undefined)
    const sendEmail = vi
      .fn()
      .mockResolvedValue({ id: "resend-email-123", error: null })
    const verifyWebhook = vi.fn().mockReturnValue(signupHookPayload)
    const request = requestFor(signupHookPayload)

    const response = await handleSendAuthEmailRequest(request, {
      claimDelivery,
      enqueueDelivery,
      getEnv: (name) =>
        runtimeEnvironment[name as keyof typeof runtimeEnvironment],
      recordDeliveryResult,
      sendEmail,
      verifyWebhook,
    })

    expect(response.status).toBe(200)
    expect(verifyWebhook).toHaveBeenCalledWith(
      JSON.stringify(signupHookPayload),
      expect.objectContaining({
        "webhook-id": "msg_123",
      }),
      "v1,whsec_secret"
    )
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "Mandala <auth@example.com>",
        html: expect.stringContaining("type=signup"),
        subject: MAGIC_LINK_EMAIL_SUBJECT,
        to: ["person@example.com"],
      }),
      expect.objectContaining({
        resendApiKey: "re_test",
      }),
      `mandala-delivery:${delivery.deliveryId}`
    )
    expect(enqueueDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientEmail: "person@example.com",
        templateKey: "auth_magic_link",
        userId: "71000000-0000-4000-8000-000000000001",
        webhookId: "msg_123",
      })
    )
    expect(JSON.stringify(enqueueDelivery.mock.calls)).not.toContain(
      "token-hash"
    )
    expect(recordDeliveryResult).toHaveBeenCalledWith(
      claim,
      {
        outcome: "sent",
        providerEmailId: "resend-email-123",
      },
      expect.objectContaining({
        serviceRoleKey: "service-role-test",
      })
    )
  })

  it("deduplicates a replay before provider send", async () => {
    const claimDelivery = vi.fn()
    const sendEmail = vi.fn()
    const response = await handleSendAuthEmailRequest(requestFor(), {
      claimDelivery,
      enqueueDelivery: vi.fn().mockResolvedValue({
        ...delivery,
        state: "sent",
      }),
      getEnv: (name) =>
        runtimeEnvironment[name as keyof typeof runtimeEnvironment],
      recordDeliveryResult: vi.fn(),
      sendEmail,
      verifyWebhook: vi.fn().mockReturnValue(hookPayload),
    })

    expect(response.status).toBe(200)
    expect(claimDelivery).not.toHaveBeenCalled()
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it("records a transient attempt before one bounded retry", async () => {
    const secondClaim = {
      ...claim,
      attempt_number: 2,
      claim_token: "74000000-0000-4000-8000-000000000002",
    }
    const recordDeliveryResult = vi.fn().mockResolvedValue(undefined)
    const sleep = vi.fn().mockResolvedValue(undefined)
    const sendEmail = vi
      .fn()
      .mockResolvedValueOnce({
        error: { name: "rate_limit_exceeded", statusCode: 429 },
      })
      .mockResolvedValueOnce({ id: "resend-email-123", error: null })

    const response = await handleSendAuthEmailRequest(requestFor(), {
      claimDelivery: vi
        .fn()
        .mockResolvedValueOnce(claim)
        .mockResolvedValueOnce(secondClaim),
      enqueueDelivery: vi.fn().mockResolvedValue(delivery),
      getEnv: (name) =>
        runtimeEnvironment[name as keyof typeof runtimeEnvironment],
      recordDeliveryResult,
      sendEmail,
      sleep,
      verifyWebhook: vi.fn().mockReturnValue(hookPayload),
    })

    expect(response.status).toBe(200)
    expect(recordDeliveryResult).toHaveBeenNthCalledWith(
      1,
      claim,
      {
        errorCategory: "transient_rate_limit_exceeded",
        outcome: "transient_failure",
      },
      expect.any(Object)
    )
    expect(recordDeliveryResult).toHaveBeenNthCalledWith(
      2,
      secondClaim,
      {
        outcome: "sent",
        providerEmailId: "resend-email-123",
      },
      expect.any(Object)
    )
    expect(sleep).toHaveBeenCalledWith(150)
  })

  it("turns the last transient attempt into a safe terminal failure", async () => {
    const claims = [1, 2, 3].map((attemptNumber) => ({
      ...claim,
      attempt_number: attemptNumber,
      claim_token: `74000000-0000-4000-8000-00000000000${attemptNumber}`,
    }))
    const recordDeliveryResult = vi.fn().mockResolvedValue(undefined)

    const response = await handleSendAuthEmailRequest(requestFor(), {
      claimDelivery: vi
        .fn()
        .mockResolvedValueOnce(claims[0])
        .mockResolvedValueOnce(claims[1])
        .mockResolvedValueOnce(claims[2]),
      enqueueDelivery: vi.fn().mockResolvedValue(delivery),
      getEnv: (name) =>
        runtimeEnvironment[name as keyof typeof runtimeEnvironment],
      recordDeliveryResult,
      sendEmail: vi.fn().mockResolvedValue({
        error: { code: "provider_timeout", status: 503 },
      }),
      sleep: vi.fn().mockResolvedValue(undefined),
      verifyWebhook: vi.fn().mockReturnValue(hookPayload),
    })

    expect(response.status).toBe(502)
    expect(recordDeliveryResult).toHaveBeenLastCalledWith(
      claims[2],
      {
        errorCategory: "transient_exhausted_transient_provider_timeout",
        outcome: "permanent_failure",
      },
      expect.any(Object)
    )
  })

  it("fails closed when the hook signature is invalid", async () => {
    const sendEmail = vi.fn()
    const response = await handleSendAuthEmailRequest(
      new Request("https://example.com", {
        body: "{}",
        method: "POST",
      }),
      {
        claimDelivery: vi.fn(),
        enqueueDelivery: vi.fn(),
        getEnv: (name) =>
          runtimeEnvironment[name as keyof typeof runtimeEnvironment],
        recordDeliveryResult: vi.fn(),
        sendEmail,
        verifyWebhook: () => {
          throw new Error("bad signature")
        },
      }
    )

    expect(response.status).toBe(401)
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it("fails closed when required runtime config is missing", async () => {
    const response = await handleSendAuthEmailRequest(
      new Request("https://example.com", {
        body: "{}",
        method: "POST",
      }),
      {
        claimDelivery: vi.fn(),
        enqueueDelivery: vi.fn(),
        getEnv: () => undefined,
        recordDeliveryResult: vi.fn(),
        sendEmail: vi.fn(),
        verifyWebhook: vi.fn(),
      }
    )

    expect(response.status).toBe(500)
  })

  it("fails closed when the verified payload omits the auth user id", async () => {
    const invalidPayload = {
      ...hookPayload,
      user: { email: hookPayload.user.email },
    }
    const enqueueDelivery = vi.fn()
    const response = await handleSendAuthEmailRequest(
      requestFor(invalidPayload),
      {
        claimDelivery: vi.fn(),
        enqueueDelivery,
        getEnv: (name) =>
          runtimeEnvironment[name as keyof typeof runtimeEnvironment],
        recordDeliveryResult: vi.fn(),
        sendEmail: vi.fn(),
        verifyWebhook: vi.fn().mockReturnValue(invalidPayload),
      }
    )

    expect(response.status).toBe(400)
    expect(enqueueDelivery).not.toHaveBeenCalled()
  })

  it("does not bypass a delivery-ledger outage", async () => {
    const sendEmail = vi.fn()
    const response = await handleSendAuthEmailRequest(requestFor(), {
      claimDelivery: vi.fn(),
      enqueueDelivery: vi.fn().mockRejectedValue(new Error("database down")),
      getEnv: (name) =>
        runtimeEnvironment[name as keyof typeof runtimeEnvironment],
      recordDeliveryResult: vi.fn(),
      sendEmail,
      verifyWebhook: vi.fn().mockReturnValue(hookPayload),
    })

    expect(response.status).toBe(503)
    expect(sendEmail).not.toHaveBeenCalled()
  })
})
