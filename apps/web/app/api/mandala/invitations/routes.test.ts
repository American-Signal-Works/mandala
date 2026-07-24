// @vitest-environment node

import { createClient } from "@supabase/supabase-js"
import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  CompanyInvitationError,
  inspectCompanyInvitation,
  listCompanyDirectory,
  resendCompanyInvitation,
  revokeCompanyInvitation,
} from "@/lib/mandala/invitations"
import { authenticateRequest } from "@/lib/supabase/request"
import { GET as getMembers } from "../members/route"
import { POST as inspectInvitation } from "./inspect/route"
import { POST as resendInvitation } from "./[invitationId]/resend/route"
import { POST as revokeInvitation } from "./[invitationId]/revoke/route"

vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn() }))
vi.mock("@/lib/supabase/request", () => ({ authenticateRequest: vi.fn() }))
vi.mock("@/lib/mandala/invitations", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/lib/mandala/invitations")>()
  return {
    ...original,
    inspectCompanyInvitation: vi.fn(),
    listCompanyDirectory: vi.fn(),
    resendCompanyInvitation: vi.fn(),
    revokeCompanyInvitation: vi.fn(),
  }
})

const companyId = "b2000000-0000-4000-8000-000000000001"
const otherCompanyId = "b2000000-0000-4000-8000-000000000002"
const invitationId = "b3000000-0000-4000-8000-000000000001"
const deliveryId = "b4000000-0000-4000-8000-000000000001"
const offsetIssuedAt = "2026-07-24T18:15:48.42729+00:00"
const offsetExpiresAt = "2026-07-27T18:15:48.372+00:00"
const supabase = {}

const invitation = {
  invitationId,
  companyId,
  recipientEmail: "new-owner@example.test",
  state: "pending" as const,
  version: 2,
  issuedAt: offsetIssuedAt,
  expiresAt: offsetExpiresAt,
  deliveryId,
}

const directory = {
  members: [
    {
      membershipId: "b5000000-0000-4000-8000-000000000001",
      userId: "b1000000-0000-4000-8000-000000000001",
      email: "active@example.test",
      displayName: "Active Member",
      role: "owner",
      status: "active" as const,
      joinedAt: offsetIssuedAt,
      updatedAt: offsetExpiresAt,
    },
    {
      membershipId: "b5000000-0000-4000-8000-000000000002",
      userId: "b1000000-0000-4000-8000-000000000002",
      email: "inactive@example.test",
      displayName: null,
      role: "viewer",
      status: "inactive" as const,
      joinedAt: offsetIssuedAt,
      updatedAt: offsetExpiresAt,
    },
  ],
  pendingInvitations: [
    {
      invitationId,
      recipientEmail: "pending@example.test",
      state: "pending" as const,
      issuedAt: offsetIssuedAt,
      expiresAt: offsetExpiresAt,
      deliveryId,
    },
  ],
}

describe("invitation inspection route", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co")
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key")
    vi.mocked(createClient).mockReturnValue(supabase as never)
  })

  it.each([
    "valid",
    "used",
    "accepted",
    "superseded",
    "revoked",
    "expired",
  ] as const)("returns the safe %s classification without recipient data", async (state) => {
    vi.mocked(inspectCompanyInvitation).mockResolvedValue({
      state,
      workspaceName: "Invitation Workspace",
      expiresAt: offsetExpiresAt,
    })

    const response = await inspectInvitation(
      new Request("http://localhost/api/mandala/invitations/inspect", {
        method: "POST",
        body: JSON.stringify({ token: "a".repeat(64) }),
      })
    )

    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    const body = await response.json()
    expect(body).toEqual({
      invitation: {
        state,
        workspaceName: "Invitation Workspace",
        expiresAt: offsetExpiresAt,
      },
    })
    expect(JSON.stringify(body)).not.toContain("recipient")
  })

  it("returns missing safely and does not leak malformed provider output", async () => {
    vi.mocked(inspectCompanyInvitation).mockResolvedValueOnce({
      state: "missing",
    })
    const missing = await inspectInvitation(
      new Request("http://localhost/api/mandala/invitations/inspect", {
        method: "POST",
        body: JSON.stringify({ token: "a".repeat(64) }),
      })
    )
    await expect(missing.json()).resolves.toEqual({
      invitation: { state: "missing" },
    })

    vi.mocked(inspectCompanyInvitation).mockRejectedValueOnce(
      new Error("malformed recipient private@example.test")
    )
    const malformed = await inspectInvitation(
      new Request("http://localhost/api/mandala/invitations/inspect", {
        method: "POST",
        body: JSON.stringify({ token: "b".repeat(64) }),
      })
    )
    expect(malformed.status).toBe(500)
    await expect(malformed.json()).resolves.toEqual({
      error: "invitation_failed",
    })
  })
})

describe("invitation mutation routes", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(authenticateRequest).mockResolvedValue({
      authMode: "cookie",
      supabase,
      user: { id: "b1000000-0000-4000-8000-000000000001" },
    } as never)
  })

  it("returns a committed resend with offset timestamps", async () => {
    vi.mocked(resendCompanyInvitation).mockResolvedValue(invitation)
    const response = await resendInvitation(
      new Request(
        `http://localhost/api/mandala/invitations/${invitationId}/resend`,
        { method: "POST" }
      ),
      { params: Promise.resolve({ invitationId }) }
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ invitation })
  })

  it("returns a committed revoke with offset timestamps", async () => {
    const revoked = { ...invitation, state: "revoked" as const }
    vi.mocked(revokeCompanyInvitation).mockResolvedValue(revoked)
    const response = await revokeInvitation(
      new Request(
        `http://localhost/api/mandala/invitations/${invitationId}/revoke`,
        { method: "POST" }
      ),
      { params: Promise.resolve({ invitationId }) }
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ invitation: revoked })
  })
})

describe("team directory route", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(authenticateRequest).mockResolvedValue({
      authMode: "cookie",
      supabase,
      user: { id: "b1000000-0000-4000-8000-000000000001" },
    } as never)
  })

  it("returns active, pending, and inactive records with offset timestamps", async () => {
    vi.mocked(listCompanyDirectory).mockResolvedValue(directory)
    const response = await getMembers(
      new Request(
        `http://localhost/api/mandala/members?companyId=${companyId}`
      )
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ directory })
  })

  it.each([
    ["outsider", companyId],
    ["cross-workspace member", otherCompanyId],
  ])("keeps %s access forbidden", async (_, requestedCompanyId) => {
    vi.mocked(listCompanyDirectory).mockRejectedValue(
      new CompanyInvitationError("invitation_forbidden", "42501")
    )
    const response = await getMembers(
      new Request(
        `http://localhost/api/mandala/members?companyId=${requestedCompanyId}`
      )
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error: "invitation_forbidden",
    })
  })

  it("fails closed without leaking malformed directory output", async () => {
    vi.mocked(listCompanyDirectory).mockRejectedValue(
      new Error("malformed member private@example.test")
    )
    const response = await getMembers(
      new Request(
        `http://localhost/api/mandala/members?companyId=${companyId}`
      )
    )

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      error: "invitation_failed",
    })
  })
})
