import { workItemQueueResponseSchema } from "@workspace/control-plane"
import {
  decodeBoundCursor,
  encodeBoundCursor,
  resolveCursorSecret,
} from "@/lib/mandala/control-plane/cursor"
import {
  listWorkflowQueue,
  queueSnapshotPageSchema,
} from "@/lib/mandala/control-plane/queries"
import {
  parseQueueSearchParams,
  queueCursorBinding,
} from "@/lib/mandala/control-plane/queue-query"
import { authenticateRequest } from "@/lib/supabase/request"
import { controlPlaneErrorResponse, privateJson } from "../control-plane-http"

export async function GET(request: Request) {
  const auth = await authenticateRequest(request)
  if (!auth) return privateJson({ error: "unauthorized" }, 401)

  const url = new URL(request.url)
  const parsed = parseQueueSearchParams(url.searchParams)
  if (!parsed.success) {
    return privateJson({ error: "invalid_request", issues: parsed.issues }, 400)
  }

  try {
    const binding = queueCursorBinding(parsed.data)
    const secret = resolveCursorSecret()
    const page = parsed.data.cursor
      ? decodeBoundCursor({
          cursor: parsed.data.cursor,
          binding,
          pageSchema: queueSnapshotPageSchema,
          secret,
        })
      : undefined
    const result = await listWorkflowQueue({
      supabase: auth.supabase,
      query: parsed.data,
      page,
    })
    const nextCursor = result.nextPage
      ? encodeBoundCursor({ binding, page: result.nextPage, secret })
      : null
    return privateJson(
      workItemQueueResponseSchema.parse({
        items: result.items,
        nextCursor,
      })
    )
  } catch (error) {
    return controlPlaneErrorResponse(error, "item_list_failed")
  }
}
