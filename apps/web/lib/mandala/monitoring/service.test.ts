import { describe, expect, it, vi } from "vitest"
import type { MonitoringWorkerRepository } from "./repository"
import { runMonitoringBatch } from "./service"
import type {
  FollowUpObservation,
  FollowUpRecord,
  MonitoringLease,
} from "./schema"

describe("monitoring worker service", () => {
  it("claims bounded leases and delegates atomic escalation dedupe", async () => {
    const lease = monitoringLease()
    const repository = workerRepository([lease])
    vi.mocked(repository.completeClaim).mockResolvedValue({
      escalation: {
        id: "90000000-0000-4000-8000-000000000001",
        companyId: lease.followUp.companyId,
        followUpId: lease.followUp.id,
        sourceItemId: lease.followUp.sourceItemId,
        activeKey: [
          lease.followUp.companyId,
          lease.followUp.sourceItemId,
          lease.followUp.ruleVersion,
          lease.followUp.condition.type,
        ].join(":"),
        reason: "failure_detected",
        severity: "high",
        status: "open",
        occurrence: 1,
        openedAt: "2026-07-14T12:00:00.000Z",
        resolvedAt: null,
        updatedAt: "2026-07-14T12:00:00.000Z",
      },
      duplicate: true,
    })

    const summary = await runMonitoringBatch({
      repository,
      workerId: "worker-1",
      now: new Date("2026-07-14T12:00:00.000Z"),
      limit: 10,
      leaseSeconds: 60,
    })

    expect(repository.claimDue).toHaveBeenCalledWith({
      workerId: "worker-1",
      limit: 10,
      leaseSeconds: 60,
      now: "2026-07-14T12:00:00.000Z",
    })
    expect(repository.completeClaim).toHaveBeenCalledWith({
      workerId: "worker-1",
      lease,
      decision: expect.objectContaining({
        qualifies: true,
        reason: "failure_detected",
      }),
    })
    expect(summary).toMatchObject({
      claimed: 1,
      evaluated: 1,
      escalated: 1,
      deduplicated: 1,
      failed: 0,
    })
  })

  it("releases a failed claim through the retry boundary", async () => {
    const lease = monitoringLease()
    const repository = workerRepository([lease])
    vi.mocked(repository.completeClaim).mockRejectedValue(new Error("offline"))
    const summary = await runMonitoringBatch({
      repository,
      workerId: "worker-1",
      now: new Date("2026-07-14T12:00:00.000Z"),
    })
    expect(summary.failed).toBe(1)
    expect(repository.failClaim).toHaveBeenCalledWith({
      workerId: "worker-1",
      lease,
      retryable: true,
      errorCode: "error",
    })
  })
})

function monitoringLease(): MonitoringLease {
  return {
    leaseId: "a0000000-0000-4000-8000-000000000001",
    followUp: followUp(),
    observation: observation({ sourceStatus: "failed" }),
  }
}

function workerRepository(
  leases: MonitoringLease[]
): MonitoringWorkerRepository {
  return {
    claimDue: vi.fn().mockResolvedValue(leases),
    completeClaim: vi.fn(),
    failClaim: vi.fn().mockResolvedValue(undefined),
  }
}

function followUp(overrides: Partial<FollowUpRecord> = {}): FollowUpRecord {
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

function observation(
  overrides: Partial<FollowUpObservation> = {}
): FollowUpObservation {
  return {
    sourceStatus: "pending",
    lastActivityAt: "2026-07-14T11:30:00.000Z",
    resolvedAt: null,
    ...overrides,
  }
}
