// @vitest-environment node

import { describe, expect, it, vi } from "vitest"
import { resendCompanyInvitation } from "./invitations"

describe("resendCompanyInvitation", () => {
  it("re-reads the version when a concurrent resend wins the first race", async () => {
    vi.stubEnv("INVITATION_TOKEN_SECRET", "a".repeat(32))
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: 2, error: null })
      .mockResolvedValueOnce({
        data: null,
        error: { code: "40001", message: "invitation_version_conflict" },
      })
      .mockResolvedValueOnce({ data: 3, error: null })
      .mockResolvedValueOnce({
        data: {
          invitationId: "b3000000-0000-4000-8000-000000000002",
          companyId: "b2000000-0000-4000-8000-000000000001",
          recipientEmail: "member@example.test",
          state: "pending",
          version: 3,
          issuedAt: "2026-07-15T16:00:00.000Z",
          expiresAt: "2026-07-18T16:00:00.000Z",
          deliveryId: null,
        },
        error: null,
      })

    const invitation = await resendCompanyInvitation({
      supabase: { rpc } as never,
      invitationId: "b3000000-0000-4000-8000-000000000002",
    })

    expect(invitation.version).toBe(3)
    expect(rpc).toHaveBeenNthCalledWith(
      4,
      "resend_company_invitation",
      expect.objectContaining({ p_expected_version: 3 })
    )
  })
})
