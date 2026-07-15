import { beforeEach, describe, expect, it, vi } from "vitest"
import { authorizeCompanyPermission } from "@/lib/mandala/authorization"
import {
  MembershipTransitionRpcError,
  transitionCompanyMembershipRpc,
} from "@/lib/mandala/memberships"
import { authenticateRequest } from "@/lib/supabase/request"
import { POST } from "./route"

vi.mock("@/lib/supabase/request", () => ({ authenticateRequest: vi.fn() }))
vi.mock("@/lib/mandala/authorization", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/lib/mandala/authorization")>()
  return { ...original, authorizeCompanyPermission: vi.fn() }
})
vi.mock("@/lib/mandala/memberships", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/lib/mandala/memberships")>()
  return { ...original, transitionCompanyMembershipRpc: vi.fn() }
})

const companyId = "20000000-0000-4000-8000-000000000001"
const actorUserId = "10000000-0000-4000-8000-000000000001"
const targetUserId = "10000000-0000-4000-8000-000000000002"
const membershipId = "30000000-0000-4000-8000-000000000001"
const auth = {
  authMode: "bearer",
  supabase: {},
  user: { id: actorUserId },
}

describe("membership transition route", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateRequest).mockResolvedValue(auth as never)
    vi.mocked(authorizeCompanyPermission).mockResolvedValue({
      effect: "allow",
      reason: "role_permission_granted",
      role: "owner",
      permission: "membership.manage",
    })
    vi.mocked(transitionCompanyMembershipRpc).mockResolvedValue({
      membershipId,
      companyId,
      userId: targetUserId,
      status: "invited",
      role: "viewer",
      action: "invite",
    })
  })

  it("preflights management permission and delegates to the database", async () => {
    const response = await POST(
      request({
        companyId,
        targetUserId,
        action: "invite",
        requestedRole: "viewer",
      })
    )

    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    expect(authorizeCompanyPermission).toHaveBeenCalledWith({
      supabase: auth.supabase,
      companyId,
      userId: actorUserId,
      permission: "membership.manage",
    })
    expect(transitionCompanyMembershipRpc).toHaveBeenCalledWith({
      supabase: auth.supabase,
      companyId,
      targetUserId,
      action: "invite",
      requestedRole: "viewer",
    })
    await expect(response.json()).resolves.toEqual({
      membershipId,
      companyId,
      userId: targetUserId,
      status: "invited",
      role: "viewer",
      action: "invite",
    })
  })

  it("allows a user to preflight leaving only their own membership", async () => {
    vi.mocked(authorizeCompanyPermission).mockResolvedValue({
      effect: "allow",
      reason: "role_permission_granted",
      role: "viewer",
      permission: "company.context.read",
    })
    vi.mocked(transitionCompanyMembershipRpc).mockResolvedValue({
      membershipId,
      companyId,
      userId: actorUserId,
      status: "disabled",
      role: "viewer",
      action: "leave",
    })

    const response = await POST(
      request({ companyId, targetUserId: actorUserId, action: "leave" })
    )

    expect(response.status).toBe(200)
    expect(authorizeCompanyPermission).toHaveBeenCalledWith({
      supabase: auth.supabase,
      companyId,
      userId: actorUserId,
      permission: "company.context.read",
    })
    expect(transitionCompanyMembershipRpc).toHaveBeenCalledOnce()
  })

  it("requires an owner for member removal", async () => {
    vi.mocked(authorizeCompanyPermission).mockResolvedValue({
      effect: "allow",
      reason: "role_permission_granted",
      role: "admin",
      permission: "membership.manage",
    })

    const response = await POST(
      request({ companyId, targetUserId, action: "remove" })
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: "forbidden" })
    expect(transitionCompanyMembershipRpc).not.toHaveBeenCalled()
  })

  it("rejects attempts to leave another user's membership before preflight", async () => {
    const response = await POST(
      request({ companyId, targetUserId, action: "leave" })
    )

    expect(response.status).toBe(403)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    await expect(response.json()).resolves.toEqual({ error: "forbidden" })
    expect(authorizeCompanyPermission).not.toHaveBeenCalled()
    expect(transitionCompanyMembershipRpc).not.toHaveBeenCalled()
  })

  it("requires authentication before parsing or executing a transition", async () => {
    vi.mocked(authenticateRequest).mockResolvedValue(null)

    const response = await POST(
      request({ companyId, targetUserId, action: "disable" })
    )

    expect(response.status).toBe(401)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    expect(authorizeCompanyPermission).not.toHaveBeenCalled()
    expect(transitionCompanyMembershipRpc).not.toHaveBeenCalled()
  })

  it("rejects invalid transition commands", async () => {
    const response = await POST(
      request({ companyId, targetUserId, action: "change_role" })
    )

    expect(response.status).toBe(400)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    await expect(response.json()).resolves.toMatchObject({
      error: "invalid_request",
    })
    expect(authorizeCompanyPermission).not.toHaveBeenCalled()
    expect(transitionCompanyMembershipRpc).not.toHaveBeenCalled()
  })

  it.each([
    ["forbidden", 403],
    ["membership_lookup_failed", 500],
  ] as const)(
    "returns a private %s preflight failure",
    async (code, status) => {
      vi.mocked(authorizeCompanyPermission).mockResolvedValue({
        effect: "deny",
        reason: code,
        permission: "membership.manage",
      })

      const response = await POST(
        request({ companyId, targetUserId, action: "disable" })
      )

      expect(response.status).toBe(status)
      expect(response.headers.get("cache-control")).toBe("private, no-store")
      await expect(response.json()).resolves.toEqual({ error: code })
      expect(transitionCompanyMembershipRpc).not.toHaveBeenCalled()
    }
  )

  it.each([
    ["42501", "forbidden", 403],
    ["22023", "invalid_membership_transition", 409],
    ["55000", "last_active_owner", 409],
    ["P0002", "not_found", 404],
  ] as const)(
    "maps database code %s to %s",
    async (databaseCode, code, status) => {
      vi.mocked(transitionCompanyMembershipRpc).mockRejectedValue(
        new MembershipTransitionRpcError(databaseCode)
      )

      const response = await POST(
        request({ companyId, targetUserId, action: "disable" })
      )

      expect(response.status).toBe(status)
      expect(response.headers.get("cache-control")).toBe("private, no-store")
      await expect(response.json()).resolves.toEqual({ error: code })
    }
  )

  it("returns a generic server error without provider details", async () => {
    vi.mocked(transitionCompanyMembershipRpc).mockRejectedValue(
      new Error("private provider detail")
    )

    const response = await POST(
      request({ companyId, targetUserId, action: "disable" })
    )
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    expect(body).toEqual({ error: "membership_transition_failed" })
    expect(JSON.stringify(body)).not.toContain("private provider detail")
  })
})

function request(body: unknown): Request {
  return new Request("http://localhost/api/mandala/memberships/transition", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost",
      authorization: "Bearer token",
    },
    body: JSON.stringify(body),
  })
}
