import { describe, expect, it } from "vitest"
import {
  authorizeCompanyRole,
  companyAuthorizationResultSchema,
  companyPermissionSchema,
  hasCompanyPermission,
  permissionForWorkflowDecision,
  permissionsForCompanyRole,
  type CompanyPermission,
  type CompanyRole,
} from "../src/index.js"

const allPermissions = companyPermissionSchema.options

describe("company authorization", () => {
  it.each(["owner", "admin"] as const)(
    "grants every fixed permission to %s",
    (role) => {
      expect(permissionsForCompanyRole(role)).toEqual(allPermissions)
    }
  )

  it("grants approvers review and mock-execution permissions without management", () => {
    expectAllowed("approver", [
      "company.context.read",
      "policy.read",
      "workflow.read",
      "workflow.run",
      "workflow.decision.approve",
      "workflow.decision.edit",
      "workflow.decision.reject",
      "workflow.decision.request_rework",
      "workflow.execution_token.issue",
      "workflow.execution.mock",
    ])
    expectDenied("approver", [
      "membership.manage",
      "policy.manage",
      "workflow.fixture.run",
    ])
  })

  it("keeps members operational but unable to review or execute approved work", () => {
    expectAllowed("member", [
      "company.context.read",
      "policy.read",
      "workflow.read",
      "workflow.run",
    ])
    expectDenied("member", [
      "workflow.decision.approve",
      "workflow.decision.edit",
      "workflow.decision.reject",
      "workflow.decision.request_rework",
      "workflow.execution_token.issue",
      "workflow.execution.mock",
      "workflow.fixture.run",
      "membership.manage",
      "policy.manage",
    ])
  })

  it("keeps viewers read-only and agent memberships inert", () => {
    expectAllowed("viewer", [
      "company.context.read",
      "policy.read",
      "workflow.read",
    ])
    expectDenied(
      "viewer",
      allPermissions.filter(
        (permission) =>
          !permissionsForCompanyRole("viewer").includes(permission)
      )
    )
    expect(permissionsForCompanyRole("agent")).toEqual([])
  })

  it("keeps fixture execution restricted to owner and admin roles", () => {
    expect(hasCompanyPermission("owner", "workflow.fixture.run")).toBe(true)
    expect(hasCompanyPermission("admin", "workflow.fixture.run")).toBe(true)
    expect(hasCompanyPermission("approver", "workflow.fixture.run")).toBe(false)
    expect(hasCompanyPermission("member", "workflow.fixture.run")).toBe(false)
  })

  it("returns stable structured allow and deny reasons", () => {
    expect(
      authorizeCompanyRole("approver", "workflow.decision.approve")
    ).toEqual({
      effect: "allow",
      reason: "role_permission_granted",
      role: "approver",
      permission: "workflow.decision.approve",
    })
    expect(authorizeCompanyRole("viewer", "workflow.run")).toEqual({
      effect: "deny",
      reason: "role_permission_missing",
      role: "viewer",
      permission: "workflow.run",
    })
    expect(
      companyAuthorizationResultSchema.safeParse(
        authorizeCompanyRole("viewer", "workflow.run")
      ).success
    ).toBe(true)
  })

  it.each([
    ["approve", "workflow.decision.approve"],
    ["edit", "workflow.decision.edit"],
    ["reject", "workflow.decision.reject"],
    ["request_rework", "workflow.decision.request_rework"],
    ["resolve", "workflow.decision.approve"],
  ] as const)("maps %s to its named permission", (decision, permission) => {
    expect(permissionForWorkflowDecision(decision)).toBe(permission)
  })

  it("returns defensive permission copies and rejects unknown permissions", () => {
    const permissions = permissionsForCompanyRole("owner")
    permissions.pop()
    expect(permissionsForCompanyRole("owner")).toEqual(allPermissions)
    expect(
      companyPermissionSchema.safeParse("workflow.delete_all").success
    ).toBe(false)
  })
})

function expectAllowed(role: CompanyRole, permissions: CompanyPermission[]) {
  for (const permission of permissions) {
    expect(hasCompanyPermission(role, permission)).toBe(true)
  }
}

function expectDenied(role: CompanyRole, permissions: CompanyPermission[]) {
  for (const permission of permissions) {
    expect(hasCompanyPermission(role, permission)).toBe(false)
  }
}
