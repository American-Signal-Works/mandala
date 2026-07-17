import { randomUUID } from "node:crypto"
import { NextResponse } from "next/server"
import {
  sandboxSessionRequestSchema,
  sandboxSessionResponseSchema,
  sandboxWorkspaceSnapshotSchema,
} from "@workspace/control-plane"
import { getCompanyMembership } from "@/lib/mandala/workflows"
import {
  authenticateRequest,
  hasCliWorkspaceScope,
} from "@/lib/supabase/request"

export const runtime = "nodejs"

export async function POST(request: Request) {
  const auth = await authenticateRequest(request, { allowManagedCli: true })
  if (!auth) return sandboxJson({ error: "unauthorized" }, 401)

  const parsed = sandboxSessionRequestSchema.safeParse(await parseJson(request))
  if (!parsed.success)
    return sandboxJson(
      { error: "invalid_request", issues: parsed.error.flatten().fieldErrors },
      400
    )

  try {
    if (
      auth.authMode === "bearer" &&
      !hasCliWorkspaceScope(auth, parsed.data.companyId, "workspace:control")
    ) {
      return sandboxJson({ error: "forbidden" }, 403)
    }
    const membership = await getCompanyMembership({
      supabase: auth.supabase,
      companyId: parsed.data.companyId,
      userId: auth.user.id,
    })
    if (!membership) return sandboxJson({ error: "forbidden" }, 403)

    const snapshotResult = await auth.supabase.rpc(
      "get_sandbox_workspace_snapshot_v1",
      {
        p_company_id: parsed.data.companyId,
        p_candidate_limit: parsed.data.candidateLimit,
      }
    )
    if (snapshotResult.error)
      return sandboxJson({ error: "sandbox_snapshot_failed" }, 502)

    const snapshot = sandboxWorkspaceSnapshotSchema.safeParse(
      snapshotResult.data
    )
    if (!snapshot.success)
      return sandboxJson({ error: "sandbox_snapshot_invalid" }, 502)

    return sandboxJson(
      sandboxSessionResponseSchema.parse({
        ...snapshot.data,
        candidates: snapshot.data.candidates.map((candidate) => ({
          ...candidate,
          availableActions: sandboxActions(candidate.recommendation.status),
        })),
        sessionId: randomUUID(),
      })
    )
  } catch {
    return sandboxJson({ error: "sandbox_session_failed" }, 500)
  }
}

function sandboxActions(status: "ready_for_review" | "blocked" | "no_action") {
  if (status === "ready_for_review")
    return ["approve", "edit", "request_rework", "reject"] as const
  if (status === "blocked") return ["request_rework", "reject"] as const
  return [] as const
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
