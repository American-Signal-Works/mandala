import type { BaseCheckpointSaver } from "@langchain/langgraph"
import type { CompiledAgentManifest } from "../skills/compiler"
import {
  WorkflowMemoryStore,
  type ValidationResult,
  type WorkflowActionDraftRecord,
  type WorkflowAuditEventRecord,
  type WorkflowContextPacketRecord,
  type WorkflowDefinitionRecord,
  type WorkflowEventRecord,
  type WorkflowEvidenceRecord,
  type WorkflowFixtureRunResult,
  type WorkflowItemRecord,
  type WorkflowRecommendationRecord,
  type WorkflowRunRecord,
} from "../workflows/engine"
import { hashWorkflowValue, workflowUuidFor } from "../workflows/hash"
import type { WorkflowNode, WorkflowSpec } from "../workflows/schema"
import {
  createGenericWorkflowRuntime,
  type RuntimeActionHandler,
  type RuntimeAgentJudgmentHandler,
  type RuntimeCapabilityProvider,
  type RuntimeContextRetriever,
} from "./graph"
import type {
  RuntimeCheckpointCorrelation,
  RuntimeReviewProjection,
  RuntimeOperatingMode,
  RuntimeSourceRef,
  RuntimeState,
  RuntimeTrigger,
} from "./state"
import { resolveRuntimeSandboxEnabled, runtimeOperatingMode } from "./state"

export type CompiledMemoryRunInput = {
  store: WorkflowMemoryStore
  manifest: CompiledAgentManifest
  companyId: string
  actorUserId: string
  workflowDefinitionId?: string
  trigger: RuntimeTrigger
  capabilityProvider: RuntimeCapabilityProvider
  contextRetriever: RuntimeContextRetriever
  agentJudgment: RuntimeAgentJudgmentHandler
  actionHandler?: RuntimeActionHandler
  checkpointer?: BaseCheckpointSaver
  skillMarkdown?: string
  now?: Date
  operatingMode?: RuntimeOperatingMode
  sandboxEnabled?: boolean
  trace?: {
    langSmithTraceId?: string | null
    langSmithRunId?: string | null
  }
}

type ReviewRecords = {
  item: WorkflowItemRecord
  contextPacket: WorkflowContextPacketRecord
  recommendation: WorkflowRecommendationRecord
  evidence: WorkflowEvidenceRecord
  draft: WorkflowActionDraftRecord | null
  duplicate: boolean
}

export async function runCompiledWorkflowInMemory(
  input: CompiledMemoryRunInput
): Promise<WorkflowFixtureRunResult> {
  const sandboxEnabled = resolveRuntimeSandboxEnabled(input)
  const createdAt = (input.now ?? new Date()).toISOString()
  const definition = upsertDefinition(input)
  const run = createRun(input, definition, createdAt)
  const event = createInitialEvent(input, definition, run, createdAt)
  input.store.runs.push(run)
  input.store.events.push(event)

  let reviewRecords: ReviewRecords | null = null
  const runtime = createGenericWorkflowRuntime({
    manifest: input.manifest,
    checkpointer: input.checkpointer,
    dependencies: {
      capabilityProvider: input.capabilityProvider,
      contextRetriever: input.contextRetriever,
      agentJudgment: input.agentJudgment,
      actionHandler: input.actionHandler,
      reviewPersister: async ({ state }) => {
        reviewRecords = persistReviewRecords({
          store: input.store,
          manifest: input.manifest,
          definition,
          run,
          event,
          state,
          createdAt,
        })
        return {
          workflowItemId: reviewRecords.item.id,
          recommendationId: reviewRecords.recommendation.id,
          evidenceId: reviewRecords.evidence.id,
          actionDraftId: reviewRecords.draft?.id ?? null,
          disposition: reviewRecords.duplicate ? "suppressed" : "created",
        }
      },
      ...(sandboxEnabled
        ? {
            mutationBoundary: {
              persistence: "ephemeral" as const,
              externalActions: "simulate" as const,
            },
          }
        : {}),
    },
  })

  const invocation = await runtime.start({
    companyId: input.companyId,
    actorId: input.actorUserId,
    workflowDefinitionId: definition.id,
    workflowRunId: run.id,
    manifestDigest: input.manifest.manifestDigest,
    mode: input.manifest.workflow.default_mode,
    sandboxEnabled,
    operatingMode: runtimeOperatingMode(sandboxEnabled),
    trigger: input.trigger,
  })
  const state = invocation.output
  const persistedReviewRecords = reviewRecords as ReviewRecords | null
  updateEvent(event, input.manifest, state)
  updateRun(run, state, invocation.correlation, createdAt)
  updateReviewTerminalState(persistedReviewRecords, state, createdAt)

  const auditEvents = createAuditEvents({
    store: input.store,
    run,
    item: persistedReviewRecords?.item ?? null,
    state,
    correlation: invocation.correlation,
    actorUserId: input.actorUserId,
    createdAt,
    duplicate: persistedReviewRecords?.duplicate ?? false,
  })

  return {
    definition,
    run,
    event,
    item: persistedReviewRecords?.item ?? null,
    contextPacket: persistedReviewRecords?.contextPacket ?? null,
    recommendation: persistedReviewRecords?.recommendation ?? null,
    evidence: persistedReviewRecords?.evidence ?? null,
    draft: persistedReviewRecords?.draft ?? null,
    auditEvents,
  }
}

function upsertDefinition(
  input: CompiledMemoryRunInput
): WorkflowDefinitionRecord {
  const spec = legacyWorkflowSpec(input.manifest)
  const existing = input.store.definitions.find(
    (candidate) =>
      candidate.companyId === input.companyId &&
      candidate.workflowKey === spec.workflowKey &&
      candidate.version === spec.version
  )
  if (existing) return existing

  const definition: WorkflowDefinitionRecord = {
    id:
      input.workflowDefinitionId ??
      workflowUuidFor(
        "workflow",
        input.companyId,
        spec.workflowKey,
        spec.version
      ),
    companyId: input.companyId,
    workflowKey: spec.workflowKey,
    workflowType: spec.workflowType,
    version: spec.version,
    status: spec.status,
    spec,
    skillMarkdown:
      input.skillMarkdown ??
      `# ${input.manifest.identity.name}\n\nCompiled source digest: ${input.manifest.sourceDigest}`,
  }
  input.store.definitions.push(definition)
  return definition
}

function createRun(
  input: CompiledMemoryRunInput,
  definition: WorkflowDefinitionRecord,
  createdAt: string
): WorkflowRunRecord {
  const runOrdinal = String(
    input.store.runs.filter(
      (candidate) => candidate.workflowDefinitionId === definition.id
    ).length + 1
  )
  const id = workflowUuidFor(
    "run",
    input.companyId,
    definition.id,
    input.trigger.id,
    hashWorkflowValue(input.trigger.input),
    runOrdinal
  )
  return {
    id,
    companyId: input.companyId,
    workflowDefinitionId: definition.id,
    workflowType: definition.workflowType,
    status: "started",
    input: {
      trigger: input.trigger,
      manifestDigest: input.manifest.manifestDigest,
    },
    langGraphThreadId: id,
    langGraphCheckpointId: null,
    langSmithTraceId: input.trace?.langSmithTraceId ?? null,
    langSmithRunId: input.trace?.langSmithRunId ?? null,
    startedBy: input.actorUserId,
    startedAt: createdAt,
    completedAt: null,
  }
}

function createInitialEvent(
  input: CompiledMemoryRunInput,
  definition: WorkflowDefinitionRecord,
  run: WorkflowRunRecord,
  createdAt: string
): WorkflowEventRecord {
  const eventKey = `${definition.workflowType}:${input.trigger.kind}:${input.trigger.id}:${hashWorkflowValue(input.trigger.input).slice(0, 16)}`
  return {
    id: workflowUuidFor("event", input.companyId, eventKey, run.id),
    companyId: input.companyId,
    workflowRunId: run.id,
    workflowDefinitionId: definition.id,
    eventKey,
    eventType: `${definition.workflowType}_${input.trigger.kind}`,
    origin: input.trigger.kind,
    sourceRef: {},
    payload: {
      trigger: input.trigger,
      manifestDigest: input.manifest.manifestDigest,
    },
    freshnessState: "unknown",
    validationStatus: "pass",
    validationResult: {
      status: "pass",
      reasons: [],
      warnings: [],
      suppressRecommendation: false,
    },
    createdAt,
  }
}

function persistReviewRecords(input: {
  store: WorkflowMemoryStore
  manifest: CompiledAgentManifest
  definition: WorkflowDefinitionRecord
  run: WorkflowRunRecord
  event: WorkflowEventRecord
  state: RuntimeState
  createdAt: string
}): ReviewRecords {
  const review = input.state.review
  if (!review) throw new Error("Runtime review projection is missing.")

  const existingItem = input.store.findActiveItem(
    review.item.key,
    input.run.companyId
  )
  if (existingItem) {
    const records = existingReviewRecords(input.store, existingItem)
    return { ...records, duplicate: true }
  }

  const item: WorkflowItemRecord = {
    id: workflowUuidFor(
      "item",
      input.run.companyId,
      input.run.id,
      review.item.key
    ),
    companyId: input.run.companyId,
    workflowRunId: input.run.id,
    workflowEventId: input.event.id,
    workflowDefinitionId: input.definition.id,
    itemKey: review.item.key,
    itemType: review.item.type,
    title: review.item.title,
    status: "active",
    priority: review.item.priority,
    relatedRecords: review.item.related,
    resolutionState: { manifestDigest: input.manifest.manifestDigest },
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  }
  const freshnessState = deriveFreshness(input.manifest, input.state)
  const contextPacket: WorkflowContextPacketRecord = {
    id: workflowUuidFor("context", input.run.companyId, input.run.id, item.id),
    companyId: input.run.companyId,
    workflowRunId: input.run.id,
    workflowItemId: item.id,
    sources: sourceRecords(input.state.sourceRefs),
    facts: input.state.ruleResult?.context ?? {
      trigger: input.state.trigger,
      data: input.state.data,
      agent: input.state.agent,
      rules: {},
      context: {},
    },
    memoryRefs: [],
    operationalContext: input.state.contextRetrieval?.provenance,
    freshnessState,
    warnings: [...input.state.warnings],
    createdAt: input.createdAt,
  }
  const warningState = validationStatus(input.state)
  const recommendation: WorkflowRecommendationRecord = {
    id: workflowUuidFor(
      "recommendation",
      input.run.companyId,
      input.run.id,
      item.id
    ),
    companyId: input.run.companyId,
    workflowRunId: input.run.id,
    workflowItemId: item.id,
    contextPacketId: contextPacket.id,
    status: "ready_for_review",
    rationaleSummary: review.recommendation.rationale,
    warningState,
    warnings: [...input.state.warnings],
    confidence: review.recommendation.confidence,
    freshnessState,
    input: contextPacket.facts,
    output: review.recommendation.output,
    langSmithTraceId: input.run.langSmithTraceId,
    langSmithRunId: input.run.langSmithRunId,
    createdAt: input.createdAt,
  }
  const evidence: WorkflowEvidenceRecord = {
    id: workflowUuidFor(
      "evidence",
      input.run.companyId,
      input.run.id,
      recommendation.id
    ),
    companyId: input.run.companyId,
    workflowRunId: input.run.id,
    workflowItemId: item.id,
    recommendationRunId: recommendation.id,
    sourceRefs: sourceRecords(input.state.sourceRefs),
    assumptions: [...review.evidence.assumptions],
    warnings: [...input.state.warnings],
    evidence: [
      ...review.evidence.requirements.map((requirement) => ({ requirement })),
      ...(input.state.contextRetrieval?.provenance.citations.map(
        (citation) => ({
          kind: "operational_context_citation",
          untrustedEvidence: true,
          citation,
        })
      ) ?? []),
    ],
    createdAt: input.createdAt,
  }
  const draft = review.draft
    ? createDraft(
        input.run,
        item,
        recommendation,
        evidence,
        review,
        input.createdAt
      )
    : null

  input.store.items.push(item)
  input.store.contextPackets.push(contextPacket)
  input.store.recommendations.push(recommendation)
  input.store.evidenceSnapshots.push(evidence)
  if (draft) input.store.drafts.push(draft)

  return {
    item,
    contextPacket,
    recommendation,
    evidence,
    draft,
    duplicate: false,
  }
}

function createDraft(
  run: WorkflowRunRecord,
  item: WorkflowItemRecord,
  recommendation: WorkflowRecommendationRecord,
  evidence: WorkflowEvidenceRecord,
  review: RuntimeReviewProjection,
  createdAt: string
): WorkflowActionDraftRecord {
  const projected = review.draft!
  return {
    id: workflowUuidFor("draft", run.companyId, run.id, item.id),
    companyId: run.companyId,
    workflowRunId: run.id,
    workflowItemId: item.id,
    recommendationRunId: recommendation.id,
    evidenceSnapshotId: evidence.id,
    actionType: legacyKey(projected.action),
    status: "pending_review",
    payload: projected.payload,
    payloadHash: hashWorkflowValue(projected.payload),
    editPolicy: projected.editPolicy,
    createdAt,
    updatedAt: createdAt,
  }
}

function existingReviewRecords(
  store: WorkflowMemoryStore,
  item: WorkflowItemRecord
): Omit<ReviewRecords, "duplicate"> {
  const contextPacket = findLast(
    store.contextPackets,
    (candidate) => candidate.workflowItemId === item.id
  )
  const recommendation = findLast(
    store.recommendations,
    (candidate) => candidate.workflowItemId === item.id
  )
  const evidence = findLast(
    store.evidenceSnapshots,
    (candidate) => candidate.workflowItemId === item.id
  )
  if (!contextPacket || !recommendation || !evidence) {
    throw new Error("Existing active item has an incomplete review package.")
  }
  return {
    item,
    contextPacket,
    recommendation,
    evidence,
    draft: store.latestDraftForItem(item.id),
  }
}

function updateEvent(
  event: WorkflowEventRecord,
  manifest: CompiledAgentManifest,
  state: RuntimeState
): void {
  const validationResult = runtimeValidationResult(state)
  event.sourceRef = { capabilities: sourceRecords(state.sourceRefs) }
  event.payload = {
    ...event.payload,
    agentProposal: state.agent?.proposal ?? null,
    ruleTrace: state.ruleResult?.traces ?? [],
  }
  event.freshnessState = deriveFreshness(manifest, state)
  event.validationStatus = validationResult.status
  event.validationResult = validationResult
}

function updateRun(
  run: WorkflowRunRecord,
  state: RuntimeState,
  correlation: RuntimeCheckpointCorrelation,
  completedAt: string
): void {
  run.langGraphThreadId = correlation.threadId
  run.langGraphCheckpointId = correlation.checkpointId
  run.status = workflowRunStatus(state)
  run.completedAt = run.status === "waiting_for_approval" ? null : completedAt
}

function updateReviewTerminalState(
  review: ReviewRecords | null,
  state: RuntimeState,
  updatedAt: string
): void {
  if (!review || review.duplicate) return
  if (state.status === "executed") {
    review.item.status = "executed"
    review.item.updatedAt = updatedAt
    if (review.draft) {
      review.draft.status = "executed"
      review.draft.updatedAt = updatedAt
    }
  }
}

function workflowRunStatus(state: RuntimeState): WorkflowRunRecord["status"] {
  if (state.status === "suppressed") return "suppressed"
  if (state.status === "blocked") return "blocked"
  if (state.status === "failed") return "failed"
  if (state.status === "executed") return "executed"
  if (state.status === "rejected") return "rejected"
  if (state.status === "rework_requested") return "rework_requested"
  if (state.status === "approved") return "approved"
  if (state.review) return "waiting_for_approval"
  return "suppressed"
}

function runtimeValidationResult(state: RuntimeState): ValidationResult {
  const status = validationStatus(state)
  return {
    status,
    reasons: uniqueStrings([
      ...(state.ruleResult?.messages ?? []),
      ...state.errors,
    ]),
    warnings: [...state.warnings],
    suppressRecommendation: state.status === "suppressed",
  }
}

function validationStatus(state: RuntimeState): ValidationResult["status"] {
  if (state.status === "blocked" || state.status === "failed") return "blocked"
  return state.warnings.length > 0 ? "warn" : "pass"
}

function deriveFreshness(
  manifest: CompiledAgentManifest,
  state: RuntimeState
): WorkflowEventRecord["freshnessState"] {
  const freshnessRuleIds = new Set(
    manifest.rules
      .filter((rule) => rule.operation === "freshness")
      .map((rule) => rule.id)
  )
  const traces = (state.ruleResult?.traces ?? []).filter((trace) =>
    freshnessRuleIds.has(trace.ruleId)
  )
  if (traces.length === 0) return "unknown"
  return traces.some((trace) => trace.value === false) ? "stale" : "fresh"
}

function createAuditEvents(input: {
  store: WorkflowMemoryStore
  run: WorkflowRunRecord
  item: WorkflowItemRecord | null
  state: RuntimeState
  correlation: RuntimeCheckpointCorrelation
  actorUserId: string
  createdAt: string
  duplicate: boolean
}): WorkflowAuditEventRecord[] {
  const events: RuntimeAuditShape[] = [
    {
      eventType: "event_validated",
      summary: `Validated compiled workflow event: ${validationStatus(input.state)}.`,
      payload: { validation: runtimeValidationResult(input.state) },
    },
  ]
  if (input.duplicate) {
    events.push({
      eventType: "item_duplicate_suppressed",
      summary: "An existing active workflow item already covers this review.",
      payload: { existingItemId: input.item?.id ?? null },
    })
  } else if (input.state.status === "suppressed") {
    events.push({
      eventType: "item_suppressed",
      summary:
        input.state.ruleResult?.messages.join("; ") ||
        "Workflow item was suppressed.",
      payload: { reasons: input.state.ruleResult?.messages ?? [] },
    })
  } else if (input.state.status === "blocked") {
    events.push({
      eventType: "item_blocked",
      summary: input.state.errors.join("; ") || "Workflow item was blocked.",
      payload: { reasons: input.state.errors },
    })
  } else if (input.item) {
    events.push({
      eventType: "recommendation_created",
      summary: "Created a compiled workflow recommendation for human review.",
      payload: { workflowItemId: input.item.id },
    })
  }
  events.push(...input.state.auditEvents)

  return events.map((event, index) => {
    const record: WorkflowAuditEventRecord = {
      id: workflowUuidFor(
        "audit",
        input.run.companyId,
        input.run.id,
        event.eventType,
        String(index)
      ),
      companyId: input.run.companyId,
      actorType: "user",
      actorId: input.actorUserId,
      workflowRunId: input.run.id,
      workflowItemId: input.item?.id ?? null,
      eventType: event.eventType,
      summary: event.summary,
      payload: event.payload,
      trace: {
        langGraphThreadId: input.correlation.threadId,
        langGraphCheckpointId: input.correlation.checkpointId,
        langSmithTraceId: input.run.langSmithTraceId,
        langSmithRunId: input.run.langSmithRunId,
      },
      createdAt: input.createdAt,
    }
    input.store.auditEvents.push(record)
    return record
  })
}

type RuntimeAuditShape = {
  eventType: string
  summary: string
  payload: Record<string, unknown>
}

function sourceRecords(
  sourceRefs: RuntimeSourceRef[]
): Array<Record<string, unknown>> {
  return sourceRefs.map((source) => ({
    capabilityAlias: source.capabilityAlias,
    connectorId: source.connectorId,
    observedAt: source.observedAt,
    ...source.reference,
  }))
}

function legacyWorkflowSpec(manifest: CompiledAgentManifest): WorkflowSpec {
  return {
    workflowKey: legacyKey(manifest.identity.id),
    workflowType: legacyKey(manifest.workflow.type),
    name: manifest.identity.name,
    version: manifest.identity.version,
    status: manifest.workflow.status,
    defaultMode: manifest.workflow.default_mode,
    triggers: manifest.workflow.triggers.map((trigger) => ({
      id: legacyKey(trigger.id),
      kind: trigger.kind,
      description: trigger.description,
    })),
    dataSources: manifest.capabilityBindings
      .filter((binding) => binding.access === "read")
      .map((binding) => ({
        id: legacyKey(binding.alias),
        description: `${binding.id} from ${binding.connectorId}.`,
        required: true,
      })),
    nodes: manifest.graph.map((node) => legacyWorkflowNode(node)),
    evidenceRequirements: [...manifest.evidence.requirements],
    approvalRules: manifest.approvals.map((approval) => ({
      actionType: legacyKey(approval.action),
      minimumRole: approval.minimum_role,
      requireHumanApproval: approval.human_required,
      requireWarningAcknowledgement: approval.warning_acknowledgement,
    })),
    allowedActions: manifest.actions.map((action) => ({
      actionType: legacyKey(action.id),
      mode: action.mode,
      requiresApproval: action.requires_approval,
    })),
  }
}

function legacyWorkflowNode(
  node: CompiledAgentManifest["graph"][number]
): WorkflowNode {
  const id = legacyKey(node.id)
  return {
    id,
    kind: legacyNodeKind(node.handler),
    title: node.handler.replaceAll("_", " "),
    allowedTools: node.allowedTools.map(legacyKey),
    timeoutMs: 30_000,
    retry: { maxAttempts: 2, backoffMs: 500 },
    idempotencyRequired: node.idempotencyRequired,
    inputContract: {
      schemaVersion: "1",
      type: "object",
      fields: { company_id: "uuid", workflow_run_id: "uuid" },
    },
    outputContract: {
      schemaVersion: "1",
      type: "object",
      fields: { status: "string", workflow_run_id: "uuid" },
    },
    errorPolicy: {
      classifications: [
        "authorization",
        "permanent",
        "transient",
        "validation",
      ],
      retryable: ["transient"],
      onExhausted:
        node.handler === "human_approval" ? "request_rework" : "block",
    },
    audit: {
      startedEvent: `${id}_started`,
      completedEvent: `${id}_completed`,
      failedEvent: `${id}_failed`,
    },
    trace: {
      langsmith: true,
      langgraph: { threadCorrelation: true, checkpointCorrelation: true },
      eventName: id,
    },
  }
}

function legacyNodeKind(
  handler: CompiledAgentManifest["graph"][number]["handler"]
): WorkflowNode["kind"] {
  if (handler === "load_data") return "source_sync"
  if (handler === "agent_judgment") return "recommendation"
  if (handler === "project_records") return "context_assembly"
  if (handler === "persist_review") return "draft_action"
  if (handler === "human_approval") return "human_approval"
  if (handler === "execute_action") return "mock_execution"
  if (handler === "audit") return "audit"
  return "validation"
}

function legacyKey(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
  if (!normalized) throw new Error(`Cannot convert ${value} to a workflow key.`)
  return normalized
}

function findLast<T>(
  records: T[],
  predicate: (record: T) => boolean
): T | null {
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const record = records[index]!
    if (predicate(record)) return record
  }
  return null
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)]
}
