import { NextResponse } from "next/server"
import {
  contextualChatRequestSchema,
  contextualChatResponseSchema,
  contextualChatStreamEventSchema,
  reviewVersionSchema,
  workItemDetailSchema,
} from "@workspace/control-plane"
import {
  WorkItemQuestionUnavailableError,
  answerWorkItemQuestion,
  streamWorkItemQuestion,
} from "@/lib/mandala/control-plane/work-item-question"
import { loadWorkItemQuestionModelContext } from "@/lib/mandala/control-plane/work-item-model-context"
import {
  isSelectedItemReadOnlyQuestion,
  routeContextualChat,
  selectedItemReviewContext,
} from "@/lib/mandala/control-plane/contextual-chat"
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
import type { ModelUsageRecorder } from "@/lib/mandala/usage"
import {
  authenticateRequest,
  hasCliWorkspaceScope,
} from "@/lib/supabase/request"
import { createServerModelUsageRecorder } from "@/actions/admin/provider-usage"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  const auth = await authenticateRequest(request, { allowManagedCli: true })
  if (!auth)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const parsed = contextualChatRequestSchema.safeParse(await parseJson(request))
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", issues: parsed.error.flatten().fieldErrors },
      { status: 400 }
    )
  }

  if (
    auth.authMode === "bearer" &&
    auth.cliSession?.managed === true &&
    !hasCliWorkspaceScope(auth, parsed.data.companyId, "workspace:control")
  ) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 })
  }

  const membership = await getCompanyMembership({
    supabase: auth.supabase,
    companyId: parsed.data.companyId,
    userId: auth.user.id,
  })
  if (!membership)
    return NextResponse.json({ error: "forbidden" }, { status: 403 })

  try {
    const getReviewVersion = async (itemId: string) =>
      reviewVersionSchema.parse(
        (
          await getWorkflowReview({
            supabase: auth.supabase,
            companyId: parsed.data.companyId,
            itemId,
            activityLimit: 1,
          })
        ).version
      )

    if (
      acceptsContextualStream(request) &&
      isSelectedItemReadOnlyQuestion(parsed.data)
    ) {
      const selection = await selectedItemReviewContext(
        parsed.data,
        getReviewVersion
      )
      if (selection.stale) {
        return NextResponse.json(
          contextualChatResponseSchema.parse({
            route: "blocked",
            message:
              "That work item changed since you opened it. Refresh it before continuing.",
            companyId: parsed.data.companyId,
            selectedItemId: selection.selectedItemId,
            reviewVersion: selection.reviewVersion,
            command: null,
            confirmationRequired: false,
            mutated: false,
          }),
          { headers: { "cache-control": "private, no-store" } }
        )
      }
      const itemId = selection.selectedItemId!
      const detail = workItemDetailSchema.parse(
        await getWorkflowItemDetail({
          supabase: auth.supabase,
          companyId: parsed.data.companyId,
          itemId,
        })
      )
      const modelContext = await loadWorkItemQuestionModelContext({
        supabase: auth.supabase,
        companyId: parsed.data.companyId,
        itemId,
        detail,
      })
      if (request.signal.aborted) return abortedRequestResponse()
      return contextualQuestionStream({
        request,
        companyId: parsed.data.companyId,
        itemId,
        reviewVersion: selection.reviewVersion!,
        question: parsed.data.input,
        detail,
        modelContext,
        recordUsage: createServerModelUsageRecorder({
          companyId: parsed.data.companyId,
          actorUserId: auth.user.id,
          workflowRunId: detail.item.workflowRunId,
          sourceOperation: "mandala.control.chat.question",
        }),
      })
    }

    const result = await routeContextualChat(parsed.data, {
      getReviewVersion,
      answerQuestion: async (itemId, question) => {
        const detail = workItemDetailSchema.parse(
          await getWorkflowItemDetail({
            supabase: auth.supabase,
            companyId: parsed.data.companyId,
            itemId,
          })
        )
        const answer = await answerWorkItemQuestion(
          {
            detail,
            question,
            modelContext: await loadWorkItemQuestionModelContext({
              supabase: auth.supabase,
              companyId: parsed.data.companyId,
              itemId,
              detail,
            }),
          },
          {
            recordUsage: createServerModelUsageRecorder({
              companyId: parsed.data.companyId,
              actorUserId: auth.user.id,
              workflowRunId: detail.item.workflowRunId,
              sourceOperation: "mandala.control.chat.question",
            }),
          }
        )
        return answer.answer
      },
      parseCommand: async (phrase) =>
        (
          await parseConversationalControlInput(
            {
              companyId: parsed.data.companyId,
              phrase,
            },
            {
              recordUsage: createServerModelUsageRecorder({
                companyId: parsed.data.companyId,
                actorUserId: auth.user.id,
                sourceOperation: "mandala.control.chat.command",
              }),
            }
          )
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

function acceptsContextualStream(request: Request): boolean {
  return (
    request.headers
      .get("accept")
      ?.toLowerCase()
      .includes("application/x-ndjson") === true
  )
}

function contextualQuestionStream(input: {
  request: Request
  companyId: string
  itemId: string
  reviewVersion: string
  question: string
  detail: Parameters<typeof streamWorkItemQuestion>[0]["detail"]
  modelContext: Parameters<typeof streamWorkItemQuestion>[0]["modelContext"]
  recordUsage: ModelUsageRecorder
}): Response {
  if (input.request.signal.aborted) return abortedRequestResponse()
  const encoder = new TextEncoder()
  const abort = new AbortController()
  const abortFromRequest = () => abort.abort()
  input.request.signal.addEventListener("abort", abortFromRequest, {
    once: true,
  })
  let closed = false
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: unknown) => {
        if (closed || abort.signal.aborted) return
        const parsed = contextualChatStreamEventSchema.parse(event)
        controller.enqueue(encoder.encode(`${JSON.stringify(parsed)}\n`))
      }
      send({
        type: "start",
        companyId: input.companyId,
        selectedItemId: input.itemId,
        reviewVersion: input.reviewVersion,
      })
      let emittedAnswer = ""
      void streamWorkItemQuestion(
        {
          detail: input.detail,
          question: input.question,
          modelContext: input.modelContext,
        },
        (delta) => {
          emittedAnswer += delta
          send({ type: "delta", text: delta })
        },
        { recordUsage: input.recordUsage, signal: abort.signal }
      )
        .then((result) => {
          if (result.answer !== emittedAnswer) {
            throw new WorkItemQuestionUnavailableError(
              "invalid_model_output",
              result.model,
              result.trace
            )
          }
          send({ type: "done", ...result })
        })
        .catch((error: unknown) => {
          if (abort.signal.aborted) return
          send({ type: "error", error: questionStreamError(error) })
        })
        .finally(() => {
          input.request.signal.removeEventListener("abort", abortFromRequest)
          if (!closed) {
            closed = true
            controller.close()
          }
        })
    },
    cancel() {
      closed = true
      abort.abort()
      input.request.signal.removeEventListener("abort", abortFromRequest)
    },
  })
  return new Response(stream, {
    headers: {
      "cache-control": "private, no-store",
      "content-type": "application/x-ndjson; charset=utf-8",
      "x-content-type-options": "nosniff",
    },
  })
}

function abortedRequestResponse(): Response {
  return new Response(null, {
    status: 499,
    headers: { "cache-control": "private, no-store" },
  })
}

function questionStreamError(error: unknown) {
  if (error instanceof WorkItemQuestionUnavailableError) {
    if (error.errorClass === "sensitive_input") return "sensitive_model_input"
    if (error.errorClass === "unsafe_model_output") return "unsafe_model_output"
  }
  return "question_unavailable"
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
