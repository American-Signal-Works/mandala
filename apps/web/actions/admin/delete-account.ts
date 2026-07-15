"use server"

import {
  cleanEligiblePersonalData,
  recordAccountDeletionProgress,
} from "@/actions/admin/account-deletion-cleanup"
import type { SupabaseClient } from "@supabase/supabase-js"
import { isRecentSessionAuthentication } from "@/lib/auth/recent-auth"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import type { Database } from "@/lib/supabase/types"

export async function deleteAccount() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return failure("UNAUTHENTICATED", "Sign in.")
  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession()
  if (sessionError || !session?.access_token) {
    return failure(
      "REAUTHENTICATION_REQUIRED",
      "Sign in again before deleting your account."
    )
  }

  const { data: claimData, error: claimsError } = await supabase.auth.getClaims(
    session.access_token
  )
  if (
    claimsError ||
    !isRecentSessionAuthentication(claimData?.claims, user.id)
  ) {
    return failure(
      "REAUTHENTICATION_REQUIRED",
      "Sign in again before deleting your account."
    )
  }

  const preflight = await callRpc(supabase, "preflight_account_deletion")
  if (preflight.error) {
    if (preflight.error.message.includes("account_deletion_final_owner")) {
      return failure(
        "ACCOUNT_OWNERSHIP_BLOCKED",
        "Transfer ownership or add another Owner before deleting your account."
      )
    }
    return failure(
      "DELETE_PREFLIGHT_FAILED",
      "Account deletion could not be checked safely. Try again."
    )
  }

  const admin = createAdminClient()
  const { error: signOutError } = await admin.auth.admin.signOut(
    session.access_token,
    "global"
  )
  if (signOutError) {
    await recordAccountDeletionProgress(
      admin,
      user.id,
      "cleanup_failed",
      "session_revoke_failed"
    )
    return failure(
      "SESSION_REVOCATION_FAILED",
      "Your account is still active. Sign out and try again."
    )
  }

  // The admin call is the authoritative global refresh-token revocation. This
  // best-effort call only clears the current browser's server-managed cookies.
  await supabase.auth.signOut({ scope: "local" })

  const sessionsRecorded = await recordAccountDeletionProgress(
    admin,
    user.id,
    "sessions_revoked"
  )
  if (!sessionsRecorded) {
    return failure(
      "DELETE_RETRY_REQUIRED",
      "Your sessions were closed, but deletion could not continue safely. Sign in again to retry."
    )
  }

  const accessRevocation = await callRpc(
    admin,
    "revoke_account_memberships_for_deletion",
    { p_user_id: user.id }
  )
  if (accessRevocation.error) {
    await recordAccountDeletionProgress(
      admin,
      user.id,
      "cleanup_failed",
      "access_revoke_failed"
    )
    return failure(
      "ACCESS_REVOCATION_FAILED",
      "Your sessions were closed, but workspace access could not be removed safely. Sign in again to retry."
    )
  }
  await recordAccountDeletionProgress(admin, user.id, "access_revoked")

  const { error: authError } = await admin.auth.admin.deleteUser(user.id, true)
  if (authError) {
    await recordAccountDeletionProgress(
      admin,
      user.id,
      "cleanup_failed",
      "auth_delete_failed"
    )
    return failure(
      "AUTH_DELETE_FAILED",
      "Your sessions were closed, but the account remains. Sign in again to retry."
    )
  }

  await recordAccountDeletionProgress(admin, user.id, "auth_deleted")

  const cleanupErrors = await cleanEligiblePersonalData(admin, user.id)
  if (cleanupErrors.length > 0) {
    await recordAccountDeletionProgress(
      admin,
      user.id,
      "cleanup_failed",
      cleanupErrors[0]!
    )
    return failure(
      "DELETE_CLEANUP_PENDING",
      "The account was removed. Remaining personal-data cleanup is recorded for a safe retry."
    )
  }

  const completed = await recordAccountDeletionProgress(
    admin,
    user.id,
    "completed"
  )
  if (!completed) {
    return failure(
      "DELETE_COMPLETION_UNCONFIRMED",
      "The account was removed, but deletion tracking needs administrative recovery."
    )
  }

  return { ok: true as const, data: {} }
}

async function callRpc(
  client: SupabaseClient<Database>,
  name: string,
  args?: Record<string, unknown>
) {
  const result = await client.rpc(name as never, args as never)
  return result as unknown as {
    data: unknown
    error: { message: string } | null
  }
}

function failure(code: string, message: string) {
  return { ok: false as const, error: { code, message } }
}
