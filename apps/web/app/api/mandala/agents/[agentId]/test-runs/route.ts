import { NextResponse } from "next/server"
import {
  agentTestRunRequestSchema,
  agentTestRunResponseSchema,
} from "@workspace/control-plane"
import {
  recordAgentTestReadiness,
  runSyntheticAgentTest,
} from "@/lib/mandala/agents"
import {
  classifyWorkflowRpcError,
  getCompanyMembership,
} from "@/lib/mandala/workflows"
import { authenticateRequest } from "@/lib/supabase/request"
import { createServerModelUsageRecorder } from "@/actions/admin/provider-usage"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(
  request: Request,
  context: { params: Promise<{ agentId: string }> }
) {
  const auth = await authenticateRequest(request)
  if (!auth) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }
  const [body, params] = await Promise.all([parseJson(request), context.params])
  const parsed = agentTestRunRequestSchema.safeParse(body)
  const agentId = params.agentId
  if (!parsed.success || !isUuid(agentId)) {
    return NextResponse.json(
      {
        error: "invalid_request",
        issues: parsed.success
          ? { agentId: ["Invalid agent ID"] }
          : parsed.error.flatten().fieldErrors,
      },
      { status: 400 }
    )
  }

  let membership
  try {
    membership = await getCompanyMembership({
      supabase: auth.supabase,
      companyId: parsed.data.companyId,
      userId: auth.user.id,
    })
  } catch {
    return NextResponse.json(
      { error: "membership_lookup_failed" },
      { status: 500 }
    )
  }
  if (!membership || !canTestAgent(membership.role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 })
  }

  try {
    const result = await runSyntheticAgentTest({
      supabase: auth.supabase,
      agentId,
      request: parsed.data,
      actorUserId: auth.user.id,
      clientSurface: auth.authMode === "bearer" ? "cli" : "web",
      dependencies: {
        recordUsage: createServerModelUsageRecorder({
          companyId: parsed.data.companyId,
          actorUserId: auth.user.id,
          sourceOperation: "mandala.agent.synthetic_test",
        }),
      },
    })
    await recordAgentTestReadiness({
      supabase: auth.supabase,
      companyId: parsed.data.companyId,
      agentId,
      result,
    })
    return NextResponse.json(agentTestRunResponseSchema.parse(result), {
      headers: { "cache-control": "private, no-store" },
    })
  } catch (error) {
    const response = classifyWorkflowRpcError(error, "agent_test_failed")
    return NextResponse.json(
      { error: response.code },
      { status: response.status }
    )
  }
}

function canTestAgent(role: string): boolean {
  return role === "owner" || role === "admin"
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  )
}

async function parseJson(request: Request): Promise<unknown> {
  try {
    return await request.json()
  } catch {
    return null
  }
}
