import { NextResponse } from "next/server"
import {
  agentManualRunBatchResponseSchema,
  agentManualRunRequestSchema,
  agentManualRunResponseSchema,
} from "@workspace/control-plane"
import {
  ManualRunAgentNotActiveError,
  runManualAgentTrigger,
  runManualAgentTriggerBatch,
} from "@/lib/mandala/agents"
import { WorkspaceDataProviderError } from "@/lib/mandala/workspace-data/provider"
import { createWorkspaceDataAdminClient } from "@/actions/admin/workspace-data"
import { getCompanyMembership } from "@/lib/mandala/workflows"
import { allowsCliWorkspace, authenticateRequest } from "@/lib/supabase/request"

export const runtime = "nodejs"
export const maxDuration = 300

// Fires an active agent's declared `manual` trigger against real, cataloged
// company data and persists the result as a reviewable work item. Distinct
// from /sandbox/runs (always a zero-write proof, requires an inactive agent)
// and /agents/[agentId]/test-runs (persists, but only against synthetic data).
// With allMatching, runs every qualifying entity (bounded by limit) instead
// of first-match only — one persisted work item per entity.

export async function POST(
  request: Request,
  context: { params: Promise<{ agentId: string }> }
) {
  const auth = await authenticateRequest(request, { allowManagedCli: true })
  if (!auth) return manualRunJson({ error: "unauthorized" }, 401)
  const [body, params] = await Promise.all([parseJson(request), context.params])
  const parsed = agentManualRunRequestSchema.safeParse(body)
  const agentId = params.agentId
  if (!parsed.success || !isUuid(agentId)) {
    return manualRunJson(
      {
        error: "invalid_request",
        issues: parsed.success
          ? { agentId: ["Invalid agent ID"] }
          : parsed.error.flatten().fieldErrors,
      },
      400
    )
  }
  if (!allowsCliWorkspace(auth, parsed.data.companyId)) {
    return manualRunJson({ error: "forbidden" }, 403)
  }

  let membership
  try {
    membership = await getCompanyMembership({
      supabase: auth.supabase,
      companyId: parsed.data.companyId,
      userId: auth.user.id,
    })
  } catch {
    return manualRunJson({ error: "membership_lookup_failed" }, 500)
  }
  if (!membership || !canRunAgent(membership.role)) {
    return manualRunJson({ error: "forbidden" }, 403)
  }

  try {
    const runInput = {
      supabase: auth.supabase,
      dataSupabase: createWorkspaceDataAdminClient(),
      agentId,
      request: parsed.data,
      actorUserId: auth.user.id,
      clientSurface: (auth.authMode === "bearer" ? "cli" : "web") as
        | "cli"
        | "web",
    }
    if (parsed.data.allMatching) {
      const result = await runManualAgentTriggerBatch(runInput)
      return manualRunJson(agentManualRunBatchResponseSchema.parse(result))
    }
    const result = await runManualAgentTrigger(runInput)
    return manualRunJson(agentManualRunResponseSchema.parse(result))
  } catch (error) {
    if (error instanceof ManualRunAgentNotActiveError) {
      return manualRunJson(
        { error: "agent_not_active", lifecycleState: error.lifecycleState },
        409
      )
    }
    if (error instanceof WorkspaceDataProviderError) {
      return manualRunJson({ error: error.code, message: error.message }, 409)
    }
    console.error("Manual agent trigger run failed.", error)
    return manualRunJson({ error: "manual_run_failed" }, 500)
  }
}

function canRunAgent(role: string): boolean {
  return role === "owner" || role === "admin"
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  )
}

function manualRunJson(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "cache-control": "private, no-store" },
  })
}

async function parseJson(request: Request): Promise<unknown> {
  try {
    return await request.json()
  } catch {
    return null
  }
}
