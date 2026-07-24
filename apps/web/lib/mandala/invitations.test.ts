// @vitest-environment node

import { describe, expect, it, vi } from "vitest"
import {
  CompanyInvitationError,
  inspectCompanyInvitation,
  issueCompanyInvitation,
  listCompanyDirectory,
  resendCompanyInvitation,
  revokeCompanyInvitation,
} from "./invitations"

const companyId = "b2000000-0000-4000-8000-000000000001"
const invitationId = "b3000000-0000-4000-8000-000000000001"
const deliveryId = "b4000000-0000-4000-8000-000000000001"
const offsetIssuedAt = "2026-07-24T18:15:48.42729+00:00"
const offsetExpiresAt = "2026-07-27T18:15:48.372+00:00"

function invitationProjection(
  state: "pending" | "accepted" | "revoked" | "expired" = "pending"
) {
  return {
    invitationId,
    companyId,
    recipientEmail: "new-owner@example.test",
    state,
    version: 1,
    issuedAt: offsetIssuedAt,
    expiresAt: offsetExpiresAt,
    deliveryId,
  }
}

describe("issueCompanyInvitation", () => {
  it("returns a committed invitation when PostgreSQL serializes timestamps with offsets", async () => {
    vi.stubEnv("INVITATION_TOKEN_SECRET", "a".repeat(32))
    const rpc = vi.fn().mockResolvedValue({
      data: invitationProjection(),
      error: null,
    })

    const invitation = await issueCompanyInvitation({
      supabase: { rpc } as never,
      companyId,
      recipientEmail: "new-owner@example.test",
    })

    expect(invitation).toMatchObject({
      recipientEmail: "new-owner@example.test",
      state: "pending",
      deliveryId,
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
        companyId,
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
  it("returns the committed invitation with PostgreSQL offset timestamps", async () => {
    vi.stubEnv("INVITATION_TOKEN_SECRET", "a".repeat(32))
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: 2, error: null })
      .mockResolvedValueOnce({
        data: { ...invitationProjection(), version: 2 },
        error: null,
      })

    await expect(
      resendCompanyInvitation({
        supabase: { rpc } as never,
        invitationId,
      })
    ).resolves.toMatchObject({
      invitationId,
      version: 2,
      issuedAt: offsetIssuedAt,
    })
  })

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

describe("revokeCompanyInvitation", () => {
  it("returns the committed revoke result with PostgreSQL offset timestamps", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: invitationProjection("revoked"),
      error: null,
    })

    await expect(
      revokeCompanyInvitation({
        supabase: { rpc } as never,
        invitationId,
      })
    ).resolves.toMatchObject({
      invitationId,
      state: "revoked",
      expiresAt: offsetExpiresAt,
    })
  })
})

describe("inspectCompanyInvitation", () => {
  it.each([
    "valid",
    "used",
    "accepted",
    "superseded",
    "revoked",
    "expired",
  ] as const)("returns the safe %s classification with offsets", async (state) => {
    vi.stubEnv("INVITATION_TOKEN_SECRET", "a".repeat(32))
    const rpc = vi.fn().mockResolvedValue({
      data: {
        state,
        workspaceName: "Invitation Workspace",
        expiresAt: offsetExpiresAt,
      },
      error: null,
    })

    await expect(
      inspectCompanyInvitation({
        supabase: { rpc } as never,
        token: "a".repeat(64),
      })
    ).resolves.toEqual({
      state,
      workspaceName: "Invitation Workspace",
      expiresAt: offsetExpiresAt,
    })
  })

  it("returns missing without recipient details and rejects malformed projections", async () => {
    vi.stubEnv("INVITATION_TOKEN_SECRET", "a".repeat(32))
    const missingRpc = vi.fn().mockResolvedValue({
      data: { state: "missing" },
      error: null,
    })

    await expect(
      inspectCompanyInvitation({
        supabase: { rpc: missingRpc } as never,
        token: "a".repeat(64),
      })
    ).resolves.toEqual({ state: "missing" })

    const malformedRpc = vi.fn().mockResolvedValue({
      data: {
        state: "missing",
        recipientEmail: "private@example.test",
      },
      error: null,
    })
    await expect(
      inspectCompanyInvitation({
        supabase: { rpc: malformedRpc } as never,
        token: "b".repeat(64),
      })
    ).rejects.toThrow()
  })
})

describe("listCompanyDirectory", () => {
  const directory = {
    members: [
      {
        membershipId: "b5000000-0000-4000-8000-000000000001",
        userId: "b1000000-0000-4000-8000-000000000001",
        email: "active@example.test",
        displayName: "Active Member",
        role: "owner",
        status: "active",
        joinedAt: offsetIssuedAt,
        updatedAt: offsetExpiresAt,
      },
      {
        membershipId: "b5000000-0000-4000-8000-000000000002",
        userId: "b1000000-0000-4000-8000-000000000002",
        email: "inactive@example.test",
        displayName: null,
        role: "viewer",
        status: "inactive",
        joinedAt: offsetIssuedAt,
        updatedAt: offsetExpiresAt,
      },
    ],
    pendingInvitations: [
      {
        invitationId,
        recipientEmail: "pending@example.test",
        state: "pending",
        issuedAt: offsetIssuedAt,
        expiresAt: offsetExpiresAt,
        deliveryId,
      },
    ],
  } as const

  it("returns active, inactive, and pending records with PostgreSQL offsets", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: directory, error: null })
    await expect(
      listCompanyDirectory({
        supabase: { rpc } as never,
        companyId,
      })
    ).resolves.toEqual(directory)
  })

  it("preserves forbidden access and fails safely on malformed output", async () => {
    const forbiddenRpc = vi.fn().mockResolvedValue({
      data: null,
      error: { code: "42501", message: "invitation_forbidden" },
    })
    await expect(
      listCompanyDirectory({
        supabase: { rpc: forbiddenRpc } as never,
        companyId,
      })
    ).rejects.toEqual(
      expect.objectContaining<Partial<CompanyInvitationError>>({
        code: "invitation_forbidden",
        providerCode: "42501",
      })
    )

    const malformedRpc = vi.fn().mockResolvedValue({
      data: {
        ...directory,
        members: [{ ...directory.members[0], joinedAt: "not-a-timestamp" }],
      },
      error: null,
    })
    await expect(
      listCompanyDirectory({
        supabase: { rpc: malformedRpc } as never,
        companyId,
      })
    ).rejects.toThrow()
  })
})
