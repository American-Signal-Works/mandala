import { NextResponse } from "next/server"
import {
  executionRequestSchema,
  executionResponseSchema,
} from "@workspace/control-plane"
import { authenticateRequest } from "@/lib/supabase/request"
import {
  authorizeCompanyPermission,
  companyPermissionFailure,
} from "@/lib/mandala/authorization"
import { deriveControlInputHash } from "@/lib/mandala/control-plane/input-hash"
import type { Json } from "@/lib/supabase/types"
import {
  classifyWorkflowRpcError,
  executeMockWorkflowActionRpc,
} from "@/lib/mandala/workflows"

export async function POST(request: Request) {
  const auth = await authenticateRequest(request)
  if (!auth)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const { authMode, supabase, user } = auth

  const parsed = executionRequestSchema.safeParse(await parseJson(request))
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", issues: parsed.error.flatten().fieldErrors },
      { status: 400 }
    )
  }

  const permissionFailure = companyPermissionFailure(
    await authorizeCompanyPermission({
      supabase,
      companyId: parsed.data.companyId,
      userId: user.id,
      permission: "workflow.execution.mock",
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
    const result = await executeMockWorkflowActionRpc({
      supabase,
      companyId: parsed.data.companyId,
      actionDraftId: parsed.data.actionDraftId,
      decisionId: parsed.data.decisionId,
      rawToken: parsed.data.rawToken,
      idempotencyKey: parsed.data.idempotencyKey,
      payload: parsed.data.payload as Json,
      inputHash:
        parsed.data.control?.inputHash ??
        deriveControlInputHash("execute_mock_action", {
          actionDraftId: parsed.data.actionDraftId,
          companyId: parsed.data.companyId,
          decisionId: parsed.data.decisionId,
          idempotencyKey: parsed.data.idempotencyKey,
        }),
      clientSurface: authMode === "bearer" ? "cli" : "web",
      controlRequestId: parsed.data.control?.controlRequestId,
    })
    return NextResponse.json(executionResponseSchema.parse(result), {
      headers: { "cache-control": "private, no-store" },
    })
  } catch (error) {
    const response = classifyWorkflowRpcError(error, "execution_failed")
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
