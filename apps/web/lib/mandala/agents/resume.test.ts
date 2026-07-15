import { describe, expect, it, vi } from "vitest"
import type { AgentRuntimeState } from "../skills/lifecycle"
import { refreshReadinessAndResumeAgent } from "./resume"

const companyId = "20000000-0000-4000-8000-000000000001"
const agentId = "a0000000-0000-4000-8000-000000000001"
const actorUserId = "10000000-0000-4000-8000-000000000001"

describe("agent resume readiness refresh", () => {
  it("runs the server-owned Sandbox evaluation before resuming with the refreshed version", async () => {
    const getRuntimeState = vi
      .fn()
      .mockResolvedValueOnce(runtimeState({ stateVersion: 4 }))
      .mockResolvedValueOnce(
        runtimeState({ stateVersion: 5, readinessStatus: "ready" })
      )
    const runSandbox = vi.fn().mockResolvedValue({ workflowRunId: "run-1" })
    const recordReadiness = vi.fn().mockResolvedValue(undefined)
    const transitionLifecycle = vi.fn().mockResolvedValue({ id: agentId })

    await refreshReadinessAndResumeAgent({
      supabase: {} as never,
      companyId,
      agentId,
      expectedVersion: 4,
      reason: "Resume after current Sandbox review",
      actorUserId,
      clientSurface: "cli",
      dependencies: {
        getRuntimeState,
        runSandbox: runSandbox as never,
        recordReadiness: recordReadiness as never,
        transitionLifecycle: transitionLifecycle as never,
      },
    })

    expect(runSandbox).toHaveBeenCalledWith({
      supabase: {},
      agentId,
      request: { companyId },
      actorUserId,
      clientSurface: "cli",
    })
    expect(recordReadiness).toHaveBeenCalledWith(
      expect.objectContaining({ companyId, agentId })
    )
    expect(transitionLifecycle).toHaveBeenCalledWith({
      supabase: {},
      companyId,
      agentId,
      transition: "resume",
      expectedVersion: 5,
      reason: "Resume after current Sandbox review",
    })
    expect(runSandbox.mock.invocationCallOrder[0]).toBeLessThan(
      transitionLifecycle.mock.invocationCallOrder[0]!
    )
  })

  it("rejects a stale caller before running Sandbox", async () => {
    const runSandbox = vi.fn()
    await expect(
      refreshReadinessAndResumeAgent({
        supabase: {} as never,
        companyId,
        agentId,
        expectedVersion: 3,
        reason: "Resume",
        actorUserId,
        clientSurface: "web",
        dependencies: {
          getRuntimeState: vi.fn().mockResolvedValue(runtimeState()),
          runSandbox: runSandbox as never,
        },
      })
    ).rejects.toThrow("stale_agent_state")
    expect(runSandbox).not.toHaveBeenCalled()
  })

  it("does not resume if state changes while readiness is being refreshed", async () => {
    const transitionLifecycle = vi.fn()
    await expect(
      refreshReadinessAndResumeAgent({
        supabase: {} as never,
        companyId,
        agentId,
        expectedVersion: 4,
        reason: "Resume",
        actorUserId,
        clientSurface: "web",
        dependencies: {
          getRuntimeState: vi
            .fn()
            .mockResolvedValueOnce(runtimeState())
            .mockResolvedValueOnce(
              runtimeState({ lifecycleState: "disabled", stateVersion: 5 })
            ),
          runSandbox: vi.fn().mockResolvedValue({}) as never,
          recordReadiness: vi.fn().mockResolvedValue(undefined) as never,
          transitionLifecycle: transitionLifecycle as never,
        },
      })
    ).rejects.toThrow("stale_agent_state")
    expect(transitionLifecycle).not.toHaveBeenCalled()
  })
})

function runtimeState(
  overrides: Partial<AgentRuntimeState> = {}
): AgentRuntimeState {
  return {
    runtimeStateId: "90000000-0000-4000-8000-000000000001",
    companyId,
    workflowId: agentId,
    lifecycleState: "paused",
    stateVersion: 4,
    readinessStatus: "invalidated",
    readinessIssues: [],
    readinessHash: null,
    readinessCheckedAt: null,
    sampleRunId: null,
    bindingSnapshotId: null,
    updatedAt: "2026-07-15T12:00:00.000Z",
    ...overrides,
  }
}
