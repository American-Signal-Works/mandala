import {
  agentValidateRequestSchema,
  agentValidateResponseSchema,
} from "@workspace/control-plane"
import { getCompanyMembership } from "@/lib/mandala/workflows"
import { resolveCompanyCompilerCapabilities } from "@/lib/mandala/skills/capabilities"
import { compileAgentSkill } from "@/lib/mandala/skills/compiler"
import { allowsCliWorkspace, authenticateRequest } from "@/lib/supabase/request"
import { agentJson, parseAgentJson } from "../http"

export const runtime = "nodejs"

export async function POST(request: Request) {
  const auth = await authenticateRequest(request, { allowManagedCli: true })
  if (!auth) return agentJson({ error: "unauthorized" }, 401)

  const body = await parseAgentJson(request)
  const parsed = agentValidateRequestSchema.safeParse(body)
  if (!parsed.success) {
    return agentJson(
      { error: "invalid_request", issues: parsed.error.flatten().fieldErrors },
      400
    )
  }
  if (!allowsCliWorkspace(auth, parsed.data.companyId)) {
    return agentJson({ error: "forbidden" }, 403)
  }

  let membership: Awaited<ReturnType<typeof getCompanyMembership>>
  let capabilities: Awaited<
    ReturnType<typeof resolveCompanyCompilerCapabilities>
  >
  try {
    const loaded = await Promise.all([
      getCompanyMembership({
        supabase: auth.supabase,
        companyId: parsed.data.companyId,
        userId: auth.user.id,
      }),
      resolveCompanyCompilerCapabilities({
        supabase: auth.supabase,
        companyId: parsed.data.companyId,
      }),
    ])
    membership = loaded[0]
    capabilities = loaded[1]
  } catch {
    return agentJson({ error: "agent_validation_unavailable" }, 500)
  }
  if (!membership) return agentJson({ error: "forbidden" }, 403)

  const result = compileAgentSkill({
    source: parsed.data.skillMarkdown,
    capabilities,
  })
  if (!result.ok) {
    return agentJson(
      agentValidateResponseSchema.parse({
        valid: false,
        diagnostics: result.diagnostics,
        preview: null,
      })
    )
  }

  return agentJson(
    agentValidateResponseSchema.parse({
      valid: true,
      diagnostics: result.diagnostics,
      preview: {
        workflowKey: result.manifest.identity.id,
        workflowType: result.manifest.workflow.type,
        name: result.manifest.identity.name,
        version: result.manifest.identity.version,
        sourceDigest: result.manifest.sourceDigest,
        manifestDigest: result.manifest.manifestDigest,
        graph: result.manifest.graph,
        capabilities: result.manifest.capabilityBindings.map((binding) => ({
          id: binding.id,
          alias: binding.alias,
          access: binding.access,
          version: binding.version,
          connectorId: binding.connectorId,
          status: "resolved" as const,
        })),
      },
    })
  )
}
