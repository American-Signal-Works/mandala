// apps/web/actions/upload.ts
"use server"
import { createClient } from "@/lib/supabase/server"

export async function uploadImage(formData: FormData) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user)
    return {
      ok: false as const,
      error: { code: "UNAUTHENTICATED", message: "Sign in." },
    }

  const file = formData.get("file")
  if (!(file instanceof File))
    return {
      ok: false as const,
      error: { code: "NO_FILE", message: "Pick a file." },
    }

  const safe = file.name.replace(/[^a-zA-Z0-9.-]/g, "_")
  const path = `${user.id}/editor/${crypto.randomUUID()}-${safe}`

  const { error } = await supabase.storage
    .from("attachments")
    .upload(path, file)
  if (error)
    return {
      ok: false as const,
      error: { code: "UPLOAD_FAILED", message: error.message },
    }

  const { data: signed } = await supabase.storage
    .from("attachments")
    .createSignedUrl(path, 60 * 60 * 24 * 30)
  return { ok: true as const, data: { path, url: signed?.signedUrl ?? "" } }
}
