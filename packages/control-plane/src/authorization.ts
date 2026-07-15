import { z } from "zod"
import {
  companyRoleSchema,
  type CompanyRole,
  type DecisionKind,
} from "./schemas.js"

export const companyPermissionSchema = z.enum([
  "company.context.read",
  "membership.manage",
  "policy.read",
  "policy.manage",
  "workflow.read",
  "workflow.run",
  "workflow.fixture.run",
  "workflow.decision.approve",
  "workflow.decision.edit",
  "workflow.decision.reject",
  "workflow.decision.request_rework",
  "workflow.execution_token.issue",
  "workflow.execution.mock",
])

export const companyAuthorizationResultSchema = z
  .object({
    effect: z.enum(["allow", "deny"]),
    reason: z.enum(["role_permission_granted", "role_permission_missing"]),
    role: companyRoleSchema,
    permission: companyPermissionSchema,
  })
  .strict()

export type CompanyPermission = z.infer<typeof companyPermissionSchema>
export type CompanyAuthorizationResult = z.infer<
  typeof companyAuthorizationResultSchema
>

const allPermissions = companyPermissionSchema.options
const readPermissions = [
  "company.context.read",
  "policy.read",
  "workflow.read",
] as const satisfies readonly CompanyPermission[]
const memberPermissions = [
  ...readPermissions,
  "workflow.run",
] as const satisfies readonly CompanyPermission[]
const approverPermissions = [
  ...memberPermissions,
  "workflow.decision.approve",
  "workflow.decision.edit",
  "workflow.decision.reject",
  "workflow.decision.request_rework",
  "workflow.execution_token.issue",
  "workflow.execution.mock",
] as const satisfies readonly CompanyPermission[]

const permissionsByRole = {
  owner: allPermissions,
  admin: allPermissions,
  approver: approverPermissions,
  member: memberPermissions,
  viewer: readPermissions,
  agent: [],
} as const satisfies Record<CompanyRole, readonly CompanyPermission[]>

export function permissionsForCompanyRole(
  role: CompanyRole
): CompanyPermission[] {
  return [...permissionsByRole[role]]
}

export function authorizeCompanyRole(
  role: CompanyRole,
  permission: CompanyPermission
): CompanyAuthorizationResult {
  const allowed = permissionsByRole[role].some(
    (candidate) => candidate === permission
  )
  return {
    effect: allowed ? "allow" : "deny",
    reason: allowed ? "role_permission_granted" : "role_permission_missing",
    role,
    permission,
  }
}

export function hasCompanyPermission(
  role: CompanyRole,
  permission: CompanyPermission
): boolean {
  return authorizeCompanyRole(role, permission).effect === "allow"
}

export function permissionForWorkflowDecision(
  decision: DecisionKind
): CompanyPermission {
  switch (decision) {
    case "approve":
      return "workflow.decision.approve"
    case "edit":
      return "workflow.decision.edit"
    case "reject":
      return "workflow.decision.reject"
    case "request_rework":
      return "workflow.decision.request_rework"
    case "resolve":
      return "workflow.decision.approve"
  }
}
