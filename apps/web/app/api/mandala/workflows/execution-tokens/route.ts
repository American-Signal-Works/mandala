import { NextResponse } from "next/server"
import {
  executionTokenRequestSchema,
  executionTokenResponseSchema,
} from "@workspace/control-plane"
import {
  classifyWorkflowRpcError,
  reissueWorkflowExecutionTokenRpc,
} from "@/lib/mandala/workflows"
import {
  authorizeCompanyPermission,
  companyPermissionFailure,
} from "@/lib/mandala/authorization"
import { authenticateRequest } from "@/lib/supabase/request"

export async function POST(request: Request) {
  const auth = await authenticateRequest(request)
  if (!auth)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const parsed = executionTokenRequestSchema.safeParse(await parseJson(request))
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", issues: parsed.error.flatten().fieldErrors },
      { status: 400 }
    )
  }

  const permissionFailure = companyPermissionFailure(
    await authorizeCompanyPermission({
      supabase: auth.supabase,
      companyId: parsed.data.companyId,
      userId: auth.user.id,
      permission: "workflow.execution_token.issue",
    })
  )
  if (permissionFailure) {
    return NextResponse.json(
      { error: permissionFailure.code },
      {
        status: permissionFailure.status,
        headers: { "cache-control": "private, no-store" },
      }
    )
  }

  try {
    const result = await reissueWorkflowExecutionTokenRpc({
      supabase: auth.supabase,
      companyId: parsed.data.companyId,
      actionDraftId: parsed.data.actionDraftId,
    })
    return NextResponse.json(executionTokenResponseSchema.parse(result), {
      headers: { "cache-control": "private, no-store" },
    })
  } catch (error) {
    const response = classifyWorkflowRpcError(
      error,
      "execution_token_reissue_failed"
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
