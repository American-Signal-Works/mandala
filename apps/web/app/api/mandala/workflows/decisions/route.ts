import { NextResponse } from "next/server"
import {
  decisionRequestSchema,
  decisionResponseSchema,
  permissionForWorkflowDecision,
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
  recordWorkflowDecisionRpc,
} from "@/lib/mandala/workflows"

export async function POST(request: Request) {
  const auth = await authenticateRequest(request)
  if (!auth)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const { authMode, supabase, user } = auth

  const parsed = decisionRequestSchema.safeParse(await parseJson(request))
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
      permission: permissionForWorkflowDecision(parsed.data.decision),
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
    const result = await recordWorkflowDecisionRpc({
      supabase,
      companyId: parsed.data.companyId,
      actionDraftId: parsed.data.actionDraftId,
      decision: parsed.data.decision,
      reason: parsed.data.reason,
      warningsAcknowledged: parsed.data.warningsAcknowledged,
      editedPayload: parsed.data.editedPayload as Json | undefined,
      inputHash:
        parsed.data.control?.inputHash ??
        deriveControlInputHash("record_decision", {
          actionDraftId: parsed.data.actionDraftId,
          companyId: parsed.data.companyId,
          decision: parsed.data.decision,
          warningsAcknowledged: parsed.data.warningsAcknowledged,
        }),
      clientSurface: authMode === "bearer" ? "cli" : "web",
      controlRequestId: parsed.data.control?.controlRequestId,
    })
    return NextResponse.json(decisionResponseSchema.parse(result), {
      headers: { "cache-control": "private, no-store" },
    })
  } catch (error) {
    const response = classifyWorkflowRpcError(error, "decision_failed")
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
