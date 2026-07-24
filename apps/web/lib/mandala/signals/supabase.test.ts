import { describe, expect, it, vi } from "vitest"
import type { SignalLease } from "./schema"
import {
  SupabaseSignalDispatchRepository,
  type SignalRpcExecutor,
} from "./supabase"

describe("SupabaseSignalDispatchRepository", () => {
  it("uses the service-only queue RPCs for the full lease lifecycle", async () => {
    const lease = signalLease()
    const rpc = vi.fn(async (name: string) => {
      if (name === "prepare_agent_signal_dispatches_v1") {
        return {
          data: {
            changeWindowsProcessed: 2,
            changeDispatchesEnqueued: 1,
            scheduleDispatchesEnqueued: 0,
            reconciliationDispatchesEnqueued: 0,
            preparedAt: "2026-07-24T18:30:00.000Z",
          },
          error: null,
        }
      }
      if (name === "claim_agent_signal_dispatches_v1") {
        return { data: [lease], error: null }
      }
      if (name === "fail_agent_signal_dispatch_v1") {
        return { data: { status: "pending" }, error: null }
      }
      return { data: { status: "completed" }, error: null }
    })
    const repository = new SupabaseSignalDispatchRepository({
      rpc,
    } as SignalRpcExecutor)

    await expect(
      repository.prepare({
        now: "2026-07-24T18:30:00.000Z",
        changeLimit: 500,
        scheduleLimit: 100,
      })
    ).resolves.toMatchObject({ changeDispatchesEnqueued: 1 })
    await expect(
      repository.claim({
        workerId: "worker-1",
        limit: 10,
        leaseSeconds: 300,
        now: "2026-07-24T18:30:00.000Z",
      })
    ).resolves.toEqual([lease])
    await expect(
      repository.complete({
        workerId: "worker-1",
        lease,
        outcome: { status: "completed", result: { itemId: "item-1" } },
      })
    ).resolves.toBeUndefined()
    await expect(
      repository.fail({
        workerId: "worker-1",
        lease,
        retryable: true,
        errorCode: "provider_unavailable",
      })
    ).resolves.toBe("pending")

    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      "prepare_agent_signal_dispatches_v1",
      "claim_agent_signal_dispatches_v1",
      "complete_agent_signal_dispatch_v1",
      "fail_agent_signal_dispatch_v1",
    ])
  })

  it("rejects malformed queue responses", async () => {
    const repository = new SupabaseSignalDispatchRepository({
      rpc: vi.fn().mockResolvedValue({ data: {}, error: null }),
    })

    await expect(
      repository.claim({
        workerId: "worker-1",
        limit: 10,
        leaseSeconds: 300,
        now: "2026-07-24T18:30:00.000Z",
      })
    ).rejects.toMatchObject({
      code: "repository_invalid_response",
    })
  })
})

function signalLease(): SignalLease {
  return {
    leaseId: "d5100000-0000-4000-8000-000000000001",
    dispatch: {
      id: "d5000000-0000-4000-8000-000000000001",
      companyId: "d2000000-0000-4000-8000-000000000001",
      workflowId: "d3000000-0000-4000-8000-000000000001",
      bindingSnapshotId: "d3100000-0000-4000-8000-000000000001",
      changeWindowId: "d4000000-0000-4000-8000-000000000001",
      triggerId: "procurement-records-changed",
      triggerKind: "webhook",
      signalKind: "record_change",
      executionMode: "mock",
      trigger: {
        id: "procurement-records-changed",
        kind: "webhook",
      },
      input: { recordType: "inventory_position" },
      attempt: 1,
      maxAttempts: 5,
      createdAt: "2026-07-24T18:30:00.000Z",
    },
  }
}
