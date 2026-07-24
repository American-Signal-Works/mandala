// @vitest-environment node

import { describe, expect, it, vi } from "vitest"
import {
  CompanyInvitationError,
  issueCompanyInvitation,
  resendCompanyInvitation,
} from "./invitations"

describe("issueCompanyInvitation", () => {
  it("returns a committed invitation when PostgreSQL serializes timestamps with offsets", async () => {
    vi.stubEnv("INVITATION_TOKEN_SECRET", "a".repeat(32))
    const rpc = vi.fn().mockResolvedValue({
      data: {
        invitationId: "b3000000-0000-4000-8000-000000000001",
        companyId: "b2000000-0000-4000-8000-000000000001",
        recipientEmail: "new-owner@example.test",
        state: "pending",
        version: 1,
        issuedAt: "2026-07-24T18:15:48.42729+00:00",
        expiresAt: "2026-07-27T18:15:48.372+00:00",
        deliveryId: "b4000000-0000-4000-8000-000000000001",
      },
      error: null,
    })

    const invitation = await issueCompanyInvitation({
      supabase: { rpc } as never,
      companyId: "b2000000-0000-4000-8000-000000000001",
      recipientEmail: "new-owner@example.test",
    })

    expect(invitation).toMatchObject({
      recipientEmail: "new-owner@example.test",
      state: "pending",
      deliveryId: "b4000000-0000-4000-8000-000000000001",
    })
  })

  it("preserves the safe duplicate-invitation error on retry", async () => {
    vi.stubEnv("INVITATION_TOKEN_SECRET", "a".repeat(32))
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { code: "23505", message: "active_invitation_exists" },
    })

    await expect(
      issueCompanyInvitation({
        supabase: { rpc } as never,
        companyId: "b2000000-0000-4000-8000-000000000001",
        recipientEmail: "new-owner@example.test",
      })
    ).rejects.toEqual(
      expect.objectContaining<Partial<CompanyInvitationError>>({
        code: "active_invitation_exists",
        providerCode: "23505",
      })
    )
  })
})

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
