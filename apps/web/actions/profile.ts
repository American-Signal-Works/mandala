// apps/web/actions/profile.ts
"use server"
import { createClient } from "@/lib/supabase/server"

export async function ensureProfile() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false as const }

  const { error } = await supabase
    .from("profiles")
    .upsert({ user_id: user.id }, { onConflict: "user_id" })

  if (error)
    return {
      ok: false as const,
      error: { code: "PROFILE_UPSERT_FAILED", message: error.message },
    }
  return { ok: true as const }
}
