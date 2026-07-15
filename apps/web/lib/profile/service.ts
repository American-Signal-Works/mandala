import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"
import { z } from "zod"
import type { Database } from "@/lib/supabase/types"

const profileIdentitySchema = z.object({
  userId: z.string().uuid().optional(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  displayName: z.string().nullable(),
  avatarPath: z.string().nullable(),
  timezone: z.string(),
  themeMode: z.enum(["light", "dark", "system"]),
  themeAccent: z.enum([
    "default",
    "blue",
    "emerald",
    "rose",
    "amber",
    "violet",
  ]),
  version: z.number().int().positive(),
  updatedAt: z.string(),
})

const profileUpdateSchema = profileIdentitySchema.pick({
  firstName: true,
  lastName: true,
  displayName: true,
  avatarPath: true,
  timezone: true,
  version: true,
  updatedAt: true,
})

const preferenceUpdateSchema = profileIdentitySchema.pick({
  themeMode: true,
  themeAccent: true,
  version: true,
  updatedAt: true,
})

export type ProfileIdentity = z.infer<typeof profileIdentitySchema>

export class ProfileServiceError extends Error {
  constructor(
    readonly code:
      | "profile_not_found"
      | "profile_version_conflict"
      | "profile_update_failed"
  ) {
    super(code)
    this.name = "ProfileServiceError"
  }
}

export async function getMyProfileIdentity(
  supabase: SupabaseClient<Database>
): Promise<ProfileIdentity> {
  const result = await callRpc(supabase, "get_my_profile_identity")
  if (result.error) throw profileError(result.error.message)
  const parsed = profileIdentitySchema.safeParse(result.data)
  if (!parsed.success) throw new ProfileServiceError("profile_not_found")
  return parsed.data
}

export async function updateMyProfileIdentity(
  supabase: SupabaseClient<Database>,
  input: {
    firstName: string
    lastName: string
    displayName: string | null
    timezone: string
    avatarPath: string | null
    expectedVersion: number
  }
) {
  const result = await callRpc(supabase, "update_my_profile_identity", {
    p_first_name: input.firstName,
    p_last_name: input.lastName,
    p_display_name: input.displayName,
    p_timezone: input.timezone,
    p_avatar_path: input.avatarPath,
    p_expected_version: input.expectedVersion,
  })
  if (result.error) throw profileError(result.error.message)
  const parsed = profileUpdateSchema.safeParse(result.data)
  if (!parsed.success) throw new ProfileServiceError("profile_update_failed")
  return parsed.data
}

export async function updateMyProfilePreferences(
  supabase: SupabaseClient<Database>,
  input: {
    themeMode: ProfileIdentity["themeMode"]
    themeAccent: ProfileIdentity["themeAccent"]
    expectedVersion: number
  }
) {
  const result = await callRpc(supabase, "update_my_profile_preferences", {
    p_theme_mode: input.themeMode,
    p_theme_accent: input.themeAccent,
    p_expected_version: input.expectedVersion,
  })
  if (result.error) throw profileError(result.error.message)
  const parsed = preferenceUpdateSchema.safeParse(result.data)
  if (!parsed.success) throw new ProfileServiceError("profile_update_failed")
  return parsed.data
}

async function callRpc(
  supabase: SupabaseClient<Database>,
  name: string,
  args?: Record<string, unknown>
): Promise<{ data: unknown; error: { message: string } | null }> {
  const result = await supabase.rpc(name as never, args as never)
  return result as unknown as {
    data: unknown
    error: { message: string } | null
  }
}

function profileError(message: string) {
  if (message.includes("profile_version_conflict")) {
    return new ProfileServiceError("profile_version_conflict")
  }
  if (message.includes("profile_not_found")) {
    return new ProfileServiceError("profile_not_found")
  }
  return new ProfileServiceError("profile_update_failed")
}
