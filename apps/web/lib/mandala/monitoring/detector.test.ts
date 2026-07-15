import { describe, expect, it } from "vitest"
import { createActiveEscalationKey, evaluateFollowUp } from "./detector"
import type { FollowUpObservation, FollowUpRecord } from "./schema"

describe("deterministic follow-up detector", () => {
  it("detects failure, overdue, stale, and unresolved conditions", () => {
    const now = new Date("2026-07-14T12:00:00.000Z")
    expect(
      evaluateFollowUp({
        followUp: followUp({ condition: { type: "failure" } }),
        observation: observation({ sourceStatus: "failed" }),
        now,
      }).reason
    ).toBe("failure_detected")
    expect(
      evaluateFollowUp({
        followUp: followUp({ condition: { type: "overdue" } }),
        observation: observation(),
        now,
      }).reason
    ).toBe("overdue_detected")
    expect(
      evaluateFollowUp({
        followUp: followUp({
          condition: { type: "stale", staleAfterMinutes: 60 },
        }),
        observation: observation({
          lastActivityAt: "2026-07-14T10:00:00.000Z",
        }),
        now,
      }).reason
    ).toBe("stale_detected")
    expect(
      evaluateFollowUp({
        followUp: followUp({ condition: { type: "unresolved" } }),
        observation: observation(),
        now,
      }).reason
    ).toBe("unresolved_detected")
  })

  it("does not escalate before due time and closes resolved sources", () => {
    const beforeDue = evaluateFollowUp({
      followUp: followUp({ dueAt: "2026-07-15T00:00:00.000Z" }),
      observation: observation({ sourceStatus: "failed" }),
      now: new Date("2026-07-14T12:00:00.000Z"),
    })
    expect(beforeDue).toMatchObject({ qualifies: false, reason: "not_due" })

    const resolved = evaluateFollowUp({
      followUp: followUp(),
      observation: observation({
        sourceStatus: "resolved",
        resolvedAt: "2026-07-14T11:00:00.000Z",
      }),
      now: new Date("2026-07-14T12:00:00.000Z"),
    })
    expect(resolved).toMatchObject({
      qualifies: false,
      reason: "source_resolved",
    })
  })

  it("keeps reopen keys stable and versions every new occurrence explicitly", () => {
    const first = followUp({ recurrencePolicy: "reopen", occurrence: 1 })
    const reopened = followUp({ recurrencePolicy: "reopen", occurrence: 2 })
    expect(createActiveEscalationKey(reopened)).toBe(
      createActiveEscalationKey(first)
    )
    expect(
      createActiveEscalationKey({
        ...reopened,
        recurrencePolicy: "new_occurrence",
      })
    ).toBe(`${createActiveEscalationKey(reopened)}:2`)
    expect(
      createActiveEscalationKey({
        ...reopened,
        recurrencePolicy: "new_occurrence",
        occurrence: 3,
      })
    ).toBe(`${createActiveEscalationKey(reopened)}:3`)
  })
})

export function followUp(
  overrides: Partial<FollowUpRecord> = {}
): FollowUpRecord {
  return {
    id: "80000000-0000-4000-8000-000000000001",
    companyId: "20000000-0000-4000-8000-000000000001",
    workflowId: null,
    workflowRunId: null,
    sourceItemId: "30000000-0000-4000-8000-000000000001",
    actionAttemptId: null,
    condition: { type: "failure" },
    dueAt: "2026-07-14T11:00:00.000Z",
    severity: "high",
    ruleVersion: "failure-v1",
    recurrencePolicy: "reopen",
    maxAttempts: 5,
    status: "leased",
    occurrence: 1,
    attempts: 1,
    leaseOwner: "worker-1",
    leaseExpiresAt: "2026-07-14T12:01:00.000Z",
    lastEvaluatedAt: null,
    createdAt: "2026-07-14T10:00:00.000Z",
    updatedAt: "2026-07-14T12:00:00.000Z",
    ...overrides,
  }
}

export function observation(
  overrides: Partial<FollowUpObservation> = {}
): FollowUpObservation {
  return {
    sourceStatus: "pending",
    lastActivityAt: "2026-07-14T11:30:00.000Z",
    resolvedAt: null,
    ...overrides,
  }
}
