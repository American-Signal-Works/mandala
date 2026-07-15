import { invitationTokenRequestSchema } from "@workspace/control-plane"
import { acceptCompanyInvitation } from "@/lib/mandala/invitations"
import { authenticateRequest } from "@/lib/supabase/request"
import { invitationErrorResponse, privateInvitationJson } from "../http"

export async function POST(request: Request) {
  const auth = await authenticateRequest(request)
  if (!auth) return privateInvitationJson({ error: "unauthorized" }, 401)
  const parsed = invitationTokenRequestSchema.safeParse(
    await request.json().catch(() => null)
  )
  if (!parsed.success) return privateInvitationJson({ error: "invalid_request" }, 400)
  try {
    const acceptance = await acceptCompanyInvitation({
      supabase: auth.supabase,
      token: parsed.data.token,
    })
    return privateInvitationJson({ acceptance })
  } catch (error) {
    return invitationErrorResponse(error)
  }
}
