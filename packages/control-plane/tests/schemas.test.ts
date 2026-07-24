import { describe, expect, it } from "vitest"
import {
  apiErrorEnvelopeSchema,
  controlIntentCandidateSchema,
  controlIntentProposalSchema,
  controlIntentSchema,
  decisionResponseSchema,
  decisionRequestSchema,
  executionRequestSchema,
  fixtureRunRequestSchema,
  safeWorkItemSummarySchema,
  workItemActivityDataSchema,
  workItemDetailSchema,
  workItemQueueRequestSchema,
  workItemReviewDataSchema,
} from "../src/index.js"

const companyId = "20000000-0000-4000-8000-000000000001"
const itemId = "30000000-0000-4000-8000-000000000001"

describe("control-plane schemas", () => {
  it("round trips a serializable control intent", () => {
    const intent = controlIntentSchema.parse({
      kind: "execute_mock_action",
      companyId,
      itemId,
      risk: "mock_execution",
    })

    expect(
      controlIntentSchema.parse(JSON.parse(JSON.stringify(intent)))
    ).toEqual(intent)
  })

  it("keeps model candidates authority-free and strict", () => {
    const candidate = {
      kind: "record_decision",
      scenarioId: null,
      status: null,
      itemId,
      decision: "approve",
      patches: [],
      reason: null,
    }

    expect(controlIntentCandidateSchema.parse(candidate)).toEqual(candidate)
    expect(
      controlIntentCandidateSchema.safeParse({
        ...candidate,
        companyId,
      }).success
    ).toBe(false)
    expect(
      controlIntentCandidateSchema.safeParse({
        ...candidate,
        risk: "state_change",
      }).success
    ).toBe(false)
    expect(
      controlIntentCandidateSchema.safeParse({
        ...candidate,
        warningsAcknowledged: true,
      }).success
    ).toBe(false)
  })

  it("bounds model patches without narrowing explicit CLI patches", () => {
    const candidate = {
      kind: "record_decision",
      scenarioId: null,
      status: null,
      itemId,
      decision: "edit",
      patches: [{ pointer: "/lines/0/quantity", value: 24 }],
      reason: "Reviewed",
    }

    expect(controlIntentCandidateSchema.safeParse(candidate).success).toBe(true)
    expect(
      controlIntentCandidateSchema.safeParse({
        ...candidate,
        patches: [{ pointer: "/lines", value: [{ quantity: 24 }] }],
      }).success
    ).toBe(false)
    expect(
      controlIntentCandidateSchema.safeParse({
        ...candidate,
        patches: Array.from({ length: 11 }, (_, index) => ({
          pointer: `/lines/${index}/quantity`,
          value: index,
        })),
      }).success
    ).toBe(false)
    expect(
      controlIntentCandidateSchema.safeParse({
        ...candidate,
        patches: [{ pointer: "x".repeat(257), value: 24 }],
      }).success
    ).toBe(false)

    expect(
      decisionRequestSchema.safeParse({
        companyId,
        workItemId: itemId,
        actionDraftId: "40000000-0000-4000-8000-000000000001",
        decision: "edit",
        expectedVersion: "a".repeat(64),
        idempotencyKey: "cli:00000000-0000-4000-8000-000000000001",
        reason: "Reviewed",
        editedPayload: { lines: [{ quantity: 24 }] },
      }).success
    ).toBe(true)
  })

  it("requires structured unresolved model proposals", () => {
    expect(
      controlIntentProposalSchema.safeParse({
        resolution: "clarification_required",
        candidate: null,
        questions: [],
        reasonCode: null,
        reasons: [],
      }).success
    ).toBe(false)
  })

  it("keeps fixture scenarios generic and bounded", () => {
    expect(
      fixtureRunRequestSchema.parse({ companyId, scenarioId: "example_case" })
    ).toEqual({
      companyId,
      scenarioId: "example_case",
    })
    expect(
      fixtureRunRequestSchema.safeParse({
        companyId,
        scenarioId: "bad scenario",
      }).success
    ).toBe(false)
  })

  it("rejects unstructured idempotency values that could contain capabilities", () => {
    const request = {
      companyId,
      actionDraftId: "40000000-0000-4000-8000-000000000001",
      decisionId: "50000000-0000-4000-8000-000000000001",
      rawToken: "a".repeat(64),
      payload: {},
    }

    expect(
      executionRequestSchema.safeParse({
        ...request,
        idempotencyKey: "a".repeat(64),
      }).success
    ).toBe(false)
    expect(
      executionRequestSchema.safeParse({
        ...request,
        idempotencyKey: "cli:00000000-0000-4000-8000-000000000001",
      }).success
    ).toBe(true)
  })

  it("uses a stable error envelope", () => {
    expect(
      apiErrorEnvelopeSchema.parse({ ok: false, error: { code: "forbidden" } })
    ).toEqual({
      ok: false,
      error: { code: "forbidden" },
    })
  })

  it("bounds queue search, filters, sorting, and opaque cursors", () => {
    expect(
      workItemQueueRequestSchema.parse({
        companyId,
        search: "  coffee beans  ",
        statuses: ["active", "blocked"],
        itemTypes: ["procurement_reorder_review"],
        priorities: [50],
        sourceTypes: ["inventory"],
        ownerRoles: ["approver"],
        assigneeIds: ["40000000-0000-4000-8000-000000000001"],
        cursor: "signed_cursor_1",
      })
    ).toMatchObject({
      search: "coffee beans",
      sort: { key: "priority", direction: "desc" },
      limit: 50,
    })
    expect(
      workItemQueueRequestSchema.safeParse({
        companyId,
        search: "coffee\nbeans",
      }).success
    ).toBe(false)
    expect(
      workItemQueueRequestSchema.safeParse({ companyId, limit: 101 }).success
    ).toBe(false)
    expect(
      workItemQueueRequestSchema.safeParse({
        companyId,
        ownerRoles: ["warehouse_manager"],
      }).success
    ).toBe(false)
    expect(
      workItemQueueRequestSchema.safeParse({
        companyId,
        cursor: "not an opaque cursor",
      }).success
    ).toBe(false)
  })

  it("keeps queue summaries allowlisted and server-actionable", () => {
    const summary = safeWorkItemSummary()

    expect(safeWorkItemSummarySchema.parse(summary).nextActions).toEqual([
      "approve",
      "resolve",
    ])
    expect(
      safeWorkItemSummarySchema.safeParse({
        ...summary,
        rawTrace: { token: "secret" },
      }).success
    ).toBe(false)
  })

  it.each([
    "ready",
    "blocked",
    "stale",
    "missing_context",
    "already_resolved",
  ] as const)("accepts the explicit %s review state", (reviewState) => {
    const review = workItemReviewDataSchema.parse({
      item: safeWorkItemSummary(),
      recordSnapshot: null,
      recommendation: null,
      evidence: null,
      draft: null,
      policy: {
        minimumRole: "approver",
        requireHumanApproval: true,
        requireWarningAcknowledgement: false,
      },
      reviewState,
      version: "v1:review-version",
      availableActions: reviewState === "ready" ? ["resolve"] : [],
      activity: { items: [] },
    })

    expect(review.reviewState).toBe(reviewState)
  })

  it("allows an approved review to advertise mock execution", () => {
    const review = workItemReviewDataSchema.parse({
      item: {
        ...safeWorkItemSummary(),
        status: "approved",
        nextActions: ["execute_mock"],
      },
      recordSnapshot: null,
      recommendation: null,
      evidence: null,
      draft: null,
      policy: {
        minimumRole: "approver",
        requireHumanApproval: true,
        requireWarningAcknowledgement: false,
      },
      reviewState: "already_resolved",
      version: "v1:approved-review",
      availableActions: ["execute_mock"],
      activity: { items: [] },
    })

    expect(review.availableActions).toEqual(["execute_mock"])
  })

  it("requires attributed, bounded activity events", () => {
    expect(
      workItemActivityDataSchema.parse({
        items: [activityEvent()],
        nextCursor: "activity_cursor_1",
      }).items[0]?.actor
    ).toEqual({ type: "user", id: "50000000-0000-4000-8000-000000000001" })
    expect(
      workItemActivityDataSchema.safeParse({
        items: [{ ...activityEvent(), trace: { prompt: "secret" } }],
      }).success
    ).toBe(false)
  })

  it("requires decision versions and idempotency and keeps resolve draft-free", () => {
    const common = {
      companyId,
      workItemId: itemId,
      expectedVersion: "a".repeat(64),
      idempotencyKey: "cli:00000000-0000-4000-8000-000000000001",
    }

    expect(
      decisionRequestSchema.safeParse({ ...common, decision: "resolve" })
        .success
    ).toBe(true)
    expect(
      decisionRequestSchema.safeParse({
        ...common,
        actionDraftId: "40000000-0000-4000-8000-000000000001",
        decision: "resolve",
      }).success
    ).toBe(false)
    expect(
      decisionRequestSchema.safeParse({
        companyId,
        workItemId: itemId,
        actionDraftId: "40000000-0000-4000-8000-000000000001",
        decision: "approve",
      }).success
    ).toBe(false)
  })

  it("returns stable decision replay and state transition fields", () => {
    const result = decisionResponseSchema.parse({
      decision: {
        id: "60000000-0000-4000-8000-000000000001",
        decision: "resolve",
      },
      draft: null,
      item: { id: itemId, status: "resolved" },
      executionToken: null,
      duplicate: true,
      needsTokenReissue: false,
      priorState: { itemStatus: "active", draftStatus: null },
      resultState: { itemStatus: "resolved", draftStatus: null },
      version: "b".repeat(64),
    })

    expect(result).toMatchObject({ duplicate: true, draft: null })
  })

  it("defaults absent detail collections to empty arrays", () => {
    const detail = workItemDetailSchema.parse({
      item: {
        id: itemId,
        workflowRunId: "40000000-0000-4000-8000-000000000001",
        itemType: "example_review",
        title: "Review example",
        status: "active",
        priority: 50,
        resolutionState: {},
        createdAt: "2026-07-09T12:00:00.000Z",
        updatedAt: "2026-07-09T12:00:00.000Z",
      },
      contextPacket: null,
      recommendation: null,
      evidence: null,
      draft: null,
      decision: null,
      attempt: null,
      auditEvents: [],
    })

    expect(detail.decision).toBeNull()
    expect(detail.attempt).toBeNull()
    expect(detail.auditEvents).toEqual([])
  })
})

function safeWorkItemSummary() {
  return {
    id: itemId,
    workflowRunId: "40000000-0000-4000-8000-000000000001",
    itemKey: "reorder:coffee-beans",
    itemType: "procurement_reorder_review",
    title: "Review coffee bean reorder",
    status: "active" as const,
    priority: 50,
    sourceType: "inventory",
    ownerRole: "approver",
    assigneeId: "50000000-0000-4000-8000-000000000001",
    dueAt: null,
    draft: null,
    nextActions: ["approve" as const, "resolve" as const],
    createdAt: "2026-07-09T12:00:00.000Z",
    updatedAt: "2026-07-09T12:00:00.000Z",
  }
}

function activityEvent() {
  return {
    id: "70000000-0000-4000-8000-000000000001",
    type: "decision_recorded",
    summary: "The reorder was approved.",
    details: { decision: "approve" },
    actor: {
      type: "user" as const,
      id: "50000000-0000-4000-8000-000000000001",
    },
    reason: "Stock is below target.",
    priorState: {
      itemStatus: "active" as const,
      draftStatus: "pending_review" as const,
    },
    resultState: {
      itemStatus: "approved" as const,
      draftStatus: "approved" as const,
    },
    createdAt: "2026-07-09T12:00:00.000Z",
  }
}
