import type { WorkflowSupabaseClient } from "@/lib/mandala/workflows"
import {
  contextPacketProvenanceSchema,
  workflowAttemptSchema,
  workflowDecisionSchema,
  workItemReviewDataSchema,
} from "@workspace/control-plane"
import { z } from "zod"
import type { Json } from "@/lib/supabase/types"
import type { NormalizedQueueQuery } from "./queue-query"
import { sanitizePublicProjection } from "./public-projection"

export class ControlPlaneQueryError extends Error {
  constructor(
    readonly code:
      | "company_list_failed"
      | "item_list_failed"
      | "item_detail_failed"
      | "item_not_found"
      | "queue_failed"
      | "review_failed"
      | "activity_failed"
      | "decision_failed"
      | "unauthorized"
      | "forbidden"
      | "invalid_queue_query"
      | "invalid_queue_cursor"
      | "queue_query_too_broad"
      | "invalid_review_request"
      | "invalid_activity_request"
      | "invalid_decision"
      | "draft_not_found"
      | "review_not_approvable"
      | "idempotency_key_reused"
      | "stale_draft"
      | "stale_version"
      | "invalid_state"
      | "warnings_not_acknowledged"
      | "edited_payload_invalid"
      | "edit_reason_required"
      | "edited_payload_shape_changed"
      | "edited_payload_identity_changed"
      | "edited_payload_value_invalid"
      | "edited_payload_not_allowed",
    readonly databaseCode?: string
  ) {
    super(code)
    this.name = "ControlPlaneQueryError"
  }
}

export const queueSnapshotPageSchema = z
  .object({
    snapshotId: z.string().uuid(),
    position: z.number().int().min(0),
    snapshotAt: z.string().datetime({ offset: true }),
  })
  .strict()

export const activityPageSchema = z
  .object({
    beforeCreatedAt: z.string().datetime({ offset: true }),
    beforeId: z.string().uuid(),
  })
  .strict()

const rowSchema = z.record(z.string(), z.unknown())
const queueRpcResultSchema = z
  .object({
    items: z.array(rowSchema),
    nextPage: queueSnapshotPageSchema.nullable(),
  })
  .strict()
const activityRpcResultSchema = z
  .object({
    items: z.array(rowSchema),
    nextPage: activityPageSchema.nullable(),
  })
  .strict()
const reviewRpcResultSchema = rowSchema
const decisionRowSchema = z
  .object({
    id: z.string().uuid(),
    action_draft_id: z.string().uuid().nullable(),
    decision: z.enum([
      "approve",
      "edit",
      "reject",
      "request_rework",
      "resolve",
    ]),
    reason: z.string().nullable(),
    warnings_acknowledged: z.boolean(),
    created_at: z.string(),
  })
  .strict()
const attemptRowSchema = z
  .object({
    id: z.string().uuid(),
    action_draft_id: z.string().uuid(),
    decision_id: z.string().uuid(),
    action_type: z.string(),
    mode: z.enum(["fixture", "mock", "dry_run", "shadow", "live"]),
    status: z.enum([
      "pending",
      "processing",
      "succeeded",
      "failed",
      "unknown",
      "reconciliation_required",
    ]),
    result_payload: z.record(z.string(), z.unknown()),
    mock_external_id: z.string().nullable(),
    error_message: z.string().nullable(),
    created_at: z.string(),
    completed_at: z.string().nullable(),
  })
  .strict()
const decisionV2ResultSchema = z
  .object({
    decision: rowSchema,
    draft: rowSchema.nullable(),
    item: rowSchema,
    executionToken: rowSchema.nullable(),
    duplicate: z.boolean(),
    needsTokenReissue: z.boolean(),
    priorState: rowSchema,
    resultState: rowSchema,
    version: z.string().min(1).max(500),
  })
  .strict()

export type QueueSnapshotPage = z.infer<typeof queueSnapshotPageSchema>
export type ActivityPage = z.infer<typeof activityPageSchema>

export async function listWorkflowQueue(input: {
  supabase: WorkflowSupabaseClient
  query: NormalizedQueueQuery
  page?: QueueSnapshotPage
}) {
  const payload = {
    ...(input.query.search ? { search: input.query.search } : {}),
    statuses: input.query.statuses,
    ...(input.query.itemTypes.length > 0
      ? { itemTypes: input.query.itemTypes }
      : {}),
    ...(input.query.priorities.length > 0
      ? { priorities: input.query.priorities }
      : {}),
    ...(input.query.sourceTypes.length > 0
      ? { sourceTypes: input.query.sourceTypes }
      : {}),
    ...(input.query.ownerRoles.length > 0
      ? { ownerRoles: input.query.ownerRoles }
      : {}),
    ...(input.query.assigneeIds.length > 0
      ? { assigneeIds: input.query.assigneeIds }
      : {}),
    sort: input.query.sort,
    limit: input.query.limit,
    ...(input.page
      ? {
          snapshotId: input.page.snapshotId,
          position: input.page.position,
        }
      : {}),
  }
  const result = await callJsonRpc(input.supabase, "list_workflow_queue_v1", {
    p_company_id: input.query.companyId,
    p_query: payload as unknown as Json,
  })
  if (result.error) throwControlPlaneRpcError(result.error, "queue_failed")
  return sanitizePublicProjection(queueRpcResultSchema.parse(result.data))
}

export async function getWorkflowReview(input: {
  supabase: WorkflowSupabaseClient
  companyId: string
  itemId: string
  activityLimit: number
  activityPage?: ActivityPage
}): Promise<
  Record<string, unknown> & {
    activity: z.infer<typeof activityRpcResultSchema>
  }
> {
  const result = await callJsonRpc(input.supabase, "get_workflow_review_v1", {
    p_company_id: input.companyId,
    p_workflow_item_id: input.itemId,
    p_activity_limit: input.activityLimit,
    p_activity_before_created_at: input.activityPage?.beforeCreatedAt ?? null,
    p_activity_before_id: input.activityPage?.beforeId ?? null,
  })
  if (result.error) {
    throwControlPlaneRpcError(result.error, "review_failed", true)
  }
  const safe = sanitizePublicProjection(
    reviewRpcResultSchema.parse(result.data)
  )
  const enriched = withRecommendationConfidence(safe)
  const activity = activityRpcResultSchema.parse(enriched.activity)
  const review = workItemReviewDataSchema.parse({
    ...enriched,
    activity: { items: activity.items },
  })
  // Keep the database activity page shape here. The HTTP boundary converts
  // `nextPage` into its signed `nextCursor` before parsing the public schema.
  return { ...review, activity }
}

function withRecommendationConfidence(
  review: Record<string, unknown>
): Record<string, unknown> {
  const recommendation = asRecord(review.recommendation)
  if (!recommendation) return review
  const evidence = asRecord(review.evidence)
  const sourceCount = arrayLength(evidence?.sourceRefs)
  const evidenceCount = arrayLength(evidence?.evidence)
  const sourceCoverage =
    sourceCount > 0 && evidenceCount > 0
      ? "complete"
      : sourceCount > 0 || evidenceCount > 0
        ? "partial"
        : "missing"
  const freshness =
    recommendation.freshnessState === "fresh" ||
    recommendation.freshnessState === "stale"
      ? recommendation.freshnessState
      : "unknown"
  const agreement =
    recommendation.warningState === "blocked"
      ? "conflicting"
      : recommendation.warningState === "warn"
        ? "mixed"
        : recommendation.warningState === "pass" && sourceCoverage !== "missing"
          ? "consistent"
          : "unknown"
  const policyChecks =
    review.reviewState === "blocked"
      ? "blocked"
      : review.reviewState === "ready"
        ? "passed"
        : "attention"
  const missingInputs = [
    ...(sourceCount === 0 ? ["source_coverage"] : []),
    ...(evidenceCount === 0 ? ["supporting_evidence"] : []),
    ...(freshness === "unknown" ? ["freshness"] : []),
    ...(policyChecks === "blocked" ? ["policy_clearance"] : []),
  ]
  const score =
    typeof recommendation.confidence === "number"
      ? recommendation.confidence
      : null

  return {
    ...review,
    recommendation: {
      ...recommendation,
      confidenceMarker: {
        version: "1.0.0",
        score,
        sourceCoverage,
        freshness,
        agreement,
        policyChecks,
        missingInputs,
        explanation: `Confidence ${score === null ? "is unavailable" : `is ${Math.round(score * 100)}%`}. Source coverage is ${sourceCoverage}; freshness is ${freshness}; source agreement is ${agreement}; policy checks are ${policyChecks}; missing inputs are ${missingInputs.length ? missingInputs.join(", ") : "none"}.`,
      },
    },
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function arrayLength(value: unknown): number {
  return Array.isArray(value) ? value.length : 0
}

export async function listWorkflowActivity(input: {
  supabase: WorkflowSupabaseClient
  companyId: string
  itemId: string
  limit: number
  page?: ActivityPage
}) {
  const result = await callJsonRpc(
    input.supabase,
    "list_workflow_activity_v1",
    {
      p_company_id: input.companyId,
      p_workflow_item_id: input.itemId,
      p_limit: input.limit,
      p_before_created_at: input.page?.beforeCreatedAt ?? null,
      p_before_id: input.page?.beforeId ?? null,
    }
  )
  if (result.error) {
    throwControlPlaneRpcError(result.error, "activity_failed", true)
  }
  return sanitizePublicProjection(activityRpcResultSchema.parse(result.data))
}

export async function recordWorkflowDecisionV2(input: {
  supabase: WorkflowSupabaseClient
  companyId: string
  workItemId: string
  actionDraftId?: string
  decision: "approve" | "edit" | "reject" | "request_rework" | "resolve"
  expectedVersion: string
  idempotencyKey: string
  reason?: string
  warningsAcknowledged?: boolean
  editedPayload?: Json
}) {
  const result = await callJsonRpc(
    input.supabase,
    "record_workflow_decision_v2",
    {
      p_company_id: input.companyId,
      p_workflow_item_id: input.workItemId,
      p_action_draft_id: input.actionDraftId ?? null,
      p_decision: input.decision,
      p_expected_version: input.expectedVersion,
      p_idempotency_key: input.idempotencyKey,
      p_reason: input.reason ?? null,
      p_warnings_acknowledged: input.warningsAcknowledged ?? false,
      p_edited_payload: input.editedPayload ?? null,
    }
  )
  if (result.error) {
    throwControlPlaneRpcError(result.error, "decision_failed")
  }
  return decisionV2ResultSchema.parse(result.data)
}

type JsonRpcResult = {
  data: unknown
  error: { message: string; code?: string } | null
}

async function callJsonRpc(
  supabase: WorkflowSupabaseClient,
  name: string,
  args: Record<string, unknown>
): Promise<JsonRpcResult> {
  const rpc = supabase.rpc as unknown as (
    functionName: string,
    functionArgs: Record<string, unknown>
  ) => Promise<JsonRpcResult>
  // Supabase's RPC implementation reads the REST client from `this`. Calling
  // an extracted function works with simple test doubles but fails in the
  // real client with "Cannot read properties of undefined (reading 'rest')".
  return rpc.call(supabase, name, args)
}

function throwControlPlaneRpcError(
  error: { message: string; code?: string },
  fallback: ControlPlaneQueryError["code"],
  tenantSafeItem = false
): never {
  const codes: Array<ControlPlaneQueryError["code"]> = [
    "unauthorized",
    "forbidden",
    "item_not_found",
    "invalid_queue_query",
    "invalid_queue_cursor",
    "queue_query_too_broad",
    "invalid_review_request",
    "invalid_activity_request",
    "invalid_decision",
    "draft_not_found",
    "review_not_approvable",
    "idempotency_key_reused",
    "stale_draft",
    "stale_version",
    "invalid_state",
    "warnings_not_acknowledged",
    "edited_payload_invalid",
    "edit_reason_required",
    "edited_payload_shape_changed",
    "edited_payload_identity_changed",
    "edited_payload_value_invalid",
    "edited_payload_not_allowed",
  ]
  const matched = codes.find((code) => error.message.includes(code)) ?? fallback
  const code =
    tenantSafeItem && (matched === "forbidden" || matched === "item_not_found")
      ? "item_not_found"
      : matched
  throw new ControlPlaneQueryError(code, error.code)
}

export async function listAccessibleCompanies(input: {
  supabase: WorkflowSupabaseClient
  userId: string
}) {
  const { data: memberships, error: membershipError } = await input.supabase
    .from("company_memberships")
    .select("company_id, role")
    .eq("user_id", input.userId)
    .eq("status", "active")

  if (membershipError) throw new ControlPlaneQueryError("company_list_failed")
  if (memberships.length === 0) return []

  const roleByCompany = new Map(
    memberships.map((membership) => [membership.company_id, membership.role])
  )
  const { data: companies, error: companyError } = await input.supabase
    .from("companies")
    .select("id, name, updated_at")
    .in("id", [...roleByCompany.keys()])
    .order("name")

  if (companyError) throw new ControlPlaneQueryError("company_list_failed")
  return companies.map((company) => ({
    id: company.id,
    name: company.name,
    role: roleByCompany.get(company.id) ?? "viewer",
    updatedAt: company.updated_at,
  }))
}

export async function getWorkflowItemDetail(input: {
  supabase: WorkflowSupabaseClient
  companyId: string
  itemId: string
}) {
  const review = await getWorkflowReview({
    supabase: input.supabase,
    companyId: input.companyId,
    itemId: input.itemId,
    activityLimit: 50,
  })
  const activity = activityRpcResultSchema.parse(review.activity)
  const parsed = workItemReviewDataSchema.parse({
    ...review,
    activity: { items: activity.items },
  })
  const operationalContext = parsed.recordSnapshot
    ? await readOperationalContext({
        supabase: input.supabase,
        companyId: input.companyId,
        contextPacketId: parsed.recordSnapshot.contextPacketId,
      })
    : null
  const outcome = await readWorkflowItemOutcome({
    supabase: input.supabase,
    companyId: input.companyId,
    itemId: input.itemId,
  })

  return {
    item: {
      id: parsed.item.id,
      workflowRunId: parsed.item.workflowRunId,
      itemType: parsed.item.itemType,
      title: parsed.item.title,
      status: parsed.item.status,
      priority: parsed.item.priority,
      resolutionState: {},
      createdAt: parsed.item.createdAt,
      updatedAt: parsed.item.updatedAt,
    },
    contextPacket: parsed.recordSnapshot
      ? {
          id: parsed.recordSnapshot.contextPacketId,
          sources: parsed.recordSnapshot.sources,
          facts: parsed.recordSnapshot.facts,
          memoryRefs: [],
          operationalContext,
          freshnessState: parsed.recordSnapshot.freshnessState,
          warnings: parsed.recordSnapshot.warnings,
          createdAt: parsed.recordSnapshot.capturedAt,
        }
      : null,
    recommendation: parsed.recommendation,
    evidence: parsed.evidence,
    draft: parsed.draft
      ? {
          id: parsed.draft.id,
          workflowRunId: parsed.item.workflowRunId,
          workflowItemId: parsed.item.id,
          actionType: parsed.draft.actionType,
          status: parsed.draft.status,
          payload: parsed.draft.payload,
          editPolicy: parsed.draft.editPolicy,
          updatedAt: parsed.draft.updatedAt,
        }
      : null,
    decision: outcome.decision,
    attempt: outcome.attempt,
    auditEvents: parsed.activity.items.map((event) => ({
      id: event.id,
      eventType: event.type,
      summary: event.summary,
      payload: event.details,
      trace: {},
      createdAt: event.createdAt,
    })),
  }
}

async function readWorkflowItemOutcome(input: {
  supabase: WorkflowSupabaseClient
  companyId: string
  itemId: string
}) {
  const [decisionResult, attemptResult] = await Promise.all([
    input.supabase
      .from("workflow_decisions")
      .select(
        "id, action_draft_id, decision, reason, warnings_acknowledged, created_at"
      )
      .eq("company_id", input.companyId)
      .eq("workflow_item_id", input.itemId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    input.supabase
      .from("workflow_action_attempts")
      .select(
        "id, action_draft_id, decision_id, action_type, mode, status, result_payload, mock_external_id, error_message, created_at, completed_at"
      )
      .eq("company_id", input.companyId)
      .eq("workflow_item_id", input.itemId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])
  if (decisionResult.error || attemptResult.error) {
    throw new ControlPlaneQueryError("item_detail_failed")
  }
  const decision = decisionResult.data
    ? decisionRowSchema.parse(decisionResult.data)
    : null
  const attempt = attemptResult.data
    ? attemptRowSchema.parse(attemptResult.data)
    : null
  return {
    decision: decision
      ? workflowDecisionSchema.parse({
          id: decision.id,
          actionDraftId: decision.action_draft_id,
          decision: decision.decision,
          reason: decision.reason,
          warningsAcknowledged: decision.warnings_acknowledged,
          createdAt: decision.created_at,
        })
      : null,
    attempt: attempt
      ? workflowAttemptSchema.parse({
          id: attempt.id,
          actionDraftId: attempt.action_draft_id,
          decisionId: attempt.decision_id,
          actionType: attempt.action_type,
          mode: attempt.mode,
          status: attempt.status,
          resultPayload: attempt.result_payload,
          mockExternalId: attempt.mock_external_id,
          errorMessage: attempt.error_message,
          createdAt: attempt.created_at,
          completedAt: attempt.completed_at,
        })
      : null,
  }
}

async function readOperationalContext(input: {
  supabase: WorkflowSupabaseClient
  companyId: string
  contextPacketId: string
}) {
  const { data, error } = await input.supabase.rpc(
    "get_workflow_context_provenance_v1",
    {
      p_company_id: input.companyId,
      p_context_packet_id: input.contextPacketId,
    }
  )
  if (error) throw new ControlPlaneQueryError("item_detail_failed")
  if (!data) return null
  return contextPacketProvenanceSchema.parse(data)
}
