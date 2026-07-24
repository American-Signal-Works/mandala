import { issueCompanyInvitationRequestSchema } from "@workspace/control-plane"
import { issueCompanyInvitation } from "@/lib/mandala/invitations"
import { authenticateRequest } from "@/lib/supabase/request"
import { invitationErrorResponse, privateInvitationJson } from "./http"

export async function POST(request: Request) {
  const auth = await authenticateRequest(request)
  if (!auth) return privateInvitationJson({ error: "unauthorized" }, 401)
  const parsed = issueCompanyInvitationRequestSchema.safeParse(
    await request.json().catch(() => null)
  )
  if (!parsed.success)
    return privateInvitationJson({ error: "invalid_request" }, 400)
  try {
    const invitation = await issueCompanyInvitation({
      supabase: auth.supabase,
      companyId: parsed.data.companyId,
      recipientEmail: parsed.data.recipientEmail,
    })
    return privateInvitationJson({ invitation }, 201)
  } catch (error) {
    return invitationErrorResponse(error)
  }
}
