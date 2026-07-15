import {
  authorizeCompanyRole,
  companyRoleSchema,
  type CompanyPermission,
  type CompanyRole,
} from "@workspace/control-plane"
import {
  getCompanyMembership,
  type WorkflowSupabaseClient,
} from "@/lib/mandala/workflows"

export type CompanyPermissionResult =
  | {
      effect: "allow"
      reason: "role_permission_granted"
      role: CompanyRole
      permission: CompanyPermission
    }
  | {
      effect: "deny"
      reason: "forbidden" | "membership_lookup_failed"
      permission: CompanyPermission
    }

export type CompanyPermissionFailure = {
  code: "forbidden" | "membership_lookup_failed"
  status: 403 | 500
}

export async function authorizeCompanyPermission(input: {
  supabase: WorkflowSupabaseClient
  companyId: string
  userId: string
  permission: CompanyPermission
}): Promise<CompanyPermissionResult> {
  let membership
  try {
    membership = await getCompanyMembership({
      supabase: input.supabase,
      companyId: input.companyId,
      userId: input.userId,
    })
  } catch {
    return denied(input.permission, "membership_lookup_failed")
  }

  const role = companyRoleSchema.safeParse(membership?.role)
  if (!role.success) return denied(input.permission, "forbidden")

  const authorization = authorizeCompanyRole(role.data, input.permission)
  if (authorization.effect === "deny") {
    return denied(input.permission, "forbidden")
  }

  return {
    effect: "allow",
    reason: "role_permission_granted",
    role: role.data,
    permission: input.permission,
  }
}

export function companyPermissionFailure(
  result: CompanyPermissionResult
): CompanyPermissionFailure | null {
  if (result.effect === "allow") return null
  return result.reason === "membership_lookup_failed"
    ? { code: "membership_lookup_failed", status: 500 }
    : { code: "forbidden", status: 403 }
}

function denied(
  permission: CompanyPermission,
  reason: "forbidden" | "membership_lookup_failed"
): CompanyPermissionResult {
  return { effect: "deny", reason, permission }
}
