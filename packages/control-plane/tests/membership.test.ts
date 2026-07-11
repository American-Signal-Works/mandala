import { describe, expect, it } from "vitest"
import {
  evaluateMembershipTransition,
  membershipTransitionCommandSchema,
  membershipTransitionRequestSchema,
  membershipTransitionResponseSchema,
  membershipTransitionResultSchema,
  type MembershipTransitionRequest,
} from "../src/index.js"

const companyId = "20000000-0000-4000-8000-000000000001"
const actorUserId = "10000000-0000-4000-8000-000000000001"
const targetUserId = "10000000-0000-4000-8000-000000000002"

describe("membership lifecycle", () => {
  it("allows owners to invite and re-invite fixed roles", () => {
    expect(
      evaluateMembershipTransition(
        request({
          currentStatus: null,
          targetRole: null,
          action: "invite",
          requestedRole: "member",
        })
      )
    ).toMatchObject({
      effect: "allow",
      reason: "transition_allowed",
      nextStatus: "invited",
      nextRole: "member",
    })

    expect(
      evaluateMembershipTransition(
        request({
          currentStatus: "removed",
          action: "invite",
          requestedRole: "viewer",
        })
      )
    ).toMatchObject({
      effect: "allow",
      nextStatus: "invited",
      nextRole: "viewer",
    })
  })

  it.each([
    ["activate", "invited", "active"],
    ["activate", "disabled", "active"],
    ["disable", "active", "disabled"],
    ["remove", "active", "removed"],
    ["remove", "invited", "removed"],
  ] as const)(
    "allows an owner to %s a %s membership",
    (action, currentStatus, nextStatus) => {
      expect(
        evaluateMembershipTransition(request({ action, currentStatus }))
      ).toMatchObject({
        effect: "allow",
        nextStatus,
        nextRole: "member",
      })
    }
  )

  it("allows users to leave only their own active membership", () => {
    expect(
      evaluateMembershipTransition(
        request({
          actorRole: "viewer",
          actorUserId: targetUserId,
          action: "leave",
        })
      )
    ).toMatchObject({ effect: "allow", nextStatus: "disabled" })

    expect(
      evaluateMembershipTransition(
        request({ actorRole: "viewer", action: "leave" })
      )
    ).toMatchObject({ effect: "deny", reason: "self_leave_only" })
  })

  it("requires management permission for administrative transitions", () => {
    expect(
      evaluateMembershipTransition(
        request({ actorRole: "member", action: "disable" })
      )
    ).toMatchObject({
      effect: "deny",
      reason: "management_permission_required",
    })
  })

  it("requires an owner to manage or assign owner memberships", () => {
    expect(
      evaluateMembershipTransition(
        request({
          actorRole: "admin",
          targetRole: "owner",
          action: "disable",
        })
      )
    ).toMatchObject({ effect: "deny", reason: "owner_permission_required" })

    expect(
      evaluateMembershipTransition(
        request({
          actorRole: "admin",
          action: "change_role",
          requestedRole: "owner",
        })
      )
    ).toMatchObject({ effect: "deny", reason: "owner_permission_required" })
  })

  it.each(["disable", "remove", "leave"] as const)(
    "requires a locked database check before an active owner can %s",
    (action) => {
      expect(
        evaluateMembershipTransition(
          request({
            actorUserId: targetUserId,
            targetRole: "owner",
            action,
          })
        )
      ).toMatchObject({
        effect: "requires_database_check",
        reason: "locked_owner_check_required",
      })
    }
  )

  it("requires a locked database check before an active owner is demoted", () => {
    expect(
      evaluateMembershipTransition(
        request({
          targetRole: "owner",
          action: "change_role",
          requestedRole: "admin",
        })
      )
    ).toMatchObject({
      effect: "requires_database_check",
      reason: "locked_owner_check_required",
    })
  })

  it("rejects invalid transitions and missing requested roles", () => {
    expect(
      evaluateMembershipTransition(
        request({ currentStatus: "active", action: "activate" })
      )
    ).toMatchObject({ effect: "deny", reason: "invalid_transition" })
    expect(
      evaluateMembershipTransition(
        request({ action: "change_role", requestedRole: null })
      )
    ).toMatchObject({ effect: "deny", reason: "requested_role_required" })
  })

  it("returns strict, serializable transition decisions", () => {
    const result = evaluateMembershipTransition(
      request({ action: "change_role", requestedRole: "viewer" })
    )
    expect(membershipTransitionResultSchema.safeParse(result).success).toBe(
      true
    )
    expect(membershipTransitionRequestSchema.safeParse(request()).success).toBe(
      true
    )
    expect(
      membershipTransitionRequestSchema.safeParse(
        request({ currentStatus: null, targetRole: "member" })
      ).success
    ).toBe(false)
  })

  it("validates public transition commands without trusting actor state", () => {
    expect(
      membershipTransitionCommandSchema.safeParse({
        companyId,
        targetUserId,
        action: "invite",
        requestedRole: "viewer",
      }).success
    ).toBe(true)
    expect(
      membershipTransitionCommandSchema.safeParse({
        companyId,
        targetUserId,
        action: "change_role",
      }).success
    ).toBe(false)
    expect(
      membershipTransitionCommandSchema.safeParse({
        companyId,
        targetUserId,
        actorRole: "owner",
        action: "disable",
      }).success
    ).toBe(false)
  })

  it("validates persisted transition responses", () => {
    expect(
      membershipTransitionResponseSchema.safeParse({
        membershipId: "30000000-0000-4000-8000-000000000001",
        companyId,
        userId: targetUserId,
        status: "active",
        role: "member",
        action: "activate",
      }).success
    ).toBe(true)
    expect(
      membershipTransitionResponseSchema.safeParse({
        membershipId: "30000000-0000-4000-8000-000000000001",
        companyId,
        userId: targetUserId,
        status: "active",
        role: "member",
        action: "activate",
        actorRole: "owner",
      }).success
    ).toBe(false)
  })
})

function request(
  overrides: Partial<MembershipTransitionRequest> = {}
): MembershipTransitionRequest {
  return {
    companyId,
    actorUserId,
    actorRole: "owner",
    targetUserId,
    targetRole: "member",
    currentStatus: "active",
    action: "change_role",
    requestedRole: "approver",
    ...overrides,
  }
}
