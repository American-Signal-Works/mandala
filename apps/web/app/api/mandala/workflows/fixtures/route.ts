import { NextResponse } from "next/server"
import {
  fixtureRunRequestSchema as sharedFixtureRunRequestSchema,
  fixtureRunResponseSchema,
} from "@workspace/control-plane"
import { z } from "zod"
import { authenticateRequest } from "@/lib/supabase/request"
import {
  authorizeCompanyPermission,
  companyPermissionFailure,
} from "@/lib/mandala/authorization"
import { deriveControlInputHash } from "@/lib/mandala/control-plane/input-hash"
import {
  WorkflowMemoryStore,
  classifyWorkflowRpcError,
  persistFixtureRun,
  runProcurementFixtureScenario,
} from "@/lib/mandala/workflows"

const fixtureScenarioSchema = z.enum([
  "clean_reorder",
  "sales_spike_warning",
  "duplicate_open_order",
  "stale_inventory",
  "no_action",
  "edit_reorder",
  "reject_reorder",
])
const fixtureRunRequestSchema = sharedFixtureRunRequestSchema.extend({
  scenarioId: fixtureScenarioSchema,
})

export async function POST(request: Request) {
  const auth = await authenticateRequest(request)
  if (!auth)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const { authMode, supabase, user } = auth

  const body = await parseJson(request)
  const parsed = fixtureRunRequestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "invalid_request",
        issues: parsed.error.flatten().fieldErrors,
      },
      { status: 400 }
    )
  }

  const permissionFailure = companyPermissionFailure(
    await authorizeCompanyPermission({
      supabase,
      companyId: parsed.data.companyId,
      userId: user.id,
      permission: "workflow.fixture.run",
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

  const store = new WorkflowMemoryStore()
  const result = runProcurementFixtureScenario({
    store,
    companyId: parsed.data.companyId,
    actorUserId: user.id,
    scenarioId: parsed.data.scenarioId,
  })

  try {
    const persistence = await persistFixtureRun({
      supabase,
      result,
      inputHash:
        parsed.data.control?.inputHash ??
        deriveControlInputHash("run_fixture", {
          companyId: parsed.data.companyId,
          scenarioId: parsed.data.scenarioId,
        }),
      clientSurface: authMode === "bearer" ? "cli" : "web",
      controlRequestId: parsed.data.control?.controlRequestId,
    })
    if (persistence.duplicate) {
      return NextResponse.json(
        fixtureRunResponseSchema.parse({
          duplicate: true,
          workflowRun: persistence.run,
          eventId: persistence.eventId,
          itemId: persistence.itemId ?? null,
        }),
        { headers: { "cache-control": "private, no-store" } }
      )
    }
  } catch (error) {
    const response = classifyWorkflowRpcError(error, "fixture_persist_failed")
    return NextResponse.json(
      { error: response.code },
      { status: response.status }
    )
  }

  return NextResponse.json(
    fixtureRunResponseSchema.parse({
      duplicate: false,
      workflowRun: result.run,
      event: result.event,
      item: result.item,
      recommendation: result.recommendation,
      draft: result.draft,
      auditEvents: result.auditEvents,
    }),
    { headers: { "cache-control": "private, no-store" } }
  )
}

async function parseJson(request: Request): Promise<unknown> {
  try {
    return await request.json()
  } catch {
    return null
  }
}
