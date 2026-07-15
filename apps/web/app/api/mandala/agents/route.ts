import {
  agentInstallRequestSchema,
  agentInstallResponseSchema,
  agentListRequestSchema,
  agentListResponseSchema,
} from "@workspace/control-plane"
import { resolveCompanyCompilerCapabilities } from "@/lib/mandala/skills/capabilities"
import { compileAgentSkill } from "@/lib/mandala/skills/compiler"
import {
  installAgentWorkflowVersion,
  listAgentSummaries,
} from "@/lib/mandala/skills/lifecycle"
import { getCompanyMembership } from "@/lib/mandala/workflows"
import { authenticateRequest } from "@/lib/supabase/request"
import { agentJson, canManageAgents, parseAgentJson } from "./http"

export const runtime = "nodejs"

export async function GET(request: Request) {
  const auth = await authenticateRequest(request)
  if (!auth) return agentJson({ error: "unauthorized" }, 401)
  const url = new URL(request.url)
  const parsed = agentListRequestSchema.safeParse({
    companyId: url.searchParams.get("companyId"),
  })
  if (!parsed.success) return agentJson({ error: "invalid_request" }, 400)

  try {
    const membership = await getCompanyMembership({
      supabase: auth.supabase,
      companyId: parsed.data.companyId,
      userId: auth.user.id,
    })
    if (!membership) return agentJson({ error: "forbidden" }, 403)
    const agents = await listAgentSummaries({
      supabase: auth.supabase,
      companyId: parsed.data.companyId,
    })
    return agentJson(agentListResponseSchema.parse({ agents }))
  } catch {
    return agentJson({ error: "agent_list_failed" }, 500)
  }
}

export async function POST(request: Request) {
  const auth = await authenticateRequest(request)
  if (!auth) return agentJson({ error: "unauthorized" }, 401)
  const parsed = agentInstallRequestSchema.safeParse(
    await parseAgentJson(request)
  )
  if (!parsed.success)
    return agentJson(
      { error: "invalid_request", issues: parsed.error.flatten().fieldErrors },
      400
    )
  if (parsed.data.activate)
    return agentJson(
      {
        error: "agent_test_required",
        message:
          "Install the agent inactive, run a Sandbox test, then activate it.",
      },
      409
    )

  try {
    const membership = await getCompanyMembership({
      supabase: auth.supabase,
      companyId: parsed.data.companyId,
      userId: auth.user.id,
    })
    if (!membership || !canManageAgents(membership.role))
      return agentJson({ error: "forbidden" }, 403)

    const capabilities = await resolveCompanyCompilerCapabilities({
      supabase: auth.supabase,
      companyId: parsed.data.companyId,
    })
    const compiled = compileAgentSkill({
      source: parsed.data.skillMarkdown,
      capabilities,
    })
    if (!compiled.ok)
      return agentJson(
        {
          error: "agent_validation_failed",
          diagnostics: compiled.diagnostics,
        },
        422
      )

    const agent = await installAgentWorkflowVersion({
      supabase: auth.supabase,
      companyId: parsed.data.companyId,
      source: parsed.data.skillMarkdown,
      manifest: compiled.manifest,
      diagnostics: compiled.diagnostics,
    })
    return agentJson(agentInstallResponseSchema.parse({ agent, created: true }))
  } catch (error) {
    if (isDuplicateVersion(error))
      return agentJson({ error: "agent_version_exists" }, 409)
    return agentJson({ error: "agent_install_failed" }, 500)
  }
}

function isDuplicateVersion(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.message.includes("duplicate key") || error.message.includes("23505"))
  )
}
