import { z } from "zod"
import { listCompanyDirectory } from "@/lib/mandala/invitations"
import { authenticateRequest } from "@/lib/supabase/request"
import {
  invitationErrorResponse,
  privateInvitationJson,
} from "../invitations/http"

const companyIdSchema = z.string().uuid()

export async function GET(request: Request) {
  const auth = await authenticateRequest(request)
  if (!auth) return privateInvitationJson({ error: "unauthorized" }, 401)
  const companyId = companyIdSchema.safeParse(
    new URL(request.url).searchParams.get("companyId")
  )
  if (!companyId.success)
    return privateInvitationJson({ error: "invalid_request" }, 400)
  try {
    const directory = await listCompanyDirectory({
      supabase: auth.supabase,
      companyId: companyId.data,
    })
    return privateInvitationJson({ directory })
  } catch (error) {
    return invitationErrorResponse(error)
  }
}
