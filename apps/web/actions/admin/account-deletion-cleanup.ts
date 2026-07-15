import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"
import { createAdminClient } from "@/lib/supabase/admin"
import type { Database } from "@/lib/supabase/types"

const STORAGE_PAGE_SIZE = 1_000

export async function cleanEligiblePersonalData(
  admin: SupabaseClient<Database>,
  userId: string
) {
  const errors: string[] = []

  const { error: profileError } = await admin
    .from("profiles")
    .delete()
    .eq("user_id", userId)
  if (profileError) errors.push("profile_cleanup_failed")

  const { error: collectionsError } = await admin
    .from("collections")
    .delete()
    .eq("owner_type", "user")
    .eq("owner_id", userId)
  if (collectionsError) errors.push("collections_cleanup_failed")

  const { error: pagesError } = await admin
    .from("pages")
    .delete()
    .eq("owner_type", "user")
    .eq("owner_id", userId)
  if (pagesError) errors.push("pages_cleanup_failed")

  const { error: importsError } = await admin
    .from("connection_imports")
    .delete()
    .eq("owner_type", "user")
    .eq("owner_id", userId)
  if (importsError) errors.push("imports_cleanup_failed")

  await removeUserFolder(admin, "avatars", userId, errors)
  await removeUserFolder(admin, "attachments", userId, errors)

  return errors
}

export async function recordAccountDeletionProgress(
  admin: SupabaseClient<Database>,
  userId: string,
  status:
    | "access_revoked"
    | "auth_deleted"
    | "cleanup_failed"
    | "completed"
    | "sessions_revoked",
  errorCode: string | null = null
) {
  const { error } = await admin.rpc("record_account_deletion_progress", {
    p_error_code: errorCode ?? undefined,
    p_status: status,
    p_user_id: userId,
  })
  return !error
}

export async function retryPendingAccountDeletionCleanup(input?: {
  admin?: SupabaseClient<Database>
  limit?: number
}) {
  const admin = input?.admin ?? createAdminClient()
  const limit = Math.min(Math.max(input?.limit ?? 25, 1), 100)
  const { data: requests, error } = await admin
    .from("account_deletion_requests")
    .select("user_id")
    .in("status", ["auth_deleted", "cleanup_failed"])
    .not("auth_deleted_at", "is", null)
    .order("updated_at", { ascending: true })
    .limit(limit)

  if (error) throw new Error("account_deletion_cleanup_claim_failed")

  let completed = 0
  let failed = 0
  for (const request of requests ?? []) {
    const cleanupErrors = await cleanEligiblePersonalData(
      admin,
      request.user_id
    )
    if (cleanupErrors.length > 0) {
      failed += 1
      await recordAccountDeletionProgress(
        admin,
        request.user_id,
        "cleanup_failed",
        cleanupErrors[0]!
      )
      continue
    }

    const recorded = await recordAccountDeletionProgress(
      admin,
      request.user_id,
      "completed"
    )
    if (recorded) completed += 1
    else failed += 1
  }

  return { attempted: requests?.length ?? 0, completed, failed }
}

async function removeUserFolder(
  admin: SupabaseClient<Database>,
  bucket: "attachments" | "avatars",
  userId: string,
  errors: string[]
) {
  while (true) {
    const { data, error: listError } = await admin.storage
      .from(bucket)
      .list(userId, { limit: STORAGE_PAGE_SIZE, offset: 0 })
    if (listError) {
      errors.push(`${bucket}_list_failed`)
      return
    }
    if (!data?.length) return

    const { error: removeError } = await admin.storage
      .from(bucket)
      .remove(data.map((file) => `${userId}/${file.name}`))
    if (removeError) {
      errors.push(`${bucket}_cleanup_failed`)
      return
    }
  }
}
