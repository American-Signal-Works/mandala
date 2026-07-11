import { createHash, createHmac, randomBytes } from "node:crypto"
import { NextResponse } from "next/server"
import {
  controlParseRequestSchema,
  controlParseResponseSchema,
  projectControlIntentForAudit,
  type ControlIntent,
  type ControlOutcome,
  type NormalizedControlIntent,
} from "@workspace/control-plane"
import {
  ConversationalParserUnavailableError,
  parseConversationalControlInput,
} from "@/lib/mandala/control-plane/conversational-parser"
import {
  authorizeCompanyPermission,
  companyPermissionFailure,
} from "@/lib/mandala/authorization"
import {
  acquireWorkflowControlParserLeaseRpc,
  classifyWorkflowRpcError,
  recordWorkflowControlRequestRpc,
  recordWorkflowControlRequestWithBindingRpc,
  releaseWorkflowControlParserLeaseRpc,
  WorkflowRpcError,
} from "@/lib/mandala/workflows"
import { authenticateRequest } from "@/lib/supabase/request"
import type { Json } from "@/lib/supabase/types"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const configuredInputHashKey =
  process.env.MANDALA_CONTROL_INPUT_HASH_KEY?.trim()
const inputHashKey =
  configuredInputHashKey && configuredInputHashKey.length >= 32
    ? Buffer.from(configuredInputHashKey, "utf8")
    : randomBytes(32)

export async function POST(request: Request) {
  const auth = await authenticateRequest(request)
  if (!auth)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const parsed = controlParseRequestSchema.safeParse(await parseJson(request))
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", issues: parsed.error.flatten().fieldErrors },
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

  const inputHash = createHmac("sha256", inputHashKey)
    .update(parsed.data.companyId)
    .update("\u0000")
    .update(parsed.data.input, "utf8")
    .digest("hex")
  const serverToken = parserBindingServerToken()
  if (!serverToken) {
    await recordFailure({
      auth,
      companyId: parsed.data.companyId,
      inputHash,
    }).catch(() => undefined)
    return NextResponse.json(
      { error: "parser_unavailable" },
      {
        status: 503,
        headers: { "cache-control": "private, no-store" },
      }
    )
  }

  let lease
  try {
    lease = await acquireWorkflowControlParserLeaseRpc({
      supabase: auth.supabase,
      companyId: parsed.data.companyId,
    })
  } catch (error) {
    const response = classifyWorkflowRpcError(error, "parser_lease_failed")
    return NextResponse.json(
      { error: response.code },
      {
        status: response.status,
        headers: { "cache-control": "private, no-store" },
      }
    )
  }

  try {
    try {
      const result = await parseConversationalControlInput({
        companyId: parsed.data.companyId,
        phrase: parsed.data.input,
      })
      const controlRequest = await recordOutcome({
        auth,
        companyId: parsed.data.companyId,
        inputHash,
        outcome: result.outcome,
        parserKind: result.parserKind,
        serverToken,
        langSmithTraceId: result.trace?.traceId,
        langSmithRunId: result.trace?.runId,
      })

      return NextResponse.json(
        controlParseResponseSchema.parse({
          ...result,
          controlRequestId: controlRequest.id,
        }),
        { headers: { "cache-control": "private, no-store" } }
      )
    } catch (error) {
      if (error instanceof ConversationalParserUnavailableError) {
        await recordFailure({
          auth,
          companyId: parsed.data.companyId,
          inputHash,
          langSmithTraceId: error.trace?.traceId,
          langSmithRunId: error.trace?.runId,
        }).catch(() => undefined)
        return NextResponse.json(
          { error: "parser_unavailable" },
          {
            status: 503,
            headers: { "cache-control": "private, no-store" },
          }
        )
      }
      if (
        error instanceof WorkflowRpcError &&
        error.rpcCode === "parser_binding_forbidden"
      ) {
        await recordFailure({
          auth,
          companyId: parsed.data.companyId,
          inputHash,
        }).catch(() => undefined)
        return NextResponse.json(
          { error: "parser_unavailable" },
          {
            status: 503,
            headers: { "cache-control": "private, no-store" },
          }
        )
      }
      return NextResponse.json(
        { error: "control_parse_failed" },
        {
          status: 500,
          headers: { "cache-control": "private, no-store" },
        }
      )
    }
  } finally {
    await releaseWorkflowControlParserLeaseRpc({
      supabase: auth.supabase,
      companyId: parsed.data.companyId,
      leaseId: lease.leaseId,
    }).catch(() => undefined)
  }
}

async function recordOutcome(input: {
  auth: Awaited<ReturnType<typeof authenticateRequest>> & {}
  companyId: string
  inputHash: string
  outcome: ControlOutcome
  parserKind: "deterministic" | "langchain"
  serverToken: string
  langSmithTraceId?: string
  langSmithRunId?: string
}) {
  const normalizedIntent: NormalizedControlIntent =
    input.outcome.status === "resolved"
      ? projectControlIntentForAudit(input.outcome.intent)
      : {
          kind: "unresolved",
          outcome: input.outcome.status,
        }
  const common = {
    supabase: input.auth.supabase,
    companyId: input.companyId,
    clientSurface:
      input.auth.authMode === "bearer" ? ("cli" as const) : ("web" as const),
    inputHash: input.inputHash,
    normalizedIntent: normalizedIntent as Json,
    parserKind: input.parserKind,
    workflowItemId:
      input.outcome.status === "resolved" && "itemId" in input.outcome.intent
        ? input.outcome.intent.itemId
        : undefined,
    langsmithTraceId: input.langSmithTraceId,
    langsmithRunId: input.langSmithRunId,
  }
  if (
    input.outcome.status === "resolved" &&
    input.outcome.intent.risk !== "read"
  ) {
    return recordWorkflowControlRequestWithBindingRpc({
      ...common,
      bindingIntent: projectControlIntentForBinding(
        input.outcome.intent
      ) as Json,
      serverToken: input.serverToken,
      resolutionStatus: "resolved",
      riskClass: input.outcome.intent.risk,
    })
  }
  return recordWorkflowControlRequestRpc({
    ...common,
    resolutionStatus: input.outcome.status,
    riskClass:
      input.outcome.status === "resolved" ? input.outcome.intent.risk : "read",
  })
}

function parserBindingServerToken(): string | null {
  const secret = process.env.MANDALA_CONTROL_BINDING_SECRET?.trim()
  if (!secret || secret.length < 32) return null
  return createHash("sha256").update(secret, "utf8").digest("hex")
}

function projectControlIntentForBinding(intent: ControlIntent) {
  switch (intent.kind) {
    case "run_fixture":
      return {
        kind: intent.kind,
        companyId: intent.companyId,
        scenarioId: intent.scenarioId,
      }
    case "record_decision":
      return {
        kind: intent.kind,
        companyId: intent.companyId,
        itemId: intent.itemId,
        decision: intent.decision,
        patches: [...(intent.patches ?? [])].sort((left, right) =>
          left.pointer.localeCompare(right.pointer)
        ),
        warningsAcknowledged: intent.warningsAcknowledged,
      }
    case "execute_mock_action":
      return {
        kind: intent.kind,
        companyId: intent.companyId,
        itemId: intent.itemId,
      }
    case "list_work_items":
    case "inspect_work_item":
      throw new Error("Read intents do not require a private binding.")
  }
}

async function recordFailure(input: {
  auth: Awaited<ReturnType<typeof authenticateRequest>> & {}
  companyId: string
  inputHash: string
  langSmithTraceId?: string
  langSmithRunId?: string
}) {
  return recordWorkflowControlRequestRpc({
    supabase: input.auth.supabase,
    companyId: input.companyId,
    clientSurface: input.auth.authMode === "bearer" ? "cli" : "web",
    inputHash: input.inputHash,
    normalizedIntent: {
      kind: "unresolved",
      outcome: "failed",
    } as Json,
    parserKind: "langchain",
    resolutionStatus: "failed",
    riskClass: "read",
    langsmithTraceId: input.langSmithTraceId,
    langsmithRunId: input.langSmithRunId,
  })
}

async function parseJson(request: Request): Promise<unknown> {
  try {
    return await request.json()
  } catch {
    return null
  }
}
