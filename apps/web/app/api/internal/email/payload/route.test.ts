import { beforeEach, describe, expect, it, vi } from "vitest"
import { createEmailPayloadAdminClient } from "@/actions/admin/email-payload"
import { POST } from "./route"

vi.mock("@/actions/admin/email-payload", () => ({
  createEmailPayloadAdminClient: vi.fn(),
}))

function query(data: unknown) {
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    maybeSingle: vi.fn().mockResolvedValue({ data, error: null }),
  }
  return builder
}

describe("email payload resolver authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv("EMAIL_PAYLOAD_RESOLVER_SECRET", "resolver-test-secret")
    vi.stubEnv("INVITATION_TOKEN_SECRET", "i".repeat(32))
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://mandala.example.test")
    vi.stubEnv("RESEND_AUTH_EMAIL_FROM_ADDRESS", "auth@example.test")
  })

  it("rejects requests without the private resolver credential", async () => {
    const response = await POST(
      new Request("http://localhost/api/internal/email/payload", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      })
    )
    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: "unauthorized" })
  })

  it("renders an authorized opaque invitation reference without returning its recipient", async () => {
    const invitationId = "b3000000-0000-4000-8000-000000000001"
    const companyId = "b2000000-0000-4000-8000-000000000001"
    const tables = {
      company_invitations: query({
        id: invitationId,
        company_id: companyId,
        recipient_email: "member@example.test",
        inviter_user_id: "b1000000-0000-4000-8000-000000000001",
        version: 1,
        state: "pending",
      }),
      companies: query({ name: "Example Workspace" }),
      profiles: query({ display_name: "Workspace Owner" }),
    }
    vi.mocked(createEmailPayloadAdminClient).mockReturnValue({
      from: vi.fn((table: keyof typeof tables) => tables[table]),
    } as never)

    const response = await POST(
      new Request("http://localhost/api/internal/email/payload", {
        method: "POST",
        headers: {
          authorization: "Bearer resolver-test-secret",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          companyId,
          templateKey: "workspace_invite",
          templateVersion: "1",
          payloadReference: `company_invitation:${invitationId}:1`,
        }),
      })
    )

    const body = await response.json()
    expect(response.status, JSON.stringify(body)).toBe(200)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    expect(body).not.toHaveProperty("to")
    expect(body.subject).toContain("Example Workspace")
    expect(body.html).toContain("/invitation?token=")
  })
})
