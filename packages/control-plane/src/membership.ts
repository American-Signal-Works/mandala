import { z } from "zod"
import { hasCompanyPermission } from "./authorization.js"
import { companyRoleSchema } from "./schemas.js"

export const membershipStatusSchema = z.enum([
  "invited",
  "active",
  "disabled",
  "removed",
])
export const membershipActionSchema = z.enum([
  "invite",
  "activate",
  "disable",
  "remove",
  "change_role",
  "leave",
])

export const membershipTransitionRequestSchema = z
  .object({
    companyId: z.string().uuid(),
    actorUserId: z.string().uuid(),
    actorRole: companyRoleSchema,
    targetUserId: z.string().uuid(),
    targetRole: companyRoleSchema.nullable(),
    currentStatus: membershipStatusSchema.nullable(),
    action: membershipActionSchema,
    requestedRole: companyRoleSchema.nullable(),
  })
  .strict()
  .superRefine((request, context) => {
    if ((request.currentStatus === null) !== (request.targetRole === null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Existing memberships require a current role.",
        path: ["targetRole"],
      })
    }
  })

export const membershipTransitionCommandSchema = z
  .object({
    companyId: z.string().uuid(),
    targetUserId: z.string().uuid(),
    action: membershipActionSchema,
    requestedRole: companyRoleSchema.nullable().optional(),
  })
  .strict()
  .superRefine((command, context) => {
    if (
      (command.action === "invite" || command.action === "change_role") &&
      !command.requestedRole
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "This action requires a requested role.",
        path: ["requestedRole"],
      })
    }
  })

export const membershipTransitionResponseSchema = z
  .object({
    membershipId: z.string().uuid(),
    companyId: z.string().uuid(),
    userId: z.string().uuid(),
    status: membershipStatusSchema,
    role: companyRoleSchema,
    action: membershipActionSchema,
  })
  .strict()

export const membershipTransitionReasonSchema = z.enum([
  "transition_allowed",
  "management_permission_required",
  "owner_permission_required",
  "self_leave_only",
  "locked_owner_check_required",
  "requested_role_required",
  "invalid_transition",
])

export const membershipTransitionResultSchema = z
  .object({
    effect: z.enum(["allow", "deny", "requires_database_check"]),
    reason: membershipTransitionReasonSchema,
    companyId: z.string().uuid(),
    action: membershipActionSchema,
    nextStatus: membershipStatusSchema.nullable(),
    nextRole: companyRoleSchema.nullable(),
  })
  .strict()

export type MembershipStatus = z.infer<typeof membershipStatusSchema>
export type MembershipAction = z.infer<typeof membershipActionSchema>
export type MembershipTransitionRequest = z.infer<
  typeof membershipTransitionRequestSchema
>
export type MembershipTransitionCommand = z.infer<
  typeof membershipTransitionCommandSchema
>
export type MembershipTransitionResponse = z.infer<
  typeof membershipTransitionResponseSchema
>
export type MembershipTransitionResult = z.infer<
  typeof membershipTransitionResultSchema
>

export function evaluateMembershipTransition(
  input: MembershipTransitionRequest
): MembershipTransitionResult {
  const request = membershipTransitionRequestSchema.parse(input)

  if (request.action === "leave") {
    if (request.actorUserId !== request.targetUserId) {
      return denied(request, "self_leave_only")
    }
    if (request.currentStatus !== "active" || request.targetRole === null) {
      return denied(request, "invalid_transition")
    }
    if (isActiveOwner(request)) {
      return requiresLockedOwnerCheck(request)
    }
    return allowed(request, "disabled", request.targetRole)
  }

  if (!hasCompanyPermission(request.actorRole, "membership.manage")) {
    return denied(request, "management_permission_required")
  }

  if (
    request.actorRole !== "owner" &&
    (request.targetRole === "owner" || request.requestedRole === "owner")
  ) {
    return denied(request, "owner_permission_required")
  }

  switch (request.action) {
    case "invite":
      if (
        (request.currentStatus !== null &&
          request.currentStatus !== "removed") ||
        request.requestedRole === null
      ) {
        return denied(
          request,
          request.requestedRole === null
            ? "requested_role_required"
            : "invalid_transition"
        )
      }
      return allowed(request, "invited", request.requestedRole)

    case "activate":
      if (
        (request.currentStatus !== "invited" &&
          request.currentStatus !== "disabled") ||
        request.targetRole === null
      ) {
        return denied(request, "invalid_transition")
      }
      return allowed(request, "active", request.targetRole)

    case "disable":
      if (request.currentStatus !== "active" || request.targetRole === null) {
        return denied(request, "invalid_transition")
      }
      if (isActiveOwner(request)) {
        return requiresLockedOwnerCheck(request)
      }
      return allowed(request, "disabled", request.targetRole)

    case "remove":
      if (
        request.currentStatus === null ||
        request.currentStatus === "removed" ||
        request.targetRole === null
      ) {
        return denied(request, "invalid_transition")
      }
      if (isActiveOwner(request)) {
        return requiresLockedOwnerCheck(request)
      }
      return allowed(request, "removed", request.targetRole)

    case "change_role":
      if (
        request.currentStatus === null ||
        request.currentStatus === "removed" ||
        request.targetRole === null ||
        request.requestedRole === null
      ) {
        return denied(
          request,
          request.requestedRole === null
            ? "requested_role_required"
            : "invalid_transition"
        )
      }
      if (request.targetRole === request.requestedRole) {
        return denied(request, "invalid_transition")
      }
      if (
        request.currentStatus === "active" &&
        request.targetRole === "owner" &&
        request.requestedRole !== "owner"
      ) {
        return requiresLockedOwnerCheck(request)
      }
      return allowed(request, request.currentStatus, request.requestedRole)
  }
}

function isActiveOwner(request: MembershipTransitionRequest): boolean {
  return request.currentStatus === "active" && request.targetRole === "owner"
}

function requiresLockedOwnerCheck(
  request: MembershipTransitionRequest
): MembershipTransitionResult {
  return {
    effect: "requires_database_check",
    reason: "locked_owner_check_required",
    companyId: request.companyId,
    action: request.action,
    nextStatus: null,
    nextRole: null,
  }
}

function allowed(
  request: MembershipTransitionRequest,
  nextStatus: MembershipStatus,
  nextRole: MembershipTransitionResult["nextRole"]
): MembershipTransitionResult {
  return {
    effect: "allow",
    reason: "transition_allowed",
    companyId: request.companyId,
    action: request.action,
    nextStatus,
    nextRole,
  }
}

function denied(
  request: MembershipTransitionRequest,
  reason: Exclude<
    MembershipTransitionResult["reason"],
    "transition_allowed" | "locked_owner_check_required"
  >
): MembershipTransitionResult {
  return {
    effect: "deny",
    reason,
    companyId: request.companyId,
    action: request.action,
    nextStatus: null,
    nextRole: null,
  }
}
