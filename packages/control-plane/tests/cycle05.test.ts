import { describe, expect, it } from "vitest"
import {
  actionContractSchema,
  agentLifecycleTransitionRequestSchema,
  contextualChatRequestSchema,
  controlledExecutionResultSchema,
  memoryCandidateSchema,
  memoryRetrievalRequestSchema,
} from "../src/index.js"

const companyId = "20000000-0000-4000-8000-000000000001"
const uuid = (prefix: number) => `${prefix}0000000-0000-4000-8000-000000000001`
const timestamp = "2026-07-14T20:00:00.000Z"

describe("cycle 0.0.5 contracts", () => {
  it("requires registered versioned actions and explicit modes", () => {
    const contract = actionContractSchema.parse({
      id: "procurement.purchase_order.create",
      version: "1.0.0",
      capabilityId: "procurement.purchase-order.execute",
      capabilityVersion: "1.0.0",
      connectorId: "synthetic-commerce",
      inputSchemaDigest: "a".repeat(64),
      outputSchemaDigest: "b".repeat(64),
      allowedModes: ["fixture", "mock", "dry_run", "shadow"],
      requiresApproval: true,
      timeoutMs: 10_000,
      retryClass: "provider_idempotent",
    })
    expect(contract.allowedModes).not.toContain("live")
  })

  it("represents ambiguous provider outcomes without claiming failure", () => {
    expect(
      controlledExecutionResultSchema.parse({
        attemptId: uuid(3),
        mode: "live",
        status: "reconciliation_required",
        effect: "unknown",
        retryClass: "reconcile_first",
        attemptNumber: 1,
        output: null,
        errorCode: "provider_timeout_after_write",
        providerReference: null,
        reconciliationRequired: true,
        createdAt: timestamp,
        completedAt: timestamp,
      }).reconciliationRequired
    ).toBe(true)
  })

  it("requires version and reason for lifecycle changes", () => {
    expect(
      agentLifecycleTransitionRequestSchema.safeParse({
        companyId,
        action: "pause",
        expectedVersion: 2,
        reason: "Vendor feed is stale",
      }).success
    ).toBe(true)
    expect(
      agentLifecycleTransitionRequestSchema.safeParse({
        companyId,
        action: "pause",
        expectedVersion: 2,
        reason: "",
      }).success
    ).toBe(false)
  })

  it("keeps memory provenance and governance explicit", () => {
    expect(
      memoryCandidateSchema.parse({
        id: uuid(4),
        scope: {
          companyId,
          agentId: null,
          subjectType: "vendor",
          subjectId: "fixture-tea-supply",
        },
        status: "approved",
        content: { note: "Lead time is usually 21 days." },
        provenance: {
          feedbackId: null,
          workItemId: uuid(5),
          recommendationId: uuid(6),
          sourceVersion: "review:v1",
          sourceHash: "c".repeat(64),
        },
        confidence: 0.9,
        classification: "internal",
        reviewerId: uuid(7),
        expiresAt: null,
        supersedesId: null,
        providerReference: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      }).status
    ).toBe("approved")
  })

  it("bounds memory retrieval and requires explicit chat context", () => {
    expect(
      memoryRetrievalRequestSchema.parse({ companyId, query: "vendor timing" })
        .limit
    ).toBe(5)
    expect(
      contextualChatRequestSchema.safeParse({
        companyId,
        input: "Is this quantity reasonable?",
        selectedItemId: uuid(8),
        expectedReviewVersion: "review:v2",
        conversationId: uuid(9),
      }).success
    ).toBe(true)
  })
})
