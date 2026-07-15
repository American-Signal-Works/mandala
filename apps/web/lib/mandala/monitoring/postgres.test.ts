import { describe, expect, it, vi } from "vitest"
import { PostgresMonitoringWorkerRepository } from "./postgres"
import type { MonitoringDecision, MonitoringLease } from "./schema"

describe("Postgres monitoring worker repository", () => {
  it("claims with a bounded lease and completes through private functions", async () => {
    const lease = monitoringLease()
    const completion = { escalation: null, duplicate: false }
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [lease] })
      .mockResolvedValueOnce({ rows: [{ result: completion }] })
    const repository = new PostgresMonitoringWorkerRepository({ query })

    await expect(
      repository.claimDue({
        workerId: "worker-1",
        limit: 10,
        leaseSeconds: 60,
        now: "2026-07-14T12:00:00.000Z",
      })
    ).resolves.toEqual([lease])
    expect(query.mock.calls[0]?.[0]).toContain(
      "workflow_private.claim_due_agent_follow_ups"
    )

    const decision: MonitoringDecision = {
      qualifies: false,
      activeKey: "company:item:rule:failure",
      reason: "source_resolved",
      evaluatedAt: "2026-07-14T12:00:00.000Z",
    }
    await expect(
      repository.completeClaim({ workerId: "worker-1", lease, decision })
    ).resolves.toEqual(completion)
    expect(query.mock.calls[1]?.[0]).toContain(
      "workflow_private.complete_agent_follow_up_claim"
    )
  })

  it("passes terminal failures to the dead-letter decision boundary", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] })
    const repository = new PostgresMonitoringWorkerRepository({ query })
    const lease = monitoringLease()
    await repository.failClaim({
      workerId: "worker-1",
      lease,
      retryable: false,
      errorCode: "invalid_projection",
    })
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("workflow_private.fail_agent_follow_up_claim"),
      ["worker-1", lease.leaseId, false, "invalid_projection"]
    )
  })
})

function monitoringLease(): MonitoringLease {
  return {
    leaseId: "a0000000-0000-4000-8000-000000000001",
    followUp: {
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
    },
    observation: {
      sourceStatus: "resolved",
      lastActivityAt: "2026-07-14T11:00:00.000Z",
      resolvedAt: "2026-07-14T11:30:00.000Z",
    },
  }
}
