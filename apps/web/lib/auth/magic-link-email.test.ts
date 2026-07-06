import { describe, expect, it, vi } from "vitest"

import {
  MANDALA_MAGIC_LINK_EMAIL_THEME,
  MAGIC_LINK_EMAIL_SUBJECT,
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
  supabaseUrl: "https://project.supabase.co",
}

const hookPayload = {
  user: {
    email: "person@example.com",
  },
  email_data: {
    email_action_type: "email",
    redirect_to:
      "https://usebackdesk.com/callback?next=%2Flogin%3Fauth%3Dsuccess",
    token_hash: "token-hash",
  },
}

describe("Mandala magic-link email", () => {
  it("builds the Supabase verification URL with the callback redirect", () => {
    expect(
      buildSupabaseVerifyUrl({
        emailActionType: "email",
        redirectTo:
          "https://usebackdesk.com/callback?next=%2Flogin%3Fauth%3Dsuccess",
        supabaseUrl: "https://project.supabase.co/",
        tokenHash: "token-hash",
      })
    ).toBe(
      "https://project.supabase.co/auth/v1/verify?token=token-hash&type=email&redirect_to=https%3A%2F%2Fusebackdesk.com%2Fcallback%3Fnext%3D%252Flogin%253Fauth%253Dsuccess"
    )
  })

  it("forces the Mandala sender display name", () => {
    expect(formatSender("auth@example.com")).toBe("Mandala <auth@example.com>")
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
      text: expect.stringContaining("After 5 minutes"),
      to: ["person@example.com"],
    })
    expect(payload.html).toContain("Here&rsquo;s your magic link")
    expect(payload.html).toContain("After 5 minutes")
    expect(payload.html).toContain("Sign in")
    expect(payload.html).toContain("&copy; American Signal Works")
    expect(payload.html).toContain("Sheridan, WY")
    expect(payload.html).toContain("token=token-hash")
    expect(payload.html).toContain('name="color-scheme" content="light dark"')
    expect(payload.html).toContain("@media (prefers-color-scheme: dark)")
    expect(payload.html).toContain("mandala-email-mark-light")
    expect(payload.html).toContain("mandala-email-mark-dark")
    expect(payload.html).toContain(
      `background:${MANDALA_MAGIC_LINK_EMAIL_THEME.light.shellBackground}`
    )
    expect(payload.html).toContain(
      `background: ${MANDALA_MAGIC_LINK_EMAIL_THEME.dark.shellBackground} !important`
    )
  })

  it("sends verified hook requests through the injected email provider", async () => {
    const sendEmail = vi.fn().mockResolvedValue({ error: null })
    const verifyWebhook = vi.fn().mockReturnValue(hookPayload)
    const request = new Request("https://example.com", {
      body: JSON.stringify(hookPayload),
      headers: {
        "webhook-id": "msg_123",
        "webhook-signature": "sig",
        "webhook-timestamp": "123",
      },
      method: "POST",
    })

    const response = await handleSendAuthEmailRequest(request, {
      getEnv: (name) =>
        ({
          RESEND_API_KEY: "re_test",
          RESEND_AUTH_EMAIL_FROM_ADDRESS: "auth@example.com",
          SEND_EMAIL_HOOK_SECRET: "v1,whsec_secret",
          SUPABASE_URL: "https://project.supabase.co",
        })[name],
      sendEmail,
      verifyWebhook,
    })

    expect(response.status).toBe(200)
    expect(verifyWebhook).toHaveBeenCalledWith(
      JSON.stringify(hookPayload),
      expect.objectContaining({
        "webhook-id": "msg_123",
      }),
      "v1,whsec_secret"
    )
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "Mandala <auth@example.com>",
        subject: "Sign in with magic link",
        to: ["person@example.com"],
      }),
      expect.objectContaining({
        resendApiKey: "re_test",
      })
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
        getEnv: (name) =>
          ({
            RESEND_API_KEY: "re_test",
            RESEND_AUTH_EMAIL_FROM_ADDRESS: "auth@example.com",
            SEND_EMAIL_HOOK_SECRET: "v1,whsec_secret",
            SUPABASE_URL: "https://project.supabase.co",
          })[name],
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
        getEnv: () => undefined,
        sendEmail: vi.fn(),
        verifyWebhook: vi.fn(),
      }
    )

    expect(response.status).toBe(500)
  })
})
