import type { WorkflowSupabaseClient } from "@/lib/mandala/workflows"
import { workItemReviewDataSchema } from "@workspace/control-plane"
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
    search: input.query.search,
    statuses: input.query.statuses,
    itemTypes: input.query.itemTypes,
    priorities: input.query.priorities,
    sourceTypes: input.query.sourceTypes,
    ownerRoles: input.query.ownerRoles,
    assigneeIds: input.query.assigneeIds,
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
}) {
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
  return sanitizePublicProjection(reviewRpcResultSchema.parse(result.data))
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
  return rpc(name, args)
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
    decision: null,
    attempt: null,
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
