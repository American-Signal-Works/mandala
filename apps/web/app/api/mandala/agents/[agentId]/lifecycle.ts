import { z } from "zod"
import {
  agentActionRequestSchema,
  agentActionResponseSchema,
} from "@workspace/control-plane"
import { AgentCapabilityResolutionError } from "@/lib/mandala/skills/capabilities"
import {
  activateAgentWorkflow,
  deactivateAgentWorkflow,
  rollbackAgentWorkflow,
} from "@/lib/mandala/skills/lifecycle"
import { getCompanyMembership } from "@/lib/mandala/workflows"
import { authenticateRequest } from "@/lib/supabase/request"
import { agentJson, canManageAgents, parseAgentJson } from "../http"

type LifecycleAction = "activate" | "deactivate" | "rollback"

export async function handleAgentLifecycleAction(
  request: Request,
  context: { params: Promise<{ agentId: string }> },
  action: LifecycleAction
) {
  const auth = await authenticateRequest(request)
  if (!auth) return agentJson({ error: "unauthorized" }, 401)
  const [{ agentId }, body] = await Promise.all([
    context.params,
    parseAgentJson(request),
  ])
  const id = z.string().uuid().safeParse(agentId)
  const parsed = agentActionRequestSchema.safeParse(body)
  if (!id.success || !parsed.success)
    return agentJson({ error: "invalid_request" }, 400)
  if (action === "rollback" && !parsed.data.version)
    return agentJson({ error: "rollback_version_required" }, 400)

  try {
    const membership = await getCompanyMembership({
      supabase: auth.supabase,
      companyId: parsed.data.companyId,
      userId: auth.user.id,
    })
    if (!membership || !canManageAgents(membership.role))
      return agentJson({ error: "forbidden" }, 403)
    const input = {
      supabase: auth.supabase,
      companyId: parsed.data.companyId,
      agentId: id.data,
    }
    const agent =
      action === "activate"
        ? await activateAgentWorkflow(input)
        : action === "deactivate"
          ? await deactivateAgentWorkflow(input)
          : await rollbackAgentWorkflow({
              ...input,
              version: parsed.data.version!,
            })
    return agentJson(agentActionResponseSchema.parse({ agent, action }))
  } catch (error) {
    return lifecycleError(error)
  }
}

function lifecycleError(error: unknown) {
  if (error instanceof AgentCapabilityResolutionError)
    return agentJson({ error: error.code }, 409)
  const message = error instanceof Error ? error.message : ""
  if (message.includes("not found") || message.includes("PGRST116"))
    return agentJson({ error: "agent_not_found" }, 404)
  if (
    message.includes("workflow_not_active") ||
    message.includes("stale_workflow_activation") ||
    message.includes("Agent is not active")
  )
    return agentJson({ error: "agent_state_conflict" }, 409)
  return agentJson({ error: "agent_lifecycle_failed" }, 500)
}
