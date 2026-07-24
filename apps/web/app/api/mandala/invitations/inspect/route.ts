import { createClient } from "@supabase/supabase-js"
import { invitationTokenRequestSchema } from "@workspace/control-plane"
import { inspectCompanyInvitation } from "@/lib/mandala/invitations"
import type { Database } from "@/lib/supabase/types"
import { invitationErrorResponse, privateInvitationJson } from "../http"

export async function POST(request: Request) {
  const parsed = invitationTokenRequestSchema.safeParse(
    await request.json().catch(() => null)
  )
  if (!parsed.success)
    return privateInvitationJson({ error: "invalid_request" }, 400)
  const supabase = createClient<Database>(
    requiredEnvironment("NEXT_PUBLIC_SUPABASE_URL"),
    requiredEnvironment("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } }
  )
  try {
    const invitation = await inspectCompanyInvitation({
      supabase,
      token: parsed.data.token,
    })
    return privateInvitationJson({ invitation })
  } catch (error) {
    return invitationErrorResponse(error)
  }
}

function requiredEnvironment(
  name: "NEXT_PUBLIC_SUPABASE_URL" | "NEXT_PUBLIC_SUPABASE_ANON_KEY"
) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`Missing ${name}.`)
  return value
}
