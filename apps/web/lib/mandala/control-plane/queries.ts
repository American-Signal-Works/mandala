import type { WorkflowSupabaseClient } from "@/lib/mandala/workflows"

export class ControlPlaneQueryError extends Error {
  constructor(
    readonly code:
      | "company_list_failed"
      | "item_list_failed"
      | "item_detail_failed"
      | "item_not_found"
  ) {
    super(code)
    this.name = "ControlPlaneQueryError"
  }
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

export async function listWorkflowItems(input: {
  supabase: WorkflowSupabaseClient
  companyId: string
  statuses?: string[]
  limit: number
}) {
  let query = input.supabase
    .from("workflow_items")
    .select(
      "id, workflow_run_id, item_type, title, status, priority, resolution_state, created_at, updated_at"
    )
    .eq("company_id", input.companyId)
    .order("priority", { ascending: false })
    .order("updated_at", { ascending: false })
    .limit(input.limit)

  if (input.statuses?.length) query = query.in("status", input.statuses)
  const { data: items, error: itemError } = await query
  if (itemError) throw new ControlPlaneQueryError("item_list_failed")
  if (items.length === 0) return []

  const { data: drafts, error: draftError } = await input.supabase
    .from("workflow_action_drafts")
    .select("id, workflow_item_id, action_type, status, updated_at")
    .eq("company_id", input.companyId)
    .in(
      "workflow_item_id",
      items.map((item) => item.id)
    )
    .order("updated_at", { ascending: false })
  if (draftError) throw new ControlPlaneQueryError("item_list_failed")

  const latestDraftByItem = new Map<
    string,
    { id: string; actionType: string; status: string; updatedAt: string }
  >()
  for (const draft of drafts) {
    if (!latestDraftByItem.has(draft.workflow_item_id)) {
      latestDraftByItem.set(draft.workflow_item_id, {
        id: draft.id,
        actionType: draft.action_type,
        status: draft.status,
        updatedAt: draft.updated_at,
      })
    }
  }

  return items.map((item) => ({
    id: item.id,
    workflowRunId: item.workflow_run_id,
    itemType: item.item_type,
    title: item.title,
    status: item.status,
    priority: item.priority,
    resolutionState: item.resolution_state,
    draft: latestDraftByItem.get(item.id) ?? null,
    createdAt: item.created_at,
    updatedAt: item.updated_at,
  }))
}

export async function getWorkflowItemDetail(input: {
  supabase: WorkflowSupabaseClient
  companyId: string
  itemId: string
}) {
  const { data: item, error: itemError } = await input.supabase
    .from("workflow_items")
    .select(
      "id, workflow_run_id, item_type, title, status, priority, resolution_state, created_at, updated_at"
    )
    .eq("company_id", input.companyId)
    .eq("id", input.itemId)
    .maybeSingle()

  if (itemError) throw new ControlPlaneQueryError("item_detail_failed")
  if (!item) throw new ControlPlaneQueryError("item_not_found")

  const [context, recommendation, evidence, draft, decision, attempt, audit] =
    await Promise.all([
      input.supabase
        .from("workflow_context_packets")
        .select(
          "id, sources, facts, memory_refs, freshness_state, warnings, created_at"
        )
        .eq("company_id", input.companyId)
        .eq("workflow_item_id", input.itemId)
        .order("created_at", { ascending: false })
        .limit(1),
      input.supabase
        .from("workflow_recommendation_runs")
        .select(
          "id, status, rationale_summary, warning_state, warnings, confidence, freshness_state, output, created_at"
        )
        .eq("company_id", input.companyId)
        .eq("workflow_item_id", input.itemId)
        .order("created_at", { ascending: false })
        .limit(1),
      input.supabase
        .from("workflow_evidence_snapshots")
        .select("id, source_refs, assumptions, warnings, evidence, created_at")
        .eq("company_id", input.companyId)
        .eq("workflow_item_id", input.itemId)
        .order("created_at", { ascending: false })
        .limit(1),
      input.supabase
        .from("workflow_action_drafts")
        .select(
          "id, workflow_run_id, workflow_item_id, action_type, status, payload, edit_policy, updated_at"
        )
        .eq("company_id", input.companyId)
        .eq("workflow_item_id", input.itemId)
        .order("created_at", { ascending: false })
        .limit(1),
      input.supabase
        .from("workflow_decisions")
        .select(
          "id, action_draft_id, decision, reason, warnings_acknowledged, created_at"
        )
        .eq("company_id", input.companyId)
        .eq("workflow_item_id", input.itemId)
        .order("created_at", { ascending: false })
        .limit(1),
      input.supabase
        .from("workflow_action_attempts")
        .select(
          "id, action_draft_id, decision_id, action_type, mode, status, result_payload, mock_external_id, error_message, created_at, completed_at"
        )
        .eq("company_id", input.companyId)
        .eq("workflow_item_id", input.itemId)
        .order("created_at", { ascending: false })
        .limit(1),
      input.supabase
        .from("workflow_audit_events")
        .select("id, event_type, summary, payload, trace, created_at")
        .eq("company_id", input.companyId)
        .eq("workflow_item_id", input.itemId)
        .order("created_at", { ascending: false })
        .limit(50),
    ])

  for (const result of [
    context,
    recommendation,
    evidence,
    draft,
    decision,
    attempt,
    audit,
  ]) {
    if (result.error) throw new ControlPlaneQueryError("item_detail_failed")
  }

  const contextRow = context.data?.[0]
  const recommendationRow = recommendation.data?.[0]
  const evidenceRow = evidence.data?.[0]
  const draftRow = draft.data?.[0]
  const decisionRow = decision.data?.[0]
  const attemptRow = attempt.data?.[0]

  return {
    item: {
      id: item.id,
      workflowRunId: item.workflow_run_id,
      itemType: item.item_type,
      title: item.title,
      status: item.status,
      priority: item.priority,
      resolutionState: item.resolution_state,
      createdAt: item.created_at,
      updatedAt: item.updated_at,
    },
    contextPacket: contextRow
      ? {
          id: contextRow.id,
          sources: contextRow.sources,
          facts: contextRow.facts,
          memoryRefs: contextRow.memory_refs,
          freshnessState: contextRow.freshness_state,
          warnings: contextRow.warnings,
          createdAt: contextRow.created_at,
        }
      : null,
    recommendation: recommendationRow
      ? {
          id: recommendationRow.id,
          status: recommendationRow.status,
          rationaleSummary: recommendationRow.rationale_summary,
          warningState: recommendationRow.warning_state,
          warnings: recommendationRow.warnings,
          confidence: recommendationRow.confidence,
          freshnessState: recommendationRow.freshness_state,
          output: recommendationRow.output,
          createdAt: recommendationRow.created_at,
        }
      : null,
    evidence: evidenceRow
      ? {
          id: evidenceRow.id,
          sourceRefs: evidenceRow.source_refs,
          assumptions: evidenceRow.assumptions,
          warnings: evidenceRow.warnings,
          evidence: evidenceRow.evidence,
          createdAt: evidenceRow.created_at,
        }
      : null,
    draft: draftRow
      ? {
          id: draftRow.id,
          workflowRunId: draftRow.workflow_run_id,
          workflowItemId: draftRow.workflow_item_id,
          actionType: draftRow.action_type,
          status: draftRow.status,
          payload: draftRow.payload,
          editPolicy: draftRow.edit_policy,
          updatedAt: draftRow.updated_at,
        }
      : null,
    decision: decisionRow
      ? {
          id: decisionRow.id,
          actionDraftId: decisionRow.action_draft_id,
          decision: decisionRow.decision,
          reason: decisionRow.reason,
          warningsAcknowledged: decisionRow.warnings_acknowledged,
          createdAt: decisionRow.created_at,
        }
      : null,
    attempt: attemptRow
      ? {
          id: attemptRow.id,
          actionDraftId: attemptRow.action_draft_id,
          decisionId: attemptRow.decision_id,
          actionType: attemptRow.action_type,
          mode: attemptRow.mode,
          status: attemptRow.status,
          resultPayload: attemptRow.result_payload,
          mockExternalId: attemptRow.mock_external_id,
          errorMessage: attemptRow.error_message,
          createdAt: attemptRow.created_at,
          completedAt: attemptRow.completed_at,
        }
      : null,
    auditEvents: (audit.data ?? []).map((event) => ({
      id: event.id,
      eventType: event.event_type,
      summary: event.summary,
      payload: event.payload,
      trace: event.trace,
      createdAt: event.created_at,
    })),
  }
}
