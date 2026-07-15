import { z } from "zod"
import type { Json } from "@/lib/supabase/types"
import {
  createActionDispatcher,
  createBoundedJsonSchemaValidator,
  createSimulationAdapter,
  ExecutorRegistry,
  stableHash,
  type ActionExecutionRequest,
  type ActionExecutionResult,
  type ExecutionPolicySnapshot,
  type ExecutionReceiptStore,
  type ReceiptStart,
} from "../actions"
import {
  WorkflowRpcError,
  executeMockWorkflowActionRpc,
  type WorkflowClientSurface,
  type WorkflowExecutionRpcResult,
  type WorkflowSupabaseClient,
} from "./persistence"

const policySchema = z
  .object({
    allowed: z.boolean(),
    reason: z.string().nullable(),
    lifecycleState: z.string(),
    agentConfigVersion: z.number().int().positive(),
    lifecycleVersion: z.number().int().positive(),
    policyVersion: z.number().int().positive(),
    bindingVersion: z.number().int().positive(),
    capabilityGranted: z.boolean(),
    connectorHealthy: z.boolean(),
    approvalValid: z.boolean(),
  })
  .strict()

const registeredContextSchema = z
  .object({
    kind: z.literal("registered"),
    companyId: z.string().uuid(),
    agentId: z.string().uuid(),
    workflowRunId: z.string().uuid(),
    itemId: z.string().uuid(),
    actionDraftId: z.string().uuid(),
    decisionId: z.string().uuid(),
    actionId: z.string().min(1),
    actionVersion: z.string().min(1),
    capabilityId: z.string().min(1),
    capabilityVersion: z.string().min(1),
    connectorId: z.string().min(1),
    schemaDigest: z.string().min(1),
    mode: z.enum(["fixture", "dry_run", "shadow"]),
    allowedModes: z.array(z.enum(["fixture", "dry_run", "shadow"])),
    timeoutMs: z.number().int().positive(),
    retryClass: z.string(),
    inputSchema: z.record(z.string(), z.unknown()),
    outputSchema: z.record(z.string(), z.unknown()),
    input: z.record(z.string(), z.unknown()),
    approvalId: z.string().uuid(),
    expected: z
      .object({
        agentConfigVersion: z.number().int().positive(),
        lifecycleVersion: z.number().int().positive(),
        policyVersion: z.number().int().positive(),
        bindingVersion: z.number().int().positive(),
      })
      .strict(),
    policy: policySchema,
  })
  .strict()

const executionContextSchema = z.union([
  z.object({ kind: z.literal("legacy") }).strict(),
  registeredContextSchema,
])

const rowSchema = z.record(z.string(), z.unknown())
const responseSchema = z
  .object({
    attempt: rowSchema,
    draft: rowSchema,
    item: rowSchema,
    duplicate: z.boolean(),
  })
  .strict()
const beginSchema = z
  .object({
    kind: z.enum(["started", "replay", "in_progress"]),
    executionId: z.string().uuid(),
    attempt: rowSchema.optional(),
    draft: rowSchema.optional(),
    item: rowSchema.optional(),
  })
  .passthrough()

export async function executeWorkflowActionRpc(input: {
  supabase: WorkflowSupabaseClient
  completionSupabase: WorkflowSupabaseClient
  companyId: string
  actionDraftId: string
  decisionId: string
  rawToken: string
  idempotencyKey: string
  payload: Json
  actorId: string
  inputHash: string
  clientSurface: WorkflowClientSurface
  controlRequestId?: string
}): Promise<WorkflowExecutionRpcResult> {
  const context = await loadContext(input)
  if (context.kind === "legacy") return executeMockWorkflowActionRpc(input)

  if (stableHash(input.payload) !== stableHash(context.input)) {
    throw new WorkflowRpcError("payload_hash_mismatch", "22023")
  }
  const receipts = new SupabaseRegisteredReceiptStore(input, context)
  const dispatcher = createActionDispatcher({
    registry: new ExecutorRegistry([
      {
        actionId: context.actionId,
        actionVersion: context.actionVersion,
        capabilityId: context.capabilityId,
        capabilityVersion: context.capabilityVersion,
        connectorId: context.connectorId,
        schemaDigest: context.schemaDigest,
        allowedModes: context.allowedModes,
        timeoutMs: context.timeoutMs,
        retryPolicy: {
          maxAttempts: 1,
          backoffMs: 0,
          retryableCodes: [],
          timeoutOutcome: "unknown",
        },
        validateInput: createBoundedJsonSchemaValidator(context.inputSchema),
        validateOutput: createBoundedJsonSchemaValidator(context.outputSchema),
        adapter: createSimulationAdapter({
          execute: (requestInput) => ({
            input: requestInput,
            mode: context.mode,
            simulated: true,
          }),
        }),
      },
    ]),
    receipts,
    recheckPolicy: async () =>
      policyFromContext(await loadRegisteredContext(input)),
  })
  const request: ActionExecutionRequest = {
    companyId: context.companyId,
    agentId: context.agentId,
    workflowRunId: context.workflowRunId,
    itemId: context.itemId,
    actorId: input.actorId,
    actionId: context.actionId,
    actionVersion: context.actionVersion,
    capabilityId: context.capabilityId,
    capabilityVersion: context.capabilityVersion,
    connectorId: context.connectorId,
    schemaDigest: context.schemaDigest,
    mode: context.mode,
    idempotencyKey: input.idempotencyKey,
    input: context.input,
    approvalId: context.approvalId,
    expected: context.expected,
  }
  const result = await dispatcher(request)
  if (receipts.response) return receipts.response
  throw new WorkflowRpcError(
    result.code === "execution_in_progress"
      ? "action_already_attempted"
      : result.code,
    result.status === "processing" ? "55000" : "22023"
  )
}

class SupabaseRegisteredReceiptStore implements ExecutionReceiptStore {
  response: WorkflowExecutionRpcResult | null = null

  constructor(
    private readonly input: Parameters<typeof executeWorkflowActionRpc>[0],
    private readonly context: z.infer<typeof registeredContextSchema>
  ) {}

  async begin(receipt: {
    companyId: string
    idempotencyKey: string
    requestHash: string
    createExecutionId: () => string
  }): Promise<ReceiptStart> {
    const data = beginSchema.parse(
      await rpc(this.input.supabase, "begin_registered_agent_execution_v1", {
        p_company_id: receipt.companyId,
        p_action_draft_id: this.input.actionDraftId,
        p_decision_id: this.input.decisionId,
        p_raw_token: this.input.rawToken,
        p_idempotency_key: receipt.idempotencyKey,
        p_request_hash: receipt.requestHash,
        p_mode: this.context.mode,
      })
    )
    if (data.kind === "started")
      return { kind: "started", executionId: data.executionId }
    if (data.kind === "in_progress")
      return { kind: "in_progress", executionId: data.executionId }

    const attempt = data.attempt ?? {}
    const draft = data.draft ?? {}
    const item = data.item ?? {}
    this.response = responseSchema.parse({
      attempt,
      draft,
      item,
      duplicate: true,
    })
    return { kind: "replay", result: resultFromAttempt(attempt) }
  }

  async complete(receipt: {
    companyId: string
    idempotencyKey: string
    requestHash: string
    result: ActionExecutionResult
  }): Promise<void> {
    if (isPolicyBlockResult(receipt.result)) return
    this.response = responseSchema.parse(
      await rpc(
        this.input.completionSupabase,
        "complete_registered_agent_execution_v1",
        {
          p_company_id: receipt.companyId,
          p_execution_id: receipt.result.executionId,
          p_idempotency_key: receipt.idempotencyKey,
          p_request_hash: receipt.requestHash,
          p_result: receipt.result as unknown as Json,
        }
      )
    )
  }
}

function isPolicyBlockResult(result: ActionExecutionResult): boolean {
  return (
    result.status === "failed" &&
    new Set([
      "agent_not_active",
      "execution_context_stale",
      "capability_not_granted",
      "connector_unhealthy",
      "approval_invalid",
      "policy_denied",
    ]).has(result.code)
  )
}

async function loadContext(
  input: Parameters<typeof executeWorkflowActionRpc>[0]
): Promise<z.infer<typeof executionContextSchema>> {
  return executionContextSchema.parse(
    await rpc(input.supabase, "get_registered_agent_execution_context_v1", {
      p_company_id: input.companyId,
      p_action_draft_id: input.actionDraftId,
      p_decision_id: input.decisionId,
    })
  )
}

async function loadRegisteredContext(
  input: Parameters<typeof executeWorkflowActionRpc>[0]
): Promise<z.infer<typeof registeredContextSchema>> {
  const context = await loadContext(input)
  if (context.kind !== "registered")
    throw new WorkflowRpcError("execution_context_stale", "55000")
  return context
}

function policyFromContext(
  context: z.infer<typeof registeredContextSchema>
): ExecutionPolicySnapshot {
  return {
    ...context.policy,
    lifecycleState: normalizeLifecycle(context.policy.lifecycleState),
  }
}

function normalizeLifecycle(
  state: string
): ExecutionPolicySnapshot["lifecycleState"] {
  return ["draft", "ready", "active", "paused", "disabled"].includes(state)
    ? (state as ExecutionPolicySnapshot["lifecycleState"])
    : "disabled"
}

function resultFromAttempt(
  attempt: Record<string, unknown>
): ActionExecutionResult {
  const status = attempt.status === "succeeded" ? "succeeded" : "failed"
  return {
    executionId: String(attempt.id),
    requestHash: String(attempt.request_hash),
    responseHash:
      typeof attempt.response_hash === "string" ? attempt.response_hash : null,
    mode: String(attempt.mode) as ActionExecutionResult["mode"],
    status,
    effect: String(attempt.effect_state) as ActionExecutionResult["effect"],
    retryClass: status === "succeeded" ? "none" : "terminal",
    attempt: Number(attempt.attempt_number ?? 1),
    code: status === "succeeded" ? "execution_succeeded" : "execution_failed",
    message:
      status === "succeeded" ? "Execution completed." : "Execution failed.",
    output: isRecord(attempt.result_payload) ? attempt.result_payload : null,
    providerReference:
      typeof attempt.provider_reference === "string"
        ? attempt.provider_reference
        : null,
    startedAt: String(attempt.started_at ?? attempt.created_at),
    completedAt:
      typeof attempt.completed_at === "string" ? attempt.completed_at : null,
    replayed: true,
  }
}

async function rpc(
  supabase: WorkflowSupabaseClient,
  name: string,
  args: Record<string, unknown>
): Promise<unknown> {
  const invoke = supabase.rpc.bind(supabase) as unknown as (
    functionName: string,
    parameters: Record<string, unknown>
  ) => PromiseLike<{
    data: unknown
    error: { message: string; code?: string } | null
  }>
  const { data, error } = await invoke(name, args)
  if (error)
    throw new WorkflowRpcError(rpcCode(error.message), error.code ?? "")
  return data
}

function rpcCode(message: string): string {
  return (
    [
      "draft_not_found",
      "decision_not_found",
      "token_not_found",
      "token_consumed",
      "token_expired",
      "payload_hash_mismatch",
      "idempotency_key_reused",
      "invalid_state",
      "executor_not_registered",
      "execution_mode_not_allowed",
      "capability_not_granted",
      "agent_not_active",
      "execution_context_stale",
    ].find((code) => message.includes(code)) ?? "execution_failed"
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}
