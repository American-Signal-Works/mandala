import { describe, expect, it } from "vitest"
import {
  apiErrorEnvelopeSchema,
  controlIntentCandidateSchema,
  controlIntentProposalSchema,
  controlIntentSchema,
  decisionRequestSchema,
  executionRequestSchema,
  fixtureRunRequestSchema,
  workItemDetailSchema,
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
        actionDraftId: "40000000-0000-4000-8000-000000000001",
        decision: "edit",
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
