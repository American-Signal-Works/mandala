import { NextResponse } from "next/server"
import {
  contextualChatRequestSchema,
  contextualChatResponseSchema,
  reviewVersionSchema,
  workItemDetailSchema,
} from "@workspace/control-plane"
import {
  WorkItemQuestionUnavailableError,
  answerWorkItemQuestion,
} from "@/lib/mandala/control-plane/work-item-question"
import { loadWorkItemQuestionModelContext } from "@/lib/mandala/control-plane/work-item-model-context"
import { routeContextualChat } from "@/lib/mandala/control-plane/contextual-chat"
import {
  ConversationalParserUnavailableError,
  parseConversationalControlInput,
} from "@/lib/mandala/control-plane/conversational-parser"
import {
  ControlPlaneQueryError,
  getWorkflowItemDetail,
  getWorkflowReview,
} from "@/lib/mandala/control-plane/queries"
import { getCompanyMembership } from "@/lib/mandala/workflows"
import { authenticateRequest } from "@/lib/supabase/request"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  const auth = await authenticateRequest(request)
  if (!auth)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const parsed = contextualChatRequestSchema.safeParse(await parseJson(request))
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", issues: parsed.error.flatten().fieldErrors },
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
    const result = await routeContextualChat(parsed.data, {
      getReviewVersion: async (itemId) =>
        reviewVersionSchema.parse(
          (
          await getWorkflowReview({
            supabase: auth.supabase,
            companyId: parsed.data.companyId,
            itemId,
            activityLimit: 1,
          })
          ).version
        ),
      answerQuestion: async (itemId, question) => {
        const detail = workItemDetailSchema.parse(
          await getWorkflowItemDetail({
            supabase: auth.supabase,
            companyId: parsed.data.companyId,
            itemId,
          })
        )
        const answer = await answerWorkItemQuestion({
          detail,
          question,
          modelContext: await loadWorkItemQuestionModelContext({
            supabase: auth.supabase,
            companyId: parsed.data.companyId,
            itemId,
            detail,
          }),
        })
        return answer.answer
      },
      parseCommand: async (phrase) =>
        (
          await parseConversationalControlInput({
            companyId: parsed.data.companyId,
            phrase,
          })
        ).outcome,
    })
    return NextResponse.json(contextualChatResponseSchema.parse(result), {
      headers: { "cache-control": "private, no-store" },
    })
  } catch (error) {
    if (
      error instanceof ControlPlaneQueryError &&
      error.code === "item_not_found"
    ) {
      return NextResponse.json({ error: "item_not_found" }, { status: 404 })
    }
    if (
      error instanceof WorkItemQuestionUnavailableError ||
      error instanceof ConversationalParserUnavailableError
    ) {
      const unsafe = modelSafetyResponse(error.errorClass)
      return NextResponse.json(
        { error: unsafe?.error ?? "chat_unavailable" },
        {
          status: unsafe?.status ?? 503,
          headers: { "cache-control": "private, no-store" },
        }
      )
    }
    return NextResponse.json(
      { error: "contextual_chat_failed" },
      {
        status: 500,
        headers: { "cache-control": "private, no-store" },
      }
    )
  }
}

function modelSafetyResponse(errorClass: string) {
  if (errorClass === "sensitive_input")
    return { error: "sensitive_model_input", status: 400 }
  if (errorClass === "unsafe_model_output")
    return { error: "unsafe_model_output", status: 502 }
  return null
}

async function parseJson(request: Request): Promise<unknown> {
  try {
    return await request.json()
  } catch {
    return null
  }
}
