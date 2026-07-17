import {
  decisionRequestSchema,
  decisionResponseSchema,
  permissionForWorkflowDecision,
} from "@workspace/control-plane"
import { allowsCliWorkspace, authenticateRequest } from "@/lib/supabase/request"
import {
  authorizeCompanyPermission,
  companyPermissionFailure,
} from "@/lib/mandala/authorization"
import type { Json } from "@/lib/supabase/types"
import { recordWorkflowDecisionV2 } from "@/lib/mandala/control-plane/queries"
import { controlPlaneErrorResponse, privateJson } from "../control-plane-http"

export async function POST(request: Request) {
  const auth = await authenticateRequest(request, { allowManagedCli: true })
  if (!auth) return privateJson({ error: "unauthorized" }, 401)
  const { supabase, user } = auth

  const parsed = decisionRequestSchema.safeParse(await parseJson(request))
  if (!parsed.success) {
    return privateJson(
      { error: "invalid_request", issues: parsed.error.flatten().fieldErrors },
      400
    )
  }
  if (!allowsCliWorkspace(auth, parsed.data.companyId)) {
    return privateJson({ error: "forbidden" }, 403)
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
    return privateJson(
      { error: permissionFailure.code },
      permissionFailure.status
    )
  }

  try {
    const result = await recordWorkflowDecisionV2({
      supabase,
      companyId: parsed.data.companyId,
      workItemId: parsed.data.workItemId,
      actionDraftId: parsed.data.actionDraftId,
      decision: parsed.data.decision,
      expectedVersion: parsed.data.expectedVersion,
      idempotencyKey: parsed.data.idempotencyKey,
      reason: parsed.data.reason,
      warningsAcknowledged: parsed.data.warningsAcknowledged,
      editedPayload: parsed.data.editedPayload as Json | undefined,
    })
    return privateJson(decisionResponseSchema.parse(result))
  } catch (error) {
    return controlPlaneErrorResponse(error, "decision_failed")
  }
}

async function parseJson(request: Request): Promise<unknown> {
  try {
    return await request.json()
  } catch {
    return null
  }
}
