import { NextResponse } from "next/server"
import {
  contextWorkspaceConfigurationRequestSchema,
  contextWorkspaceStatusRequestSchema,
} from "@workspace/control-plane"
import {
  ContextWorkspaceSettingsError,
  getContextWorkspaceStatus,
  setContextWorkspaceConfiguration,
} from "@/lib/mandala/context"
import { getCompanyMembership } from "@/lib/mandala/workflows"
import { allowsCliWorkspace, authenticateRequest } from "@/lib/supabase/request"

export const runtime = "nodejs"

export async function GET(request: Request) {
  const auth = await authenticateRequest(request, { allowManagedCli: true })
  if (!auth) return contextJson({ error: "unauthorized" }, 401)

  const url = new URL(request.url)
  const parsed = contextWorkspaceStatusRequestSchema.safeParse({
    companyId: url.searchParams.get("companyId"),
  })
  if (!parsed.success) return contextJson({ error: "invalid_request" }, 400)
  if (!allowsCliWorkspace(auth, parsed.data.companyId, "workspace:control"))
    return contextJson({ error: "forbidden" }, 403)

  try {
    const membership = await getCompanyMembership({
      supabase: auth.supabase,
      companyId: parsed.data.companyId,
      userId: auth.user.id,
    })
    if (!membership) return contextJson({ error: "forbidden" }, 403)

    const status = await getContextWorkspaceStatus({
      supabase: auth.supabase,
      companyId: parsed.data.companyId,
    })
    return contextJson(status)
  } catch (error) {
    return handleContextError(error, "context_workspace_settings_failed")
  }
}

export async function PATCH(request: Request) {
  const auth = await authenticateRequest(request, { allowManagedCli: true })
  if (!auth) return contextJson({ error: "unauthorized" }, 401)

  const parsed = contextWorkspaceConfigurationRequestSchema.safeParse(
    await parseJson(request)
  )
  if (!parsed.success) {
    return contextJson(
      { error: "invalid_request", issues: parsed.error.flatten().fieldErrors },
      400
    )
  }
  if (!allowsCliWorkspace(auth, parsed.data.companyId, "workspace:control"))
    return contextJson({ error: "forbidden" }, 403)

  try {
    const membership = await getCompanyMembership({
      supabase: auth.supabase,
      companyId: parsed.data.companyId,
      userId: auth.user.id,
    })
    if (
      !membership ||
      (membership.role !== "owner" && membership.role !== "admin")
    ) {
      return contextJson({ error: "forbidden" }, 403)
    }

    const status = await setContextWorkspaceConfiguration({
      supabase: auth.supabase,
      request: parsed.data,
    })
    return contextJson(status)
  } catch (error) {
    return handleContextError(error, "context_workspace_configuration_failed")
  }
}

function handleContextError(error: unknown, fallback: string) {
  if (!(error instanceof ContextWorkspaceSettingsError)) {
    return contextJson({ error: fallback }, 500)
  }
  const status = contextErrorStatus(error.code)
  return contextJson({ error: error.code }, status)
}

function contextErrorStatus(code: string): number {
  if (code === "context_workspace_configuration_not_found") return 404
  if (code === "stale_context_workspace_configuration") return 409
  if (
    code === "context_workspace_configuration_unchanged" ||
    code === "invalid_context_workspace_configuration"
  ) {
    return 400
  }
  return 500
}

function contextJson(body: unknown, status = 200) {
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
