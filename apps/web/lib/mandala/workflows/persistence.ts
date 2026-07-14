import type { SupabaseClient } from "@supabase/supabase-js"
import { z } from "zod"
import type { Database, Json } from "@/lib/supabase/types"
import type {
  WorkflowActionDraftRecord,
  WorkflowAuditEventRecord,
  WorkflowContextPacketRecord,
  WorkflowDefinitionRecord,
  WorkflowEventRecord,
  WorkflowEvidenceRecord,
  WorkflowFixtureRunResult,
  WorkflowItemRecord,
  WorkflowRecommendationRecord,
  WorkflowRunRecord,
} from "./engine"

export type WorkflowSupabaseClient = SupabaseClient<Database>
export type WorkflowClientSurface = "cli" | "web" | "api" | "automation"

export type CompanyMembership = {
  role: string
}

const rowSchema = z.record(z.string(), z.unknown())
const persistFixtureResultSchema = z.object({
  duplicate: z.boolean(),
  run: rowSchema,
  eventId: z.string().uuid(),
  itemId: z.string().uuid().nullable().optional(),
  draftId: z.string().uuid().nullable().optional(),
})
const decisionResultSchema = z.object({
  decision: rowSchema,
  draft: rowSchema,
  item: rowSchema,
  executionToken: z
    .object({
      id: z.string().uuid(),
      rawToken: z.string().min(32),
      expiresAt: z.string(),
    })
    .nullable(),
})
const executionResultSchema = z.object({
  attempt: rowSchema,
  draft: rowSchema,
  item: rowSchema,
  duplicate: z.boolean(),
})
const executionTokenReissueResultSchema = z.object({
  decisionId: z.string().uuid(),
  executionToken: z.object({
    id: z.string().uuid(),
    rawToken: z.string().length(64),
    expiresAt: z.string(),
  }),
})
const workflowControlRequestResultSchema = z.object({
  id: z.string().uuid(),
  company_id: z.string().uuid(),
  actor_id: z.string().uuid(),
  client_surface: z.enum(["cli", "web", "api", "automation"]),
  input_hash: z.string().regex(/^[0-9a-f]{64}$/),
  normalized_intent: rowSchema,
  parser_kind: z.enum(["explicit", "deterministic", "langchain"]),
  resolution_status: z.enum([
    "resolved",
    "clarification_required",
    "blocked",
    "executed",
    "failed",
  ]),
  risk_class: z.enum(["read", "state_change", "mock_execution"]),
  workflow_run_id: z.string().uuid().nullable(),
  workflow_item_id: z.string().uuid().nullable(),
  langsmith_trace_id: z.string().nullable(),
  langsmith_run_id: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
})
const workflowControlParserLeaseSchema = z.object({
  leaseId: z.string().uuid(),
  expiresAt: z.string(),
})

export type PersistFixtureResult = z.infer<typeof persistFixtureResultSchema>
export type WorkflowDecisionRpcResult = z.infer<typeof decisionResultSchema>
export type WorkflowExecutionRpcResult = z.infer<typeof executionResultSchema>
export type WorkflowExecutionTokenReissueResult = z.infer<
  typeof executionTokenReissueResultSchema
>
export type WorkflowControlRequestResult = z.infer<
  typeof workflowControlRequestResultSchema
>
export type WorkflowControlParserLease = z.infer<
  typeof workflowControlParserLeaseSchema
>

const workflowRpcStatuses: Record<string, number> = {
  unauthorized: 401,
  forbidden: 403,
  draft_not_found: 404,
  decision_not_found: 404,
  token_not_found: 404,
  invalid_state: 409,
  token_consumed: 409,
  token_expired: 409,
  token_revoked: 409,
  action_already_attempted: 409,
  idempotency_key_reused: 409,
  warnings_not_acknowledged: 400,
  invalid_decision: 400,
  reason_too_long: 400,
  recommendation_not_approvable: 409,
  edited_payload_invalid: 400,
  edit_reason_required: 400,
  edited_payload_shape_changed: 400,
  edited_payload_identity_changed: 400,
  edited_payload_value_invalid: 400,
  edited_payload_not_allowed: 400,
  payload_hash_mismatch: 400,
  invalid_execution_request: 400,
  invalid_token_reissue_request: 400,
  invalid_control_request: 400,
  control_request_not_found: 404,
  control_request_forbidden: 403,
  invalid_control_transition: 409,
  control_request_correlation_mismatch: 409,
  parser_rate_limit_exceeded: 429,
  parser_concurrency_limit_exceeded: 429,
  parser_lease_not_found: 404,
  parser_lease_forbidden: 403,
  parser_binding_forbidden: 503,
  linked_item_company_mismatch: 400,
  linked_item_run_mismatch: 400,
  linked_run_company_mismatch: 400,
  invalid_fixture_payload: 400,
  fixture_adapter_not_allowed: 400,
  unsafe_fixture_audit: 400,
  tenant_mismatch: 400,
  unsafe_workflow_spec: 400,
  unsafe_workflow_action: 400,
  invalid_audit_actor: 400,
  invalid_compiled_workflow_payload: 400,
  invalid_compiled_workflow_contract: 400,
  invalid_compiled_review_graph: 400,
  unsafe_compiled_workflow_action: 400,
  workflow_not_found: 404,
  workflow_not_successfully_compiled: 409,
  binding_snapshot_not_activatable: 409,
  workflow_capability_binding_unhealthy: 503,
  compiled_workflow_manifest_mismatch: 409,
  workflow_run_id_conflict: 409,
  compiled_event_key_conflict: 409,
  compiled_item_key_conflict: 409,
}

export class WorkflowRpcError extends Error {
  constructor(
    readonly rpcCode: string,
    readonly databaseCode?: string
  ) {
    super(rpcCode)
    this.name = "WorkflowRpcError"
  }
}

export function classifyWorkflowRpcError(
  error: unknown,
  fallbackCode: string
): { code: string; status: number } {
  if (error instanceof WorkflowRpcError) {
    return {
      code: error.rpcCode,
      status: workflowRpcStatuses[error.rpcCode] ?? 500,
    }
  }
  return { code: fallbackCode, status: 500 }
}

export async function getCompanyMembership(input: {
  supabase: WorkflowSupabaseClient
  companyId: string
  userId: string
}): Promise<CompanyMembership | null> {
  const { data, error } = await input.supabase
    .from("company_memberships")
    .select("role")
    .eq("company_id", input.companyId)
    .eq("user_id", input.userId)
    .eq("status", "active")
    .maybeSingle()

  if (error) throwRpcError(error.message, error.code)
  return data
}

export async function persistFixtureRun(input: {
  supabase: WorkflowSupabaseClient
  result: WorkflowFixtureRunResult
  inputHash: string
  clientSurface: WorkflowClientSurface
  controlRequestId?: string
}): Promise<PersistFixtureResult> {
  const payload = createWorkflowFixturePersistencePayload(input.result)

  const { data, error } = input.controlRequestId
    ? await input.supabase.rpc(
        "persist_workflow_fixture_run_controlled_reusing_request",
        {
          p_payload: payload,
          p_input_hash: input.inputHash,
          p_client_surface: input.clientSurface,
          p_control_request_id: input.controlRequestId,
        }
      )
    : await input.supabase.rpc("persist_workflow_fixture_run_controlled", {
        p_payload: payload,
        p_input_hash: input.inputHash,
        p_client_surface: input.clientSurface,
      })
  if (error) throwRpcError(error.message, error.code)
  return persistFixtureResultSchema.parse(data)
}

export function createWorkflowFixturePersistencePayload(
  result: WorkflowFixtureRunResult
): Json {
  return {
    company_id: result.run.companyId,
    definition: mapDefinition(result.definition),
    run: mapRun(result.run),
    event: mapEvent(result.event),
    item: result.item ? mapItem(result.item) : null,
    context_packet: result.contextPacket
      ? mapContextPacket(result.contextPacket)
      : null,
    recommendation: result.recommendation
      ? mapRecommendation(result.recommendation)
      : null,
    evidence: result.evidence ? mapEvidence(result.evidence) : null,
    draft: result.draft ? mapDraft(result.draft) : null,
    audit_events: result.auditEvents.map(mapAuditEvent),
  } as unknown as Json
}

export async function recordWorkflowDecisionRpc(input: {
  supabase: WorkflowSupabaseClient
  companyId: string
  actionDraftId: string
  decision: "approve" | "edit" | "reject" | "request_rework"
  reason?: string
  warningsAcknowledged?: boolean
  editedPayload?: Json
  inputHash: string
  clientSurface: WorkflowClientSurface
  controlRequestId?: string
}): Promise<WorkflowDecisionRpcResult> {
  const commonArgs = {
    p_company_id: input.companyId,
    p_action_draft_id: input.actionDraftId,
    p_decision: input.decision,
    p_reason: input.reason ?? undefined,
    p_warnings_acknowledged: input.warningsAcknowledged ?? false,
    p_edited_payload: input.editedPayload ?? undefined,
    p_input_hash: input.inputHash,
    p_client_surface: input.clientSurface,
  }
  const { data, error } = input.controlRequestId
    ? await input.supabase.rpc(
        "record_workflow_decision_controlled_reusing_request",
        {
          ...commonArgs,
          p_control_request_id: input.controlRequestId,
        }
      )
    : await input.supabase.rpc(
        "record_workflow_decision_controlled",
        commonArgs
      )
  if (error) throwRpcError(error.message, error.code)
  return decisionResultSchema.parse(data)
}

export async function executeMockWorkflowActionRpc(input: {
  supabase: WorkflowSupabaseClient
  companyId: string
  actionDraftId: string
  decisionId: string
  rawToken: string
  idempotencyKey: string
  payload: Json
  inputHash: string
  clientSurface: WorkflowClientSurface
  controlRequestId?: string
}): Promise<WorkflowExecutionRpcResult> {
  const commonArgs = {
    p_company_id: input.companyId,
    p_action_draft_id: input.actionDraftId,
    p_decision_id: input.decisionId,
    p_raw_token: input.rawToken,
    p_idempotency_key: input.idempotencyKey,
    p_payload: input.payload,
    p_input_hash: input.inputHash,
    p_client_surface: input.clientSurface,
  }
  const { data, error } = input.controlRequestId
    ? await input.supabase.rpc(
        "execute_mock_workflow_action_controlled_reusing_request",
        {
          ...commonArgs,
          p_control_request_id: input.controlRequestId,
        }
      )
    : await input.supabase.rpc(
        "execute_mock_workflow_action_controlled",
        commonArgs
      )
  if (error) throwRpcError(error.message, error.code)
  return executionResultSchema.parse(data)
}

export async function reissueWorkflowExecutionTokenRpc(input: {
  supabase: WorkflowSupabaseClient
  companyId: string
  actionDraftId: string
}): Promise<WorkflowExecutionTokenReissueResult> {
  const { data, error } = await input.supabase.rpc(
    "reissue_workflow_execution_token",
    {
      p_company_id: input.companyId,
      p_action_draft_id: input.actionDraftId,
    }
  )
  if (error) throwRpcError(error.message, error.code)
  return executionTokenReissueResultSchema.parse(data)
}

export async function recordWorkflowControlRequestRpc(input: {
  supabase: WorkflowSupabaseClient
  companyId: string
  clientSurface: "cli" | "web" | "api" | "automation"
  inputHash: string
  normalizedIntent: Json
  parserKind: "explicit" | "deterministic" | "langchain"
  resolutionStatus:
    | "resolved"
    | "clarification_required"
    | "blocked"
    | "executed"
    | "failed"
  riskClass: "read" | "state_change" | "mock_execution"
  workflowRunId?: string
  workflowItemId?: string
  langsmithTraceId?: string
  langsmithRunId?: string
}): Promise<WorkflowControlRequestResult> {
  const { data, error } = await input.supabase.rpc(
    "record_workflow_control_request",
    {
      p_company_id: input.companyId,
      p_client_surface: input.clientSurface,
      p_input_hash: input.inputHash,
      p_normalized_intent: input.normalizedIntent,
      p_parser_kind: input.parserKind,
      p_resolution_status: input.resolutionStatus,
      p_risk_class: input.riskClass,
      p_workflow_run_id: input.workflowRunId,
      p_workflow_item_id: input.workflowItemId,
      p_langsmith_trace_id: input.langsmithTraceId,
      p_langsmith_run_id: input.langsmithRunId,
    }
  )
  if (error) throwRpcError(error.message, error.code)
  return workflowControlRequestResultSchema.parse(data)
}

export async function recordWorkflowControlRequestWithBindingRpc(input: {
  supabase: WorkflowSupabaseClient
  companyId: string
  clientSurface: "cli" | "web" | "api" | "automation"
  inputHash: string
  normalizedIntent: Json
  bindingIntent: Json
  serverToken: string
  parserKind: "deterministic" | "langchain"
  resolutionStatus: "resolved"
  riskClass: "state_change" | "mock_execution"
  workflowRunId?: string
  workflowItemId?: string
  langsmithTraceId?: string
  langsmithRunId?: string
}): Promise<WorkflowControlRequestResult> {
  const { data, error } = await input.supabase.rpc(
    "record_workflow_control_request_with_binding",
    {
      p_company_id: input.companyId,
      p_client_surface: input.clientSurface,
      p_input_hash: input.inputHash,
      p_normalized_intent: input.normalizedIntent,
      p_parser_kind: input.parserKind,
      p_resolution_status: input.resolutionStatus,
      p_risk_class: input.riskClass,
      p_binding_intent: input.bindingIntent,
      p_server_token: input.serverToken,
      p_workflow_run_id: input.workflowRunId,
      p_workflow_item_id: input.workflowItemId,
      p_langsmith_trace_id: input.langsmithTraceId,
      p_langsmith_run_id: input.langsmithRunId,
    }
  )
  if (error) throwRpcError(error.message, error.code)
  return workflowControlRequestResultSchema.parse(data)
}

export async function transitionWorkflowControlRequestRpc(input: {
  supabase: WorkflowSupabaseClient
  companyId: string
  controlRequestId: string
  resolutionStatus: "executed" | "blocked" | "failed"
  workflowRunId?: string
  workflowItemId?: string
}): Promise<WorkflowControlRequestResult> {
  const { data, error } = await input.supabase.rpc(
    "transition_workflow_control_request",
    {
      p_company_id: input.companyId,
      p_control_request_id: input.controlRequestId,
      p_resolution_status: input.resolutionStatus,
      p_workflow_run_id: input.workflowRunId,
      p_workflow_item_id: input.workflowItemId,
    }
  )
  if (error) throwRpcError(error.message, error.code)
  return workflowControlRequestResultSchema.parse(data)
}

export async function acquireWorkflowControlParserLeaseRpc(input: {
  supabase: WorkflowSupabaseClient
  companyId: string
}): Promise<WorkflowControlParserLease> {
  const { data, error } = await input.supabase.rpc(
    "acquire_workflow_control_parser_lease",
    { p_company_id: input.companyId }
  )
  if (error) throwRpcError(error.message, error.code)
  return workflowControlParserLeaseSchema.parse(data)
}

export async function releaseWorkflowControlParserLeaseRpc(input: {
  supabase: WorkflowSupabaseClient
  companyId: string
  leaseId: string
}): Promise<void> {
  const { error } = await input.supabase.rpc(
    "release_workflow_control_parser_lease",
    {
      p_company_id: input.companyId,
      p_lease_id: input.leaseId,
    }
  )
  if (error) throwRpcError(error.message, error.code)
}

function throwRpcError(message: string, databaseCode?: string): never {
  const rpcCode = Object.keys(workflowRpcStatuses).find((candidate) =>
    message.includes(candidate)
  )
  throw new WorkflowRpcError(
    rpcCode ?? "workflow_operation_failed",
    databaseCode
  )
}

function mapDefinition(
  record: WorkflowDefinitionRecord
): Record<string, unknown> {
  return {
    id: record.id,
    company_id: record.companyId,
    workflow_key: record.workflowKey,
    workflow_type: record.workflowType,
    name: record.spec.name,
    version: record.version,
    status: record.status,
    spec: record.spec,
    skill_markdown: record.skillMarkdown,
    compile_result: { ok: true },
  }
}

function mapRun(record: WorkflowRunRecord): Record<string, unknown> {
  return {
    id: record.id,
    company_id: record.companyId,
    workflow_id: record.workflowDefinitionId,
    workflow_type: record.workflowType,
    status: record.status,
    input: record.input,
    langgraph_thread_id: record.langGraphThreadId,
    langgraph_checkpoint_id: record.langGraphCheckpointId,
    langsmith_trace_id: record.langSmithTraceId,
    langsmith_run_id: record.langSmithRunId,
    started_by: record.startedBy,
    started_at: record.startedAt,
    completed_at: record.completedAt,
  }
}

function mapEvent(record: WorkflowEventRecord): Record<string, unknown> {
  return {
    id: record.id,
    company_id: record.companyId,
    workflow_run_id: record.workflowRunId,
    workflow_id: record.workflowDefinitionId,
    event_key: record.eventKey,
    event_type: record.eventType,
    origin: record.origin,
    source_ref: record.sourceRef,
    payload: record.payload,
    freshness_state: record.freshnessState,
    validation_status: record.validationStatus,
    validation_result: record.validationResult,
    created_at: record.createdAt,
  }
}

function mapItem(record: WorkflowItemRecord): Record<string, unknown> {
  return {
    id: record.id,
    company_id: record.companyId,
    workflow_run_id: record.workflowRunId,
    workflow_event_id: record.workflowEventId,
    workflow_id: record.workflowDefinitionId,
    item_key: record.itemKey,
    item_type: record.itemType,
    title: record.title,
    status: record.status,
    priority: record.priority,
    related_records: record.relatedRecords,
    resolution_state: record.resolutionState,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
  }
}

function mapContextPacket(
  record: WorkflowContextPacketRecord
): Record<string, unknown> {
  return {
    id: record.id,
    company_id: record.companyId,
    workflow_run_id: record.workflowRunId,
    workflow_item_id: record.workflowItemId,
    sources: record.sources,
    facts: record.facts,
    memory_refs: record.memoryRefs,
    freshness_state: record.freshnessState,
    warnings: record.warnings,
    created_at: record.createdAt,
  }
}

function mapRecommendation(
  record: WorkflowRecommendationRecord
): Record<string, unknown> {
  return {
    id: record.id,
    company_id: record.companyId,
    workflow_run_id: record.workflowRunId,
    workflow_item_id: record.workflowItemId,
    context_packet_id: record.contextPacketId,
    status: record.status,
    rationale_summary: record.rationaleSummary,
    warning_state: record.warningState,
    warnings: record.warnings,
    confidence: record.confidence,
    freshness_state: record.freshnessState,
    input: record.input,
    output: record.output,
    langsmith_trace_id: record.langSmithTraceId,
    langsmith_run_id: record.langSmithRunId,
    created_at: record.createdAt,
  }
}

function mapEvidence(record: WorkflowEvidenceRecord): Record<string, unknown> {
  return {
    id: record.id,
    company_id: record.companyId,
    workflow_run_id: record.workflowRunId,
    workflow_item_id: record.workflowItemId,
    recommendation_run_id: record.recommendationRunId,
    source_refs: record.sourceRefs,
    assumptions: record.assumptions,
    warnings: record.warnings,
    evidence: record.evidence,
    created_at: record.createdAt,
  }
}

function mapDraft(record: WorkflowActionDraftRecord): Record<string, unknown> {
  return {
    id: record.id,
    company_id: record.companyId,
    workflow_run_id: record.workflowRunId,
    workflow_item_id: record.workflowItemId,
    recommendation_run_id: record.recommendationRunId,
    evidence_snapshot_id: record.evidenceSnapshotId,
    action_type: record.actionType,
    status: record.status,
    payload: record.payload,
    payload_hash: record.payloadHash,
    edit_policy: record.editPolicy,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
  }
}

function mapAuditEvent(
  record: WorkflowAuditEventRecord
): Record<string, unknown> {
  return {
    id: record.id,
    company_id: record.companyId,
    actor_type: record.actorType,
    actor_id: record.actorId,
    workflow_run_id: record.workflowRunId,
    workflow_item_id: record.workflowItemId,
    event_type: record.eventType,
    summary: record.summary,
    payload: record.payload,
    trace: record.trace,
    created_at: record.createdAt,
  }
}
