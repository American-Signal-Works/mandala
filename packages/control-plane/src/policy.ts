import { z } from "zod"
import {
  authorizeCompanyRole,
  companyPermissionSchema,
  type CompanyPermission,
} from "./authorization.js"
import { companyRoleSchema, identifierSchema } from "./schemas.js"

export const principalTypeSchema = z.enum([
  "user",
  "agent",
  "system",
  "integration",
])
export const principalStateSchema = z.enum(["active", "disabled"])
export const policyExecutionModeSchema = z.enum([
  "mock",
  "dry_run",
  "shadow",
  "live",
])

export const companyPrincipalSchema = z
  .object({
    id: z.string().uuid(),
    companyId: z.string().uuid(),
    type: principalTypeSchema,
    state: principalStateSchema,
    role: companyRoleSchema.nullable(),
    capabilities: z.array(companyPermissionSchema).max(50),
    delegatedByUserId: z.string().uuid().nullable(),
  })
  .strict()
  .superRefine((principal, context) => {
    if (principal.type === "user" && principal.role === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "User principals require a company role.",
        path: ["role"],
      })
    }
    if (principal.type !== "user" && principal.role !== null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Non-user principals use capabilities instead of roles.",
        path: ["role"],
      })
    }
    if (principal.type === "user" && principal.capabilities.length > 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "User principals derive permissions from their company role.",
        path: ["capabilities"],
      })
    }
    if (
      new Set(principal.capabilities).size !== principal.capabilities.length
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Principal capabilities must be unique.",
        path: ["capabilities"],
      })
    }
  })

export const policyApprovalContextSchema = z
  .object({
    required: z.boolean(),
    status: z.enum(["not_required", "pending", "approved", "rejected"]),
    warningsPresent: z.boolean(),
    warningsAcknowledged: z.boolean(),
  })
  .strict()

export const companyPolicyEvaluationRequestSchema = z
  .object({
    policyVersion: identifierSchema,
    principal: companyPrincipalSchema,
    permission: companyPermissionSchema,
    mode: policyExecutionModeSchema,
    approval: policyApprovalContextSchema,
  })
  .strict()

export const companyPolicyReasonSchema = z.enum([
  "policy_satisfied",
  "principal_inactive",
  "permission_missing",
  "human_principal_required",
  "execution_mode_disabled",
  "approval_rejected",
  "human_approval_required",
  "warning_acknowledgement_required",
])

export const companyPolicyDecisionSchema = z
  .object({
    effect: z.enum(["allow", "deny", "requires_approval"]),
    reason: companyPolicyReasonSchema,
    policyVersion: identifierSchema,
    companyId: z.string().uuid(),
    principalId: z.string().uuid(),
    principalType: principalTypeSchema,
    permission: companyPermissionSchema,
    mode: policyExecutionModeSchema,
  })
  .strict()

export type PrincipalType = z.infer<typeof principalTypeSchema>
export type CompanyPrincipal = z.infer<typeof companyPrincipalSchema>
export type PolicyExecutionMode = z.infer<typeof policyExecutionModeSchema>
export type PolicyApprovalContext = z.infer<typeof policyApprovalContextSchema>
export type CompanyPolicyEvaluationRequest = z.infer<
  typeof companyPolicyEvaluationRequestSchema
>
export type CompanyPolicyDecision = z.infer<typeof companyPolicyDecisionSchema>

const humanOnlyPermissions = new Set<CompanyPermission>([
  "workflow.decision.approve",
  "workflow.decision.edit",
  "workflow.decision.reject",
  "workflow.decision.request_rework",
  "workflow.execution_token.issue",
])

export function evaluateCompanyPolicy(
  input: CompanyPolicyEvaluationRequest
): CompanyPolicyDecision {
  const request = companyPolicyEvaluationRequestSchema.parse(input)
  const base = {
    policyVersion: request.policyVersion,
    companyId: request.principal.companyId,
    principalId: request.principal.id,
    principalType: request.principal.type,
    permission: request.permission,
    mode: request.mode,
  }

  if (request.principal.state !== "active") {
    return { ...base, effect: "deny", reason: "principal_inactive" }
  }

  if (!principalHasPermission(request.principal, request.permission)) {
    return { ...base, effect: "deny", reason: "permission_missing" }
  }

  if (
    request.principal.type !== "user" &&
    humanOnlyPermissions.has(request.permission)
  ) {
    return { ...base, effect: "deny", reason: "human_principal_required" }
  }

  if (request.mode !== "mock") {
    return { ...base, effect: "deny", reason: "execution_mode_disabled" }
  }

  if (request.approval.status === "rejected") {
    return { ...base, effect: "deny", reason: "approval_rejected" }
  }

  // Required approvals cannot be trusted until persistence supplies verified evidence.
  if (request.approval.required) {
    return {
      ...base,
      effect: "requires_approval",
      reason: "human_approval_required",
    }
  }

  if (
    request.approval.warningsPresent &&
    !request.approval.warningsAcknowledged
  ) {
    return {
      ...base,
      effect: "requires_approval",
      reason: "warning_acknowledgement_required",
    }
  }

  return { ...base, effect: "allow", reason: "policy_satisfied" }
}

function principalHasPermission(
  principal: CompanyPrincipal,
  permission: CompanyPermission
): boolean {
  if (principal.type === "user") {
    if (principal.role === null) return false
    return authorizeCompanyRole(principal.role, permission).effect === "allow"
  }
  return principal.capabilities.includes(permission)
}
