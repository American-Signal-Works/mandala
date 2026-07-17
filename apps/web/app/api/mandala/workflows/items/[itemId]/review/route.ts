import { workItemReviewResponseSchema } from "@workspace/control-plane"
import { z } from "zod"
import {
  decodeBoundCursor,
  encodeBoundCursor,
  resolveCursorSecret,
} from "@/lib/mandala/control-plane/cursor"
import {
  activityPageSchema,
  getWorkflowReview,
} from "@/lib/mandala/control-plane/queries"
import { allowsCliWorkspace, authenticateRequest } from "@/lib/supabase/request"
import {
  controlPlaneErrorResponse,
  privateJson,
} from "../../../control-plane-http"

const requestSchema = z.object({
  companyId: z.string().uuid(),
  itemId: z.string().uuid(),
  activityLimit: z.coerce.number().int().min(1).max(100).default(20),
  activityCursor: z.string().min(1).max(4_096).optional(),
})

export async function GET(
  request: Request,
  context: { params: Promise<{ itemId: string }> }
) {
  const auth = await authenticateRequest(request, { allowManagedCli: true })
  if (!auth) return privateJson({ error: "unauthorized" }, 401)

  const url = new URL(request.url)
  const parsed = requestSchema.safeParse({
    companyId: url.searchParams.get("companyId"),
    itemId: (await context.params).itemId,
    activityLimit: url.searchParams.get("activityLimit") ?? undefined,
    activityCursor: url.searchParams.get("activityCursor") ?? undefined,
  })
  if (!parsed.success) {
    return privateJson(
      { error: "invalid_request", issues: parsed.error.flatten().fieldErrors },
      400
    )
  }
  if (!allowsCliWorkspace(auth, parsed.data.companyId)) {
    return privateJson({ error: "forbidden" }, 403)
  }

  try {
    const binding = activityBinding(parsed.data)
    const secret = resolveCursorSecret()
    const activityPage = parsed.data.activityCursor
      ? decodeBoundCursor({
          cursor: parsed.data.activityCursor,
          binding,
          pageSchema: activityPageSchema,
          secret,
        })
      : undefined
    const result = await getWorkflowReview({
      supabase: auth.supabase,
      companyId: parsed.data.companyId,
      itemId: parsed.data.itemId,
      activityLimit: parsed.data.activityLimit,
      activityPage,
    })
    const activity = activityResultSchema.parse(result.activity)
    const nextCursor = activity.nextPage
      ? encodeBoundCursor({ binding, page: activity.nextPage, secret })
      : null
    return privateJson(
      workItemReviewResponseSchema.parse({
        ...result,
        activity: { items: activity.items, nextCursor },
      })
    )
  } catch (error) {
    return controlPlaneErrorResponse(error, "review_failed")
  }
}

const activityResultSchema = z
  .object({
    items: z.array(z.unknown()),
    nextPage: activityPageSchema.nullable(),
  })
  .strict()

function activityBinding(input: z.infer<typeof requestSchema>) {
  return {
    companyId: input.companyId,
    itemId: input.itemId,
    limit: input.activityLimit,
    surface: "review",
  }
}
