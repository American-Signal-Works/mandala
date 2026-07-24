import { describe, expect, it, vi } from "vitest"
import { WorkspaceDataProviderError } from "../workspace-data/provider"
import { ManualRunAgentNotActiveError } from "../agents/manual-run"
import { createAgentSignalExecutor } from "./agent-executor"

const dispatch = {
  id: "d5000000-0000-4000-8000-000000000001",
  companyId: "d2000000-0000-4000-8000-000000000001",
  workflowId: "d3000000-0000-4000-8000-000000000001",
  bindingSnapshotId: "d3100000-0000-4000-8000-000000000001",
  changeWindowId: "d4000000-0000-4000-8000-000000000001",
  triggerId: "procurement-records-changed",
  triggerKind: "webhook" as const,
  signalKind: "record_change" as const,
  executionMode: "mock" as const,
  trigger: {},
  input: {},
  attempt: 1,
  maxAttempts: 5,
  createdAt: "2026-07-24T18:30:00.000Z",
}

describe("createAgentSignalExecutor", () => {
  it("completes a persisted review without attempting an external write", async () => {
    const run = vi.fn().mockResolvedValue({
      workflowRunId: "d6000000-0000-4000-8000-000000000001",
      status: "waiting_for_approval",
      itemId: "d7000000-0000-4000-8000-000000000001",
      entity: { key: "sku", value: "SKU-REAL" },
      duplicate: false,
    })
    const executor = createAgentSignalExecutor({
      supabase: {} as never,
      run,
    })

    await expect(executor.execute(dispatch)).resolves.toEqual({
      status: "completed",
      result: {
        workflowRunId: "d6000000-0000-4000-8000-000000000001",
        itemId: "d7000000-0000-4000-8000-000000000001",
        runStatus: "waiting_for_approval",
        entityKey: "sku",
        entityValue: "SKU-REAL",
        duplicate: false,
        externalWriteAttempted: false,
      },
    })
  })

  it("treats an idempotent duplicate as completed without an external write", async () => {
    const executor = createAgentSignalExecutor({
      supabase: {} as never,
      run: vi.fn().mockResolvedValue({
        workflowRunId: "d6000000-0000-4000-8000-000000000001",
        status: "waiting_for_approval",
        itemId: "d7000000-0000-4000-8000-000000000001",
        entity: { key: "sku", value: "SKU-REAL" },
        duplicate: true,
      }),
    })

    await expect(
      executor.execute({ ...dispatch, attempt: 2 })
    ).resolves.toMatchObject({
      status: "completed",
      result: {
        duplicate: true,
        externalWriteAttempted: false,
      },
    })
  })

  it("suppresses a connector change when no current record qualifies", async () => {
    const executor = createAgentSignalExecutor({
      supabase: {} as never,
      run: vi
        .fn()
        .mockRejectedValue(
          new WorkspaceDataProviderError(
            "qualifying_signal_not_found",
            "No matching candidate."
          )
        ),
    })

    await expect(executor.execute(dispatch)).resolves.toEqual({
      status: "suppressed",
      result: {
        reason: "qualifying_signal_not_found",
        externalWriteAttempted: false,
      },
    })
  })

  it("dead-letters a dispatch whose stored trigger is no longer current", async () => {
    const executor = createAgentSignalExecutor({
      supabase: {} as never,
      run: vi.fn().mockRejectedValue(new Error("signal_trigger_not_declared")),
    })

    await expect(executor.execute(dispatch)).rejects.toMatchObject({
      code: "signal_trigger_not_declared",
      retryable: false,
    })
  })

  it.each([
    [new ManualRunAgentNotActiveError("paused"), "agent_not_active"],
    [
      new Error("agent_runtime_state_not_found: no rows"),
      "agent_runtime_state_not_found",
    ],
    [
      new Error("signal_activation_not_current"),
      "signal_activation_not_current",
    ],
    [
      new Error("signal_activation_actor_forbidden"),
      "signal_activation_actor_forbidden",
    ],
  ])(
    "treats inactive or stale runtime state as terminal",
    async (error, code) => {
      const executor = createAgentSignalExecutor({
        supabase: {} as never,
        run: vi.fn().mockRejectedValue(error),
      })

      await expect(executor.execute(dispatch)).rejects.toMatchObject({
        code,
        retryable: false,
      })
    }
  )
})
