import { createHash } from "node:crypto"

export const executionModes = [
  "fixture",
  "mock",
  "dry_run",
  "shadow",
  "live",
] as const

export const currentSkillActionVersion = "1.0.0" as const

export type ExecutionMode = (typeof executionModes)[number]

export type ActionExecutionStatus =
  | "pending"
  | "processing"
  | "succeeded"
  | "failed"
  | "unknown"
  | "reconciliation_required"

export type ExecutionRetryClass = "none" | "retryable" | "terminal" | "unknown"

export type ExecutionEffect =
  | "none"
  | "simulated"
  | "observed"
  | "committed"
  | "unknown"

export type ExecutorBinding = {
  actionId: string
  actionVersion: string
  capabilityId: string
  capabilityVersion: string
  connectorId: string
  schemaDigest: string
}

export type ActionExecutionRequest = ExecutorBinding & {
  companyId: string
  agentId: string
  workflowRunId: string
  itemId: string | null
  actorId: string
  mode: ExecutionMode
  idempotencyKey: string
  input: Record<string, unknown>
  approvalId: string | null
  expected: {
    agentConfigVersion: number
    lifecycleVersion: number
    policyVersion: number
    bindingVersion: number
  }
}

export type ActionExecutionResult = {
  executionId: string
  requestHash: string
  responseHash: string | null
  mode: ExecutionMode
  status: ActionExecutionStatus
  effect: ExecutionEffect
  retryClass: ExecutionRetryClass
  attempt: number
  code: string
  message: string
  output: Record<string, unknown> | null
  providerReference: string | null
  startedAt: string
  completedAt: string | null
  replayed: boolean
}

export type ExecutionPolicySnapshot = {
  allowed: boolean
  reason: string | null
  lifecycleState: "draft" | "ready" | "active" | "paused" | "disabled"
  agentConfigVersion: number
  lifecycleVersion: number
  policyVersion: number
  bindingVersion: number
  capabilityGranted: boolean
  connectorHealthy: boolean
  approvalValid: boolean
}

export type ExecutionPolicyRecheck = (
  request: Readonly<ActionExecutionRequest>
) => Promise<ExecutionPolicySnapshot>

export type ExecutorAdapterResult = {
  output: Record<string, unknown>
  effect: "simulated" | "observed" | "committed"
  providerReference?: string | null
}

export type ExecutorAdapterContext = {
  executionId: string
  attempt: number
  mode: Exclude<ExecutionMode, "live">
  idempotencyKey: string
  signal: AbortSignal
}

export type ExecutorAdapter = {
  execute(
    request: Readonly<ActionExecutionRequest>,
    context: Readonly<ExecutorAdapterContext>
  ): Promise<ExecutorAdapterResult>
}

export type RetryPolicy = {
  maxAttempts: number
  backoffMs: number
  retryableCodes: readonly string[]
  timeoutOutcome: "retryable" | "unknown"
}

export type ExecutorDefinition = ExecutorBinding & {
  allowedModes: readonly Exclude<ExecutionMode, "live">[]
  timeoutMs: number
  retryPolicy: RetryPolicy
  validateInput: (input: unknown) => boolean
  validateOutput: (output: unknown) => boolean
  adapter: ExecutorAdapter
}

export class ExecutorFailure extends Error {
  constructor(
    readonly code: string,
    readonly retryClass: Exclude<ExecutionRetryClass, "none">,
    message: string
  ) {
    super(message)
    this.name = "ExecutorFailure"
  }
}

export function executorBindingKey(binding: ExecutorBinding): string {
  return [
    binding.actionId,
    binding.actionVersion,
    binding.capabilityId,
    binding.capabilityVersion,
    binding.connectorId,
    binding.schemaDigest,
  ].join("::")
}

export function executionRequestHash(request: ActionExecutionRequest): string {
  return stableHash({
    binding: executorBindingKey(request),
    companyId: request.companyId,
    agentId: request.agentId,
    workflowRunId: request.workflowRunId,
    itemId: request.itemId,
    actorId: request.actorId,
    mode: request.mode,
    input: request.input,
    approvalId: request.approvalId,
    expected: request.expected,
  })
}

export function stableHash(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex")
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`
  }
  return JSON.stringify(value) ?? "null"
}
