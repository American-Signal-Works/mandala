import { NextResponse } from "next/server"
import {
  workspaceSandboxRunRequestSchema,
  workspaceSandboxRunResponseSchema,
} from "@workspace/control-plane"
import { createPersistenceVerificationAdminClient } from "@/actions/admin/persistence-verification"
import { getCompanyMembership } from "@/lib/mandala/workflows"
import { runWorkspaceSandboxGoldenPath } from "@/lib/mandala/workspace-data/sandbox-runner"
import { WorkspaceDataProviderError } from "@/lib/mandala/workspace-data/provider"
import { WorkspaceSetupError } from "@/lib/mandala/workspace-data/setup"
import {
  authenticateRequest,
  hasCliWorkspaceScope,
} from "@/lib/supabase/request"

export const runtime = "nodejs"
export const maxDuration = 60

export async function POST(request: Request) {
  const auth = await authenticateRequest(request, { allowManagedCli: true })
  if (!auth) return sandboxJson({ error: "unauthorized" }, 401)
  const parsed = workspaceSandboxRunRequestSchema.safeParse(
    await parseJson(request)
  )
  if (!parsed.success) {
    return sandboxJson(
      { error: "invalid_request", issues: parsed.error.flatten().fieldErrors },
      400
    )
  }
  if (
    auth.authMode === "bearer" &&
    !hasCliWorkspaceScope(auth, parsed.data.companyId, "workspace:control")
  ) {
    return sandboxJson({ error: "forbidden" }, 403)
  }

  try {
    const membership = await getCompanyMembership({
      supabase: auth.supabase,
      companyId: parsed.data.companyId,
      userId: auth.user.id,
    })
    if (!membership || !new Set(["owner", "admin"]).has(membership.role)) {
      return sandboxJson({ error: "forbidden" }, 403)
    }
    const result = await runWorkspaceSandboxGoldenPath({
      supabase: auth.supabase,
      proofSupabase: createPersistenceVerificationAdminClient(),
      companyId: parsed.data.companyId,
      actorUserId: auth.user.id,
      skillMarkdown: parsed.data.skillMarkdown,
      confirmMappings: parsed.data.confirmMappings,
    })
    return sandboxJson(workspaceSandboxRunResponseSchema.parse(result))
  } catch (error) {
    if (error instanceof WorkspaceSetupError) {
      console.error("Workspace Sandbox setup failed.", error)
      const status = error.code === "mapping_confirmation_required" ? 409 : 422
      return sandboxJson({ error: error.code, message: error.message }, status)
    }
    if (error instanceof WorkspaceDataProviderError) {
      return sandboxJson({ error: error.code, message: error.message }, 409)
    }
    console.error("Workspace Sandbox run failed.", error)
    return sandboxJson({ error: "workspace_sandbox_run_failed" }, 500)
  }
}

function sandboxJson(body: unknown, status = 200) {
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
