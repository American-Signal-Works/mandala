import { describe, expect, it, vi } from "vitest"
import type { SignalDispatchRepository } from "./repository"
import type { SignalDispatch } from "./schema"
import {
  runSignalDispatchBatch,
  SignalExecutionError,
  type SignalDispatchExecutor,
} from "./worker"

describe("runSignalDispatchBatch", () => {
  it("completes, suppresses, retries, and dead-letters independent signals", async () => {
    const leases = [
      lease("completed", 1),
      lease("suppressed", 2),
      lease("retry", 3),
      lease("terminal", 4),
      lease("invalid-result", 5),
    ]
    const repository = repositoryFor(leases)
    repository.fail = vi.fn(async ({ errorCode }) =>
      errorCode === "provider_unavailable" ? "pending" : "dead_letter"
    )
    const execute: SignalDispatchExecutor["execute"] = async (dispatch) => {
      switch (dispatch.triggerId) {
        case "completed":
          return { status: "completed", result: { candidateCount: 1 } }
        case "suppressed":
          return { status: "suppressed", result: { reason: "no_signal" } }
        case "retry":
          throw new SignalExecutionError("provider_unavailable", true)
        case "terminal":
          throw new SignalExecutionError("invalid_provider_contract", false)
        default:
          return { status: "bad", result: {} } as unknown as Awaited<
            ReturnType<SignalDispatchExecutor["execute"]>
          >
      }
    }
    const executor: SignalDispatchExecutor = {
      execute: vi.fn(execute),
    }

    await expect(
      runSignalDispatchBatch({
        repository,
        executor,
        workerId: "signal-worker-1",
        concurrency: 2,
        now: new Date("2026-07-16T12:00:00.000Z"),
      })
    ).resolves.toMatchObject({
      claimed: 5,
      completed: 1,
      suppressed: 1,
      retryScheduled: 1,
      deadLettered: 2,
      leaseUnresolved: 0,
    })
    expect(repository.complete).toHaveBeenCalledTimes(2)
    expect(repository.fail).toHaveBeenCalledTimes(3)
    expect(repository.fail).toHaveBeenCalledWith(
      expect.objectContaining({
        retryable: false,
        errorCode: "invalid_signal_execution_result",
      })
    )
  })

  it("leaves an executed dispatch recoverable when completion storage fails", async () => {
    const repository = repositoryFor([lease("completed", 1)])
    repository.complete = vi.fn().mockRejectedValue(new Error("db unavailable"))

    const result = await runSignalDispatchBatch({
      repository,
      executor: {
        execute: async () => ({ status: "completed", result: {} }),
      },
      workerId: "signal-worker-1",
      now: new Date("2026-07-16T12:00:00.000Z"),
    })

    expect(result).toMatchObject({ claimed: 1, leaseUnresolved: 1 })
    expect(repository.fail).not.toHaveBeenCalled()
  })

  it("bounds parallel provider/runtime work", async () => {
    const repository = repositoryFor(
      Array.from({ length: 8 }, (_, index) => lease(`job-${index}`, index + 1))
    )
    let active = 0
    let maximumActive = 0

    await runSignalDispatchBatch({
      repository,
      executor: {
        execute: async () => {
          active += 1
          maximumActive = Math.max(maximumActive, active)
          await Promise.resolve()
          active -= 1
          return { status: "completed", result: {} }
        },
      },
      workerId: "signal-worker-1",
      concurrency: 3,
      now: new Date("2026-07-16T12:00:00.000Z"),
    })

    expect(maximumActive).toBe(3)
  })
})

function repositoryFor(
  leases: ReturnType<typeof lease>[]
): SignalDispatchRepository {
  return {
    prepare: vi.fn(),
    claim: vi.fn().mockResolvedValue(leases),
    complete: vi.fn(),
    fail: vi.fn(),
  }
}

function lease(triggerId: string, ordinal: number) {
  const suffix = String(ordinal).padStart(12, "0")
  const dispatch: SignalDispatch = {
    id: `d5100000-0000-4000-8000-${suffix}`,
    companyId: "d2000000-0000-4000-8000-000000000001",
    workflowId: "d3000000-0000-4000-8000-000000000001",
    bindingSnapshotId: "d3100000-0000-4000-8000-000000000001",
    changeWindowId: null,
    triggerId,
    triggerKind: "schedule",
    signalKind: "schedule",
    executionMode: "shadow",
    trigger: { id: triggerId, kind: "schedule" },
    input: { scheduledFor: "2026-07-16T12:00:00.000Z" },
    attempt: 1,
    maxAttempts: 5,
    createdAt: "2026-07-16T12:00:00.000Z",
  }
  return {
    leaseId: `d5000000-0000-4000-8000-${suffix}`,
    dispatch,
  }
}
