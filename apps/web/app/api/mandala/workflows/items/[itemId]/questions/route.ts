import { NextResponse } from "next/server"
import {
  workItemDetailSchema,
  workItemQuestionRequestSchema,
  workItemQuestionResponseSchema,
} from "@workspace/control-plane"
import {
  WorkItemQuestionUnavailableError,
  answerWorkItemQuestion,
} from "@/lib/mandala/control-plane/work-item-question"
import {
  ControlPlaneQueryError,
  getWorkflowItemDetail,
} from "@/lib/mandala/control-plane/queries"
import { getCompanyMembership } from "@/lib/mandala/workflows"
import { authenticateRequest } from "@/lib/supabase/request"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(
  request: Request,
  context: { params: Promise<{ itemId: string }> }
) {
  const auth = await authenticateRequest(request)
  if (!auth)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const body = await parseJson(request)
  const parsed = workItemQuestionRequestSchema.safeParse(body)
  const itemId = (await context.params).itemId
  const itemIdParsed =
    workItemDetailSchema.shape.item.shape.id.safeParse(itemId)
  if (!parsed.success || !itemIdParsed.success) {
    return NextResponse.json(
      {
        error: "invalid_request",
        issues: parsed.success
          ? { itemId: ["Invalid work item ID"] }
          : parsed.error.flatten().fieldErrors,
      },
      { status: 400 }
    )
  }

  const membership = await getCompanyMembership({
    supabase: auth.supabase,
    companyId: parsed.data.companyId,
    userId: auth.user.id,
  })
  if (!membership)
    return NextResponse.json({ error: "forbidden" }, { status: 403 })

  try {
    const detail = workItemDetailSchema.parse(
      await getWorkflowItemDetail({
        supabase: auth.supabase,
        companyId: parsed.data.companyId,
        itemId: itemIdParsed.data,
      })
    )
    const answer = await answerWorkItemQuestion({
      detail,
      question: parsed.data.question,
    })
    return NextResponse.json(workItemQuestionResponseSchema.parse(answer), {
      headers: { "cache-control": "private, no-store" },
    })
  } catch (error) {
    if (
      error instanceof ControlPlaneQueryError &&
      error.code === "item_not_found"
    ) {
      return NextResponse.json({ error: "item_not_found" }, { status: 404 })
    }
    if (error instanceof WorkItemQuestionUnavailableError) {
      return NextResponse.json(
        { error: "question_unavailable" },
        {
          status: 503,
          headers: { "cache-control": "private, no-store" },
        }
      )
    }
    return NextResponse.json(
      { error: "work_item_question_failed" },
      {
        status: 500,
        headers: { "cache-control": "private, no-store" },
      }
    )
  }
}

async function parseJson(request: Request): Promise<unknown> {
  try {
    return await request.json()
  } catch {
    return null
  }
}
