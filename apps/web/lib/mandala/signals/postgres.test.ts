import { describe, expect, it, vi } from "vitest"
import { PostgresSignalDispatchRepository } from "./postgres"
import { SignalRepositoryError } from "./repository"

describe("PostgresSignalDispatchRepository", () => {
  it("maps preparation, claiming, completion, and failure through private RPCs", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            result: {
              changeWindowsProcessed: 2,
              changeDispatchesEnqueued: 1,
              scheduleDispatchesEnqueued: 1,
              reconciliationDispatchesEnqueued: 1,
              preparedAt: "2026-07-16T12:00:00.000Z",
            },
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [lease()] })
      .mockResolvedValueOnce({ rows: [{ result: { status: "completed" } }] })
      .mockResolvedValueOnce({
        rows: [{ result: { status: "dead_letter" } }],
      })
    const repository = new PostgresSignalDispatchRepository({ query })

    await expect(
      repository.prepare({
        now: "2026-07-16T12:00:00.000Z",
        changeLimit: 100,
        scheduleLimit: 100,
      })
    ).resolves.toMatchObject({ changeWindowsProcessed: 2 })
    const [claimed] = await repository.claim({
      workerId: "worker-1",
      limit: 10,
      leaseSeconds: 120,
      now: "2026-07-16T12:00:00.000Z",
    })
    await repository.complete({
      workerId: "worker-1",
      lease: claimed!,
      outcome: { status: "completed", result: { candidateCount: 2 } },
    })
    await expect(
      repository.fail({
        workerId: "worker-1",
        lease: claimed!,
        retryable: false,
        errorCode: "invalid_provider_contract",
      })
    ).resolves.toBe("dead_letter")

    expect(query).toHaveBeenCalledTimes(4)
    expect(query.mock.calls[0]![0]).toContain("prepare_agent_signal_dispatches")
    expect(query.mock.calls[1]![0]).toContain("claim_agent_signal_dispatches")
    expect(query.mock.calls[2]![1]).toEqual([
      "worker-1",
      "d5000000-0000-4000-8000-000000000001",
      "completed",
      '{"candidateCount":2}',
    ])
    expect(query.mock.calls[3]![1]).toEqual([
      "worker-1",
      "d5000000-0000-4000-8000-000000000001",
      false,
      "invalid_provider_contract",
    ])
  })

  it("rejects malformed database responses", async () => {
    const repository = new PostgresSignalDispatchRepository({
      query: vi.fn().mockResolvedValue({
        rows: [{ leaseId: "not-a-uuid", dispatch: {} }],
      }),
    })

    await expect(
      repository.claim({
        workerId: "worker-1",
        limit: 10,
        leaseSeconds: 120,
        now: "2026-07-16T12:00:00.000Z",
      })
    ).rejects.toMatchObject({
      code: "repository_invalid_response",
    } satisfies Partial<SignalRepositoryError>)
  })

  it("maps lost leases without exposing raw database errors", async () => {
    const repository = new PostgresSignalDispatchRepository({
      query: vi.fn().mockRejectedValue(new Error("agent_signal_lease_lost")),
    })

    await expect(
      repository.complete({
        workerId: "worker-1",
        lease: lease(),
        outcome: { status: "suppressed", result: {} },
      })
    ).rejects.toMatchObject({
      code: "lease_lost",
    } satisfies Partial<SignalRepositoryError>)
  })
})

function lease() {
  return {
    leaseId: "d5000000-0000-4000-8000-000000000001",
    dispatch: {
      id: "d5100000-0000-4000-8000-000000000001",
      companyId: "d2000000-0000-4000-8000-000000000001",
      workflowId: "d3000000-0000-4000-8000-000000000001",
      bindingSnapshotId: "d3100000-0000-4000-8000-000000000001",
      changeWindowId: "d4100000-0000-4000-8000-000000000001",
      triggerId: "inventory-change",
      triggerKind: "webhook",
      signalKind: "record_change",
      executionMode: "shadow",
      trigger: { id: "inventory-change", kind: "webhook" },
      input: { recordType: "inventory_position" },
      attempt: 1,
      maxAttempts: 5,
      createdAt: "2026-07-16T12:00:00.000Z",
    },
  } as const
}
