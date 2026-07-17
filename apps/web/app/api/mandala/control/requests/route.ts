import { NextResponse } from "next/server"
import {
  controlRequestCreateRequestSchema,
  controlRequestCreateResponseSchema,
} from "@workspace/control-plane"
import type { Json } from "@/lib/supabase/types"
import {
  authorizeCompanyPermission,
  companyPermissionFailure,
} from "@/lib/mandala/authorization"
import {
  classifyWorkflowRpcError,
  recordWorkflowControlRequestRpc,
} from "@/lib/mandala/workflows"
import { allowsCliWorkspace, authenticateRequest } from "@/lib/supabase/request"

export async function POST(request: Request) {
  const auth = await authenticateRequest(request, { allowManagedCli: true })
  if (!auth)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const parsed = controlRequestCreateRequestSchema.safeParse(
    await parseJson(request)
  )
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", issues: parsed.error.flatten().fieldErrors },
      { status: 400 }
    )
  }
  if (!allowsCliWorkspace(auth, parsed.data.companyId)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 })
  }
  if (
    parsed.data.resolutionStatus === "executed" &&
    parsed.data.riskClass !== "read"
  ) {
    return NextResponse.json(
      { error: "controlled_mutation_required" },
      { status: 400 }
    )
  }

  const permissionFailure = companyPermissionFailure(
    await authorizeCompanyPermission({
      supabase: auth.supabase,
      companyId: parsed.data.companyId,
      userId: auth.user.id,
      permission: "workflow.read",
    })
  )
  if (permissionFailure) {
    return NextResponse.json(
      { error: permissionFailure.code },
      {
        status: permissionFailure.status,
        headers: { "cache-control": "private, no-store" },
      }
    )
  }

  try {
    const controlRequest = await recordWorkflowControlRequestRpc({
      supabase: auth.supabase,
      companyId: parsed.data.companyId,
      clientSurface: auth.authMode === "bearer" ? "cli" : "web",
      inputHash: parsed.data.inputHash,
      normalizedIntent: parsed.data.normalizedIntent as Json,
      parserKind: parsed.data.parserKind,
      resolutionStatus: parsed.data.resolutionStatus,
      riskClass: parsed.data.riskClass,
      workflowRunId: parsed.data.workflowRunId,
      workflowItemId: parsed.data.workflowItemId,
    })
    return NextResponse.json(
      controlRequestCreateResponseSchema.parse({ request: controlRequest }),
      { headers: { "cache-control": "private, no-store" } }
    )
  } catch (error) {
    const response = classifyWorkflowRpcError(error, "control_request_failed")
    return NextResponse.json(
      { error: response.code },
      { status: response.status }
    )
  }
}

async function parseJson(request: Request): Promise<unknown> {
  try {
    return await request.json()
  } catch {
    return null
  }
}
