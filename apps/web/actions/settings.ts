"use server"
import { revalidatePath } from "next/cache"
import { z } from "zod"
import {
  getMyProfileIdentity,
  ProfileServiceError,
  updateMyProfileIdentity,
  updateMyProfilePreferences,
} from "@/lib/profile/service"
import { createClient } from "@/lib/supabase/server"

const Result = <T>(d: T) => ({ ok: true as const, data: d })
const Err = (code: string, message: string) => ({
  ok: false as const,
  error: { code, message },
})

const ProfileSchema = z.object({
  first_name: z.string().trim().min(1).max(80).optional(),
  last_name: z.string().trim().min(1).max(80).optional(),
  display_name: z.string().trim().max(161).optional(),
  timezone: z.string().min(1).optional(),
  avatar_path: z.string().nullable().optional(),
  expected_version: z.number().int().positive().optional(),
})
export async function updateProfile(input: z.infer<typeof ProfileSchema>) {
  const parsed = ProfileSchema.safeParse(input)
  if (!parsed.success)
    return Err("INVALID_INPUT", parsed.error.issues[0]!.message)
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return Err("UNAUTHENTICATED", "Sign in.")

  try {
    const current = await getMyProfileIdentity(supabase)
    const fallbackNames = namesFromDisplayName(parsed.data.display_name)
    const firstName =
      parsed.data.first_name ?? current.firstName ?? fallbackNames?.firstName
    const lastName =
      parsed.data.last_name ?? current.lastName ?? fallbackNames?.lastName
    if (!firstName || !lastName) {
      return Err("NAMES_REQUIRED", "Enter both a first and last name.")
    }

    const updated = await updateMyProfileIdentity(supabase, {
      firstName,
      lastName,
      displayName: parsed.data.display_name ?? current.displayName,
      timezone: parsed.data.timezone ?? current.timezone,
      avatarPath:
        parsed.data.avatar_path === undefined
          ? current.avatarPath
          : parsed.data.avatar_path,
      expectedVersion: parsed.data.expected_version ?? current.version,
    })
    revalidatePath("/settings")
    return Result({ version: updated.version })
  } catch (error) {
    return profileActionError(error)
  }
}

const AppearanceSchema = z.object({
  theme_mode: z.enum(["light", "dark", "system"]).optional(),
  theme_accent: z
    .enum(["default", "blue", "emerald", "rose", "amber", "violet"])
    .optional(),
  expected_version: z.number().int().positive().optional(),
})
export async function updateAppearance(
  input: z.infer<typeof AppearanceSchema>
) {
  const parsed = AppearanceSchema.safeParse(input)
  if (!parsed.success)
    return Err("INVALID_INPUT", parsed.error.issues[0]!.message)
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return Err("UNAUTHENTICATED", "Sign in.")

  try {
    const current = await getMyProfileIdentity(supabase)
    await updateMyProfilePreferences(supabase, {
      themeMode: parsed.data.theme_mode ?? current.themeMode,
      themeAccent: parsed.data.theme_accent ?? current.themeAccent,
      expectedVersion: parsed.data.expected_version ?? current.version,
    })
    revalidatePath("/", "layout")
    return Result({})
  } catch (error) {
    return profileActionError(error)
  }
}

function namesFromDisplayName(displayName: string | undefined) {
  if (!displayName) return null
  const [firstName, ...remaining] = displayName.trim().split(/\s+/)
  const lastName = remaining.join(" ")
  return firstName && lastName ? { firstName, lastName } : null
}

function profileActionError(error: unknown) {
  if (
    error instanceof ProfileServiceError &&
    error.code === "profile_version_conflict"
  ) {
    return Err(
      "PROFILE_CONFLICT",
      "Your profile changed in another session. Refresh and try again."
    )
  }
  return Err("UPDATE_FAILED", "Your changes could not be saved. Try again.")
}
