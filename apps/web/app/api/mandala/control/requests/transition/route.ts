import { NextResponse } from "next/server"
import {
  controlRequestTransitionRequestSchema,
  controlRequestTransitionResponseSchema,
} from "@workspace/control-plane"
import {
  classifyWorkflowRpcError,
  transitionWorkflowControlRequestRpc,
} from "@/lib/mandala/workflows"
import { authenticateRequest } from "@/lib/supabase/request"

export async function POST(request: Request) {
  const auth = await authenticateRequest(request)
  if (!auth)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const parsed = controlRequestTransitionRequestSchema.safeParse(
    await parseJson(request)
  )
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", issues: parsed.error.flatten().fieldErrors },
      { status: 400 }
    )
  }

  try {
    const controlRequest = await transitionWorkflowControlRequestRpc({
      supabase: auth.supabase,
      companyId: parsed.data.companyId,
      controlRequestId: parsed.data.controlRequestId,
      resolutionStatus: parsed.data.resolutionStatus,
      workflowRunId: parsed.data.workflowRunId,
      workflowItemId: parsed.data.workflowItemId,
    })
    return NextResponse.json(
      controlRequestTransitionResponseSchema.parse({ request: controlRequest }),
      { headers: { "cache-control": "private, no-store" } }
    )
  } catch (error) {
    const response = classifyWorkflowRpcError(
      error,
      "control_request_transition_failed"
    )
    return NextResponse.json(
      { error: response.code },
      { status: response.status }
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
