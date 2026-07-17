import "server-only"

import { createClient, type Session } from "@supabase/supabase-js"

import { createAdminClient } from "@/lib/supabase/admin"
import type { Database } from "@/lib/supabase/types"

type FunctionName = keyof Database["public"]["Functions"]
type FunctionArgs<Name extends FunctionName> =
  Database["public"]["Functions"][Name]["Args"]

export function createCliDeviceAuthorization(
  input: FunctionArgs<"create_cli_device_authorization_v1">
) {
  return createAdminClient().rpc("create_cli_device_authorization_v1", input)
}

export function inspectCliDeviceAuthorization(
  input: FunctionArgs<"inspect_cli_device_authorization_v1">
) {
  return createAdminClient().rpc("inspect_cli_device_authorization_v1", input)
}

export function decideCliDeviceAuthorization(
  input: FunctionArgs<"decide_cli_device_authorization_v1">
) {
  return createAdminClient().rpc("decide_cli_device_authorization_v1", input)
}

export function claimCliDeviceAuthorization(
  input: FunctionArgs<"claim_cli_device_authorization_v1">
) {
  return createAdminClient().rpc("claim_cli_device_authorization_v1", input)
}

export function completeCliDeviceAuthorization(
  input: FunctionArgs<"complete_cli_device_authorization_v1">
) {
  return createAdminClient().rpc("complete_cli_device_authorization_v1", input)
}

export function releaseCliDeviceAuthorization(
  input: FunctionArgs<"release_cli_device_authorization_v1">
) {
  return createAdminClient().rpc("release_cli_device_authorization_v1", input)
}

export function rotateCliSessionCredentials(
  input: FunctionArgs<"rotate_cli_session_credentials_v1">
) {
  return createAdminClient().rpc("rotate_cli_session_credentials_v1", input)
}

export function inspectCliSessionRefresh(
  input: FunctionArgs<"inspect_cli_session_refresh_v1">
) {
  return createAdminClient().rpc("inspect_cli_session_refresh_v1", input)
}

export function revokeCliSession(input: FunctionArgs<"revoke_cli_session_v1">) {
  return createAdminClient().rpc("revoke_cli_session_v1", input)
}

export function revokeAllCliSessions(
  input: FunctionArgs<"revoke_all_cli_sessions_v1">
) {
  return createAdminClient().rpc("revoke_all_cli_sessions_v1", input)
}

export function loadCliSessions(userId: string) {
  return createAdminClient()
    .from("cli_sessions")
    .select(
      "id, selected_company_id, scopes, client_name, client_version, client_platform, created_at, last_used_at, revoked_at"
    )
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
}

export function loadCliCompany(companyId: string) {
  return createAdminClient()
    .from("companies")
    .select("id, name")
    .eq("id", companyId)
    .maybeSingle()
}

export function loadCliUser(userId: string) {
  return createAdminClient().auth.admin.getUserById(userId)
}

export async function issueSupabaseCliActorSession(
  userId: string
): Promise<Session> {
  const admin = createAdminClient()
  const { data: userResult, error: userError } =
    await admin.auth.admin.getUserById(userId)
  const email = userResult.user?.email
  if (userError || !userResult.user || !email) {
    throw new Error("cli_user_unavailable")
  }

  const { data: link, error: linkError } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  })
  if (
    linkError ||
    !link.user ||
    link.user.id !== userId ||
    !link.properties?.hashed_token
  ) {
    throw new Error("cli_actor_session_issue_failed")
  }

  const exchange = createClient<Database>(
    requiredEnvironment("NEXT_PUBLIC_SUPABASE_URL"),
    requiredEnvironment("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
    }
  )
  const { data, error } = await exchange.auth.verifyOtp({
    token_hash: link.properties.hashed_token,
    type: "email",
  })
  if (error || !data.session || data.session.user.id !== userId) {
    throw new Error("cli_actor_session_issue_failed")
  }
  return data.session
}

export async function revokeIssuedCliActorSession(accessToken: string) {
  await createAdminClient().auth.admin.signOut(accessToken, "local")
}

function requiredEnvironment(
  name: "NEXT_PUBLIC_SUPABASE_URL" | "NEXT_PUBLIC_SUPABASE_ANON_KEY"
) {
  const value = process.env[name]
  if (!value) throw new Error(`Missing required environment variable: ${name}`)
  return value
}
