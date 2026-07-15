import type { SupabaseClient } from "@supabase/supabase-js"
import {
  membershipTransitionResponseSchema,
  type MembershipAction,
  type MembershipTransitionResponse,
} from "@workspace/control-plane"
import type { Database } from "@/lib/supabase/types"

type MembershipSupabaseClient = SupabaseClient<Database>

export class MembershipTransitionRpcError extends Error {
  constructor(readonly databaseCode?: string) {
    super("membership_transition_failed")
    this.name = "MembershipTransitionRpcError"
  }
}

export async function transitionCompanyMembershipRpc(input: {
  supabase: MembershipSupabaseClient
  companyId: string
  targetUserId: string
  action: MembershipAction
  requestedRole?: MembershipTransitionResponse["role"] | null
}): Promise<MembershipTransitionResponse> {
  const { data, error } = await input.supabase.rpc(
    "transition_company_membership",
    {
      p_company_id: input.companyId,
      p_target_user_id: input.targetUserId,
      p_action: input.action,
      ...(input.requestedRole ? { p_requested_role: input.requestedRole } : {}),
    }
  )

  if (error) throw new MembershipTransitionRpcError(error.code)
  return membershipTransitionResponseSchema.parse(data)
}

export function classifyMembershipTransitionError(error: unknown): {
  code:
    | "forbidden"
    | "invalid_membership_transition"
    | "last_active_owner"
    | "not_found"
    | "membership_transition_failed"
  status: 403 | 404 | 409 | 500
} {
  if (!(error instanceof MembershipTransitionRpcError)) {
    return { code: "membership_transition_failed", status: 500 }
  }

  switch (error.databaseCode) {
    case "42501":
      return { code: "forbidden", status: 403 }
    case "22023":
      return { code: "invalid_membership_transition", status: 409 }
    case "55000":
      return { code: "last_active_owner", status: 409 }
    case "P0002":
      return { code: "not_found", status: 404 }
    default:
      return { code: "membership_transition_failed", status: 500 }
  }
}
