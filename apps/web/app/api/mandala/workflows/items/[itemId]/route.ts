import { workItemDetailResponseSchema } from "@workspace/control-plane"
import { z } from "zod"
import { getWorkflowItemDetail } from "@/lib/mandala/control-plane/queries"
import { sanitizeLegacyItemDetail } from "@/lib/mandala/control-plane/public-projection"
import { authenticateRequest } from "@/lib/supabase/request"
import {
  controlPlaneErrorResponse,
  privateJson,
} from "../../control-plane-http"

const requestSchema = z.object({
  companyId: z.string().uuid(),
  itemId: z.string().uuid(),
})

export async function GET(
  request: Request,
  context: { params: Promise<{ itemId: string }> }
) {
  const auth = await authenticateRequest(request)
  if (!auth) return privateJson({ error: "unauthorized" }, 401)

  const url = new URL(request.url)
  const parsed = requestSchema.safeParse({
    companyId: url.searchParams.get("companyId"),
    itemId: (await context.params).itemId,
  })
  if (!parsed.success) {
    return privateJson(
      { error: "invalid_request", issues: parsed.error.flatten().fieldErrors },
      400
    )
  }

  try {
    const detail = await getWorkflowItemDetail({
      supabase: auth.supabase,
      companyId: parsed.data.companyId,
      itemId: parsed.data.itemId,
    })
    return privateJson(
      workItemDetailResponseSchema.parse(sanitizeLegacyItemDetail(detail))
    )
  } catch (error) {
    return controlPlaneErrorResponse(error, "item_detail_failed")
  }
}
