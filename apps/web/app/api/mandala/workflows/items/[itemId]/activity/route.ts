import { workItemActivityResponseSchema } from "@workspace/control-plane"
import { z } from "zod"
import {
  decodeBoundCursor,
  encodeBoundCursor,
  resolveCursorSecret,
} from "@/lib/mandala/control-plane/cursor"
import {
  activityPageSchema,
  listWorkflowActivity,
} from "@/lib/mandala/control-plane/queries"
import { authenticateRequest } from "@/lib/supabase/request"
import {
  controlPlaneErrorResponse,
  privateJson,
} from "../../../control-plane-http"

const requestSchema = z.object({
  companyId: z.string().uuid(),
  itemId: z.string().uuid(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().min(1).max(4_096).optional(),
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
    limit: url.searchParams.get("limit") ?? undefined,
    cursor: url.searchParams.get("cursor") ?? undefined,
  })
  if (!parsed.success) {
    return privateJson(
      { error: "invalid_request", issues: parsed.error.flatten().fieldErrors },
      400
    )
  }

  try {
    const binding = {
      companyId: parsed.data.companyId,
      itemId: parsed.data.itemId,
      limit: parsed.data.limit,
      surface: "activity",
    }
    const secret = resolveCursorSecret()
    const page = parsed.data.cursor
      ? decodeBoundCursor({
          cursor: parsed.data.cursor,
          binding,
          pageSchema: activityPageSchema,
          secret,
        })
      : undefined
    const result = await listWorkflowActivity({
      supabase: auth.supabase,
      companyId: parsed.data.companyId,
      itemId: parsed.data.itemId,
      limit: parsed.data.limit,
      page,
    })
    const nextCursor = result.nextPage
      ? encodeBoundCursor({ binding, page: result.nextPage, secret })
      : null
    return privateJson(
      workItemActivityResponseSchema.parse({
        items: result.items,
        nextCursor,
      })
    )
  } catch (error) {
    return controlPlaneErrorResponse(error, "activity_failed")
  }
}
