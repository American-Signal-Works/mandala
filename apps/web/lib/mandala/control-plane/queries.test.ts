import { describe, expect, it, vi } from "vitest"
import { workItemReviewDataSchema } from "@workspace/control-plane"
import type { WorkflowSupabaseClient } from "@/lib/mandala/workflows"
import {
  getWorkflowItemDetail,
  getWorkflowReview,
  listWorkflowActivity,
  listWorkflowQueue,
  recordWorkflowDecisionV2,
} from "./queries"

const companyId = "20000000-0000-0000-0000-000000000001"
const itemId = "33000000-0000-0000-0000-000000000001"
const draftId = "37000000-0000-0000-0000-000000000001"

describe("controlled workflow RPC adapters", () => {
  it("builds the legacy CLI detail shape from the controlled review RPC", async () => {
    const rpc = vi.fn().mockResolvedValueOnce({
      data: {
        item: {
          id: itemId,
          workflowRunId: "31000000-0000-0000-0000-000000000001",
          itemKey: "fixture-item",
          itemType: "po_review",
          title: "Review fixture PO",
          status: "active",
          priority: 50,
          sourceType: "fixture",
          ownerRole: "approver",
          assigneeId: null,
          dueAt: null,
          draft: {
            id: draftId,
            actionType: "execute_mock_purchase_order",
            status: "pending_review",
            updatedAt: "2026-07-14T18:00:00.000Z",
          },
          nextActions: ["approve"],
          createdAt: "2026-07-14T17:00:00.000Z",
          updatedAt: "2026-07-14T18:00:00.000Z",
        },
        recordSnapshot: null,
        recommendation: null,
        evidence: null,
        draft: {
          id: draftId,
          actionType: "execute_mock_purchase_order",
          status: "pending_review",
          payload: { lines: [{ quantity: 12 }] },
          editPolicy: { editable: true },
          updatedAt: "2026-07-14T18:00:00.000Z",
        },
        policy: {
          minimumRole: "approver",
          requireHumanApproval: true,
          requireWarningAcknowledgement: false,
        },
        reviewState: "missing_context",
        version: "a".repeat(64),
        availableActions: ["approve"],
        activity: { items: [], nextPage: null },
      },
      error: null,
    })

    const detail = await getWorkflowItemDetail({
      supabase: { rpc } as unknown as WorkflowSupabaseClient,
      companyId,
      itemId,
    })

    expect(detail.draft?.payload).toEqual({ lines: [{ quantity: 12 }] })
    expect(detail.contextPacket).toBeNull()
    expect(rpc).toHaveBeenCalledWith(
      "get_workflow_review_v1",
      expect.objectContaining({ p_workflow_item_id: itemId })
    )
  })

  it("loads persisted operational citations without exposing retrieved excerpts", async () => {
    const contextPacketId = "32000000-0000-0000-0000-000000000001"
    const citation = {
      providerReference: "provider-search-result-1",
      providerDocumentId: "provider-document-1",
      stableCustomId: `ctx_${"a".repeat(64)}`,
      canonicalRecordId: "22000000-0000-4000-8000-000000000001",
      canonicalRecordVersion: "version-1",
      sourceId: "23000000-0000-4000-8000-000000000001",
      sourceKey: "helpdesk",
      recordType: "support_ticket",
      rank: 1,
      score: 0.91,
      providerUpdatedAt: "2026-07-16T12:30:00.000Z",
      sourceObservedAt: "2026-07-16T12:00:00.000Z",
      freshness: "fresh" as const,
      contentHash: "b".repeat(64),
      policyHash: "f".repeat(64),
    }
    const operationalContext = {
      provider: "supermemory" as const,
      status: "complete" as const,
      requestId: "24000000-0000-4000-8000-000000000001",
      scope: { companyId, workspaceScopeId: companyId },
      queryHash: "c".repeat(64),
      filterHash: "d".repeat(64),
      policyVersion: 3,
      bounds: {
        maximumResults: 5,
        maximumCharacters: 12_000,
        maximumTokens: 4_000,
        maximumAgeHours: 8_760,
        minimumConfidence: 0,
        timeoutMs: 2_000,
      },
      resultCount: 1,
      characterCount: 52,
      tokenEstimate: 13,
      latencyMs: 14,
      fallbackReason: null,
      indexSnapshotMarker: `idx_${"e".repeat(64)}`,
      citations: [citation],
    }
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({
        data: {
          item: {
            id: itemId,
            workflowRunId: "31000000-0000-0000-0000-000000000001",
            itemKey: "fixture-item",
            itemType: "po_review",
            title: "Review fixture PO",
            status: "active",
            priority: 50,
            sourceType: "fixture",
            ownerRole: "approver",
            assigneeId: null,
            dueAt: null,
            draft: null,
            nextActions: ["approve"],
            createdAt: "2026-07-14T17:00:00.000Z",
            updatedAt: "2026-07-14T18:00:00.000Z",
          },
          recordSnapshot: {
            contextPacketId,
            sources: [{ source: "helpdesk" }],
            facts: { ticket: "T-42" },
            freshnessState: "fresh",
            warnings: [],
            capturedAt: "2026-07-16T13:00:00.000Z",
          },
          recommendation: null,
          evidence: null,
          draft: null,
          policy: {
            minimumRole: "approver",
            requireHumanApproval: true,
            requireWarningAcknowledgement: false,
          },
          reviewState: "ready",
          version: "a".repeat(64),
          availableActions: ["approve"],
          activity: { items: [], nextPage: null },
        },
        error: null,
      })
      .mockResolvedValueOnce({ data: operationalContext, error: null })

    const detail = await getWorkflowItemDetail({
      supabase: { rpc } as unknown as WorkflowSupabaseClient,
      companyId,
      itemId,
    })

    expect(rpc).toHaveBeenNthCalledWith(
      2,
      "get_workflow_context_provenance_v1",
      {
        p_company_id: companyId,
        p_context_packet_id: contextPacketId,
      }
    )
    expect(detail.contextPacket?.operationalContext).toEqual(operationalContext)
    expect(JSON.stringify(detail)).not.toContain("similar approved resolution")
  })

  it("adds a versioned manager-safe confidence explanation to a review", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        item: {
          id: itemId,
          workflowRunId: "31000000-0000-0000-0000-000000000001",
          itemKey: "fixture-item",
          itemType: "po_review",
          title: "Review fixture PO",
          status: "active",
          priority: 50,
          sourceType: "fixture",
          ownerRole: "approver",
          assigneeId: null,
          dueAt: null,
          draft: null,
          nextActions: ["approve"],
          createdAt: "2026-07-14T17:00:00.000Z",
          updatedAt: "2026-07-14T18:00:00.000Z",
        },
        recordSnapshot: null,
        recommendation: {
          id: "34000000-0000-0000-0000-000000000001",
          status: "ready_for_review",
          rationaleSummary: "Order the reviewed quantity.",
          warningState: "warn",
          warnings: ["One source is unavailable."],
          confidence: 0.76,
          freshnessState: "fresh",
          output: { quantity: 12 },
          createdAt: "2026-07-14T18:00:00.000Z",
        },
        evidence: {
          id: "35000000-0000-0000-0000-000000000001",
          sourceRefs: [{ source: "inventory" }],
          assumptions: [],
          warnings: [],
          evidence: [],
          createdAt: "2026-07-14T18:00:00.000Z",
        },
        draft: null,
        policy: {
          minimumRole: "approver",
          requireHumanApproval: true,
          requireWarningAcknowledgement: true,
        },
        reviewState: "ready",
        version: "a".repeat(64),
        availableActions: ["approve"],
        activity: { items: [], nextPage: null },
      },
      error: null,
    })

    const rawReview = await getWorkflowReview({
      supabase: { rpc } as unknown as WorkflowSupabaseClient,
      companyId,
      itemId,
      activityLimit: 20,
    })
    const review = workItemReviewDataSchema.parse({
      ...rawReview,
      activity: { items: rawReview.activity.items },
    })

    expect(review.recommendation?.confidenceMarker).toMatchObject({
      version: "1.0.0",
      score: 0.76,
      sourceCoverage: "partial",
      freshness: "fresh",
      agreement: "mixed",
      policyChecks: "passed",
      missingInputs: ["supporting_evidence"],
    })
    expect(review.recommendation?.confidenceMarker.explanation).toContain(
      "Source coverage is partial"
    )
  })

  it("passes normalized filters and decoded snapshot state to queue v1", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { items: [], nextPage: null },
      error: null,
    })

    await listWorkflowQueue({
      supabase: { rpc } as unknown as WorkflowSupabaseClient,
      query: {
        companyId,
        search: "SKU-123",
        statuses: ["active", "approved"],
        itemTypes: ["po_review"],
        priorities: [50],
        sourceTypes: ["fixture"],
        ownerRoles: ["approver"],
        assigneeIds: [],
        sort: { key: "priority", direction: "desc" },
        limit: 25,
        cursor: "opaque-client-cursor",
      },
      page: {
        snapshotId: "3e000000-0000-0000-0000-000000000001",
        position: 25,
        snapshotAt: "2026-07-14T19:00:00.000Z",
      },
    })

    expect(rpc).toHaveBeenCalledWith("list_workflow_queue_v1", {
      p_company_id: companyId,
      p_query: {
        search: "SKU-123",
        statuses: ["active", "approved"],
        itemTypes: ["po_review"],
        priorities: [50],
        sourceTypes: ["fixture"],
        ownerRoles: ["approver"],
        assigneeIds: [],
        sort: { key: "priority", direction: "desc" },
        limit: 25,
        snapshotId: "3e000000-0000-0000-0000-000000000001",
        position: 25,
      },
    })
  })

  it("maps item authorization failures to tenant-safe absence", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "forbidden", code: "42501" },
    })
    const supabase = { rpc } as unknown as WorkflowSupabaseClient

    await expect(
      getWorkflowReview({
        supabase,
        companyId,
        itemId,
        activityLimit: 20,
      })
    ).rejects.toMatchObject({
      code: "item_not_found",
    })
    await expect(
      listWorkflowActivity({
        supabase,
        companyId,
        itemId,
        limit: 50,
      })
    ).rejects.toMatchObject({
      code: "item_not_found",
    })
    expect(rpc).toHaveBeenNthCalledWith(1, "get_workflow_review_v1", {
      p_company_id: companyId,
      p_workflow_item_id: itemId,
      p_activity_limit: 20,
      p_activity_before_created_at: null,
      p_activity_before_id: null,
    })
    expect(rpc).toHaveBeenNthCalledWith(2, "list_workflow_activity_v1", {
      p_company_id: companyId,
      p_workflow_item_id: itemId,
      p_limit: 50,
      p_before_created_at: null,
      p_before_id: null,
    })
  })

  it("maps an expired database snapshot to an invalid queue cursor", async () => {
    const supabase = {
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: { message: "invalid_queue_cursor", code: "22023" },
      }),
    } as unknown as WorkflowSupabaseClient

    await expect(
      listWorkflowQueue({
        supabase,
        query: {
          companyId,
          statuses: ["active", "blocked", "approved"],
          itemTypes: [],
          priorities: [],
          sourceTypes: [],
          ownerRoles: [],
          assigneeIds: [],
          sort: { key: "priority", direction: "desc" },
          limit: 50,
        },
        page: {
          snapshotId: "3e000000-0000-0000-0000-000000000001",
          position: 50,
          snapshotAt: "2026-07-14T19:00:00.000Z",
        },
      })
    ).rejects.toMatchObject({ code: "invalid_queue_cursor" })
  })

  it("passes concurrency and idempotency fields to decision v2", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        decision: { id: "38000000-0000-0000-0000-000000000001" },
        draft: { id: draftId },
        item: { id: itemId },
        executionToken: null,
        duplicate: true,
        needsTokenReissue: false,
        priorState: { itemStatus: "active", draftStatus: "pending_review" },
        resultState: { itemStatus: "rejected", draftStatus: "rejected" },
        version: "v2",
      },
      error: null,
    })

    await recordWorkflowDecisionV2({
      supabase: { rpc } as unknown as WorkflowSupabaseClient,
      companyId,
      workItemId: itemId,
      actionDraftId: draftId,
      decision: "reject",
      expectedVersion: "v1",
      idempotencyKey: "web:00000000-0000-4000-8000-000000000001",
      reason: "Not needed",
    })

    expect(rpc).toHaveBeenCalledWith("record_workflow_decision_v2", {
      p_company_id: companyId,
      p_workflow_item_id: itemId,
      p_action_draft_id: draftId,
      p_decision: "reject",
      p_expected_version: "v1",
      p_idempotency_key: "web:00000000-0000-4000-8000-000000000001",
      p_reason: "Not needed",
      p_warnings_acknowledged: false,
      p_edited_payload: null,
    })
  })

  it("maps an older selected draft to a refreshable conflict", async () => {
    const supabase = {
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: { message: "stale_draft", code: "40001" },
      }),
    } as unknown as WorkflowSupabaseClient

    await expect(
      recordWorkflowDecisionV2({
        supabase,
        companyId,
        workItemId: itemId,
        actionDraftId: draftId,
        decision: "reject",
        expectedVersion: "v1",
        idempotencyKey: "web:00000000-0000-4000-8000-000000000007",
        reason: "Not needed",
      })
    ).rejects.toMatchObject({ code: "stale_draft" })
  })
})
