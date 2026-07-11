import { describe, expect, it, vi } from "vitest"
import {
  classifyMembershipTransitionError,
  MembershipTransitionRpcError,
  transitionCompanyMembershipRpc,
} from "./memberships"

const companyId = "20000000-0000-4000-8000-000000000001"
const targetUserId = "10000000-0000-4000-8000-000000000002"
const membershipId = "30000000-0000-4000-8000-000000000001"

describe("membership persistence", () => {
  it("calls the typed transition RPC and validates its response", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        membershipId,
        companyId,
        userId: targetUserId,
        status: "invited",
        role: "viewer",
        action: "invite",
      },
      error: null,
    })

    await expect(
      transitionCompanyMembershipRpc({
        supabase: { rpc } as never,
        companyId,
        targetUserId,
        action: "invite",
        requestedRole: "viewer",
      })
    ).resolves.toEqual({
      membershipId,
      companyId,
      userId: targetUserId,
      status: "invited",
      role: "viewer",
      action: "invite",
    })
    expect(rpc).toHaveBeenCalledWith("transition_company_membership", {
      p_company_id: companyId,
      p_target_user_id: targetUserId,
      p_action: "invite",
      p_requested_role: "viewer",
    })
  })

  it("does not send an absent requested role", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        membershipId,
        companyId,
        userId: targetUserId,
        status: "active",
        role: "member",
        action: "activate",
      },
      error: null,
    })

    await transitionCompanyMembershipRpc({
      supabase: { rpc } as never,
      companyId,
      targetUserId,
      action: "activate",
    })

    expect(rpc).toHaveBeenCalledWith("transition_company_membership", {
      p_company_id: companyId,
      p_target_user_id: targetUserId,
      p_action: "activate",
    })
  })

  it("retains only the stable database code from provider errors", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { code: "42501", message: "private provider detail" },
    })

    const error = await transitionCompanyMembershipRpc({
      supabase: { rpc } as never,
      companyId,
      targetUserId,
      action: "disable",
    }).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(MembershipTransitionRpcError)
    expect(error).toMatchObject({ databaseCode: "42501" })
    expect(JSON.stringify(error)).not.toContain("private provider detail")
  })

  it.each([
    ["42501", "forbidden", 403],
    ["22023", "invalid_membership_transition", 409],
    ["55000", "last_active_owner", 409],
    ["P0002", "not_found", 404],
  ] as const)("maps database code %s", (databaseCode, code, status) => {
    expect(
      classifyMembershipTransitionError(
        new MembershipTransitionRpcError(databaseCode)
      )
    ).toEqual({ code, status })
  })

  it("maps unknown failures without leaking their messages", () => {
    const result = classifyMembershipTransitionError(
      new Error("private provider detail")
    )

    expect(result).toEqual({
      code: "membership_transition_failed",
      status: 500,
    })
    expect(JSON.stringify(result)).not.toContain("private provider detail")
  })
})
