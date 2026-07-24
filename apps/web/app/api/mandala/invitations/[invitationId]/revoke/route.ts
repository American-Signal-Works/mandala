import { z } from "zod"
import { revokeCompanyInvitation } from "@/lib/mandala/invitations"
import { authenticateRequest } from "@/lib/supabase/request"
import { invitationErrorResponse, privateInvitationJson } from "../../http"

const paramsSchema = z.object({ invitationId: z.string().uuid() })

export async function POST(
  request: Request,
  context: { params: Promise<{ invitationId: string }> }
) {
  const auth = await authenticateRequest(request)
  if (!auth) return privateInvitationJson({ error: "unauthorized" }, 401)
  const parsed = paramsSchema.safeParse(await context.params)
  if (!parsed.success)
    return privateInvitationJson({ error: "invalid_request" }, 400)
  try {
    const invitation = await revokeCompanyInvitation({
      supabase: auth.supabase,
      invitationId: parsed.data.invitationId,
    })
    return privateInvitationJson({ invitation })
  } catch (error) {
    return invitationErrorResponse(error)
  }
}
