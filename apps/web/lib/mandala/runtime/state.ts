import { Annotation } from "@langchain/langgraph"

export type RuntimeMode = "mock" | "dry_run" | "shadow"

export type RuntimeStatus =
  | "created"
  | "bindings_resolved"
  | "data_loaded"
  | "validated"
  | "judgment_ready"
  | "rules_applied"
  | "review_projected"
  | "waiting_for_approval"
  | "approved"
  | "rejected"
  | "rework_requested"
  | "executed"
  | "completed"
  | "suppressed"
  | "blocked"
  | "failed"

export type RuntimeTrigger = {
  id: string
  kind: "manual" | "fixture" | "schedule" | "webhook"
  input: Record<string, unknown>
}

export type RuntimeSourceRef = {
  capabilityAlias: string
  connectorId: string
  observedAt: string
  reference: Record<string, unknown>
}

export type RuntimeAgentJudgment = {
  proposal: Record<string, unknown>
  rationale: string
  confidence: number
  warnings: string[]
  context: Record<string, unknown>
}

export type RuntimeRuleTrace = {
  ruleId: string
  operation: string
  outputPath: string | null
  value: unknown
  ok: boolean
  error: string | null
}

export type RuntimeRuleResult = {
  ok: boolean
  disposition: "continue" | "blocked" | "suppressed"
  context: Record<string, unknown>
  traces: RuntimeRuleTrace[]
  errors: string[]
  warnings: string[]
  messages: string[]
}

export type RuntimeReviewProjection = {
  item: {
    type: string
    key: string
    title: string
    priority: number
    related: Record<string, unknown>
  }
  recommendation: {
    rationale: string
    confidence: number
    output: Record<string, unknown>
  }
  draft: {
    action: string
    payload: Record<string, unknown>
    editPolicy: {
      editable: boolean
      requireReason: boolean
      immutablePaths: string[][]
      arrayLengthPaths: string[][]
      positiveIntegerPaths: string[][]
      nonEmptyStringPaths: string[][]
    }
  } | null
  evidence: {
    requirements: string[]
    assumptions: string[]
    sourceCapabilities: string[]
    sourceRefs: RuntimeSourceRef[]
  }
}

export type RuntimePersistedReview = {
  workflowItemId: string
  recommendationId: string
  evidenceId: string
  actionDraftId: string | null
  disposition?: "created" | "suppressed"
}

export type RuntimeApprovalDecision = {
  decisionId: string
  decision: "approve" | "edit" | "reject" | "request_rework"
  reason?: string
  warningsAcknowledged?: boolean
}

export type RuntimeActionResult = {
  attemptId: string
  status:
    | "pending"
    | "processing"
    | "succeeded"
    | "failed"
    | "unknown"
    | "reconciliation_required"
  output: Record<string, unknown>
  code?: string
  retryClass?: "none" | "retryable" | "terminal" | "unknown"
  replayed?: boolean
}

export type RuntimeAuditEvent = {
  eventType: string
  summary: string
  payload: Record<string, unknown>
}

export const RuntimeStateAnnotation = Annotation.Root({
  companyId: Annotation<string>,
  actorId: Annotation<string>,
  workflowDefinitionId: Annotation<string>,
  workflowRunId: Annotation<string>,
  manifestDigest: Annotation<string>,
  mode: Annotation<RuntimeMode>,
  trigger: Annotation<RuntimeTrigger>,
  status: Annotation<RuntimeStatus>,
  data: Annotation<Record<string, unknown>>({
    reducer: (_current, update) => update,
    default: () => ({}),
  }),
  sourceRefs: Annotation<RuntimeSourceRef[]>({
    reducer: (_current, update) => update,
    default: () => [],
  }),
  warnings: Annotation<string[]>({
    reducer: (_current, update) => update,
    default: () => [],
  }),
  agent: Annotation<RuntimeAgentJudgment | null>({
    reducer: (_current, update) => update,
    default: () => null,
  }),
  ruleResult: Annotation<RuntimeRuleResult | null>({
    reducer: (_current, update) => update,
    default: () => null,
  }),
  review: Annotation<RuntimeReviewProjection | null>({
    reducer: (_current, update) => update,
    default: () => null,
  }),
  persistedReview: Annotation<RuntimePersistedReview | null>({
    reducer: (_current, update) => update,
    default: () => null,
  }),
  approval: Annotation<RuntimeApprovalDecision | null>({
    reducer: (_current, update) => update,
    default: () => null,
  }),
  actionResult: Annotation<RuntimeActionResult | null>({
    reducer: (_current, update) => update,
    default: () => null,
  }),
  auditEvents: Annotation<RuntimeAuditEvent[]>({
    reducer: (current, update) => current.concat(update),
    default: () => [],
  }),
  errors: Annotation<string[]>({
    reducer: (_current, update) => update,
    default: () => [],
  }),
})

export type RuntimeState = typeof RuntimeStateAnnotation.State
export type RuntimeStateUpdate = typeof RuntimeStateAnnotation.Update

export type RuntimeStartInput = Pick<
  RuntimeState,
  | "companyId"
  | "actorId"
  | "workflowDefinitionId"
  | "workflowRunId"
  | "manifestDigest"
  | "mode"
  | "trigger"
>

export function createRuntimeStartState(
  input: RuntimeStartInput
): RuntimeStateUpdate {
  return {
    ...input,
    status: "created",
    data: {},
    sourceRefs: [],
    warnings: [],
    agent: null,
    ruleResult: null,
    review: null,
    persistedReview: null,
    approval: null,
    actionResult: null,
    auditEvents: [],
    errors: [],
  }
}

export type RuntimeThreadConfig = {
  configurable: {
    thread_id: string
    checkpoint_id?: string
  }
}

export type RuntimeCheckpointCorrelation = {
  threadId: string
  checkpointId: string | null
}

export function runtimeThreadConfig(
  workflowRunId: string,
  checkpointId?: string
): RuntimeThreadConfig {
  const threadId = workflowRunId.trim()
  if (!threadId) throw new Error("A workflow run ID is required.")
  return {
    configurable: {
      thread_id: threadId,
      ...(checkpointId ? { checkpoint_id: checkpointId } : {}),
    },
  }
}

export function checkpointCorrelation(
  workflowRunId: string,
  snapshot: { config?: { configurable?: Record<string, unknown> } }
): RuntimeCheckpointCorrelation {
  const configured = snapshot.config?.configurable ?? {}
  const threadId = configured.thread_id
  if (threadId !== workflowRunId) {
    throw new Error("Checkpoint thread does not match the workflow run.")
  }
  return {
    threadId: workflowRunId,
    checkpointId:
      typeof configured.checkpoint_id === "string"
        ? configured.checkpoint_id
        : null,
  }
}
