import {
  decisionRequestSchema,
  decisionResponseSchema,
} from "@workspace/control-plane"
import { authenticateRequest } from "@/lib/supabase/request"
import type { Json } from "@/lib/supabase/types"
import { recordWorkflowDecisionV2 } from "@/lib/mandala/control-plane/queries"
import { controlPlaneErrorResponse, privateJson } from "../control-plane-http"

export async function POST(request: Request) {
  const auth = await authenticateRequest(request)
  if (!auth) return privateJson({ error: "unauthorized" }, 401)
  const { supabase } = auth

  const parsed = decisionRequestSchema.safeParse(await parseJson(request))
  if (!parsed.success) {
    return privateJson(
      { error: "invalid_request", issues: parsed.error.flatten().fieldErrors },
      400
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
