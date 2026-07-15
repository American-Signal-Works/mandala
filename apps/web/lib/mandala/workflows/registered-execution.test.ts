import { describe, expect, it, vi } from "vitest"
import * as workflowPersistence from "./persistence"
import { executeWorkflowActionRpc } from "./registered-execution"

const companyId = "20000000-0000-4000-8000-000000000001"
const agentId = "30000000-0000-4000-8000-000000000001"
const runId = "40000000-0000-4000-8000-000000000001"
const itemId = "50000000-0000-4000-8000-000000000001"
const draftId = "60000000-0000-4000-8000-000000000001"
const decisionId = "70000000-0000-4000-8000-000000000001"
const executionId = "80000000-0000-4000-8000-000000000001"

describe("production registered workflow execution", () => {
  it("preserves the controlled legacy mock endpoint for pre-skill workflows", async () => {
    const legacyResult = {
      attempt: { id: executionId, status: "succeeded" },
      draft: { id: draftId, status: "executed" },
      item: { id: itemId, status: "executed" },
      duplicate: false,
    }
    const legacy = vi
      .spyOn(workflowPersistence, "executeMockWorkflowActionRpc")
      .mockResolvedValue(legacyResult)
    const rpc = vi.fn(async () => ({ data: { kind: "legacy" }, error: null }))
    const request = {
      supabase: { rpc } as never,
      completionSupabase: { rpc } as never,
      companyId,
      actionDraftId: draftId,
      decisionId,
      rawToken: "t".repeat(64),
      idempotencyKey: `api:${executionId}`,
      payload: { quantity: 12 },
      actorId: "10000000-0000-4000-8000-000000000001",
      inputHash: "a".repeat(64),
      clientSurface: "api" as const,
    }

    await expect(executeWorkflowActionRpc(request)).resolves.toEqual(
      legacyResult
    )
    expect(legacy).toHaveBeenCalledWith(request)
    legacy.mockRestore()
  })

  it.each(["fixture", "dry_run", "shadow"] as const)(
    "dispatches a skill-defined %s action through registry policy and durable receipts",
    async (mode) => {
      const calls: string[] = []
      const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
        calls.push(name)
        if (name === "get_registered_agent_execution_context_v1")
          return { data: context(mode), error: null }
        if (name === "begin_registered_agent_execution_v1") {
          expect(args).toMatchObject({
            p_action_draft_id: draftId,
            p_decision_id: decisionId,
            p_mode: mode,
          })
          return {
            data: { kind: "started", executionId },
            error: null,
          }
        }
        throw new Error(`Unexpected RPC ${name}`)
      })
      const completionRpc = vi.fn(
        async (name: string, args: Record<string, unknown>) => {
          calls.push(name)
          expect(name).toBe("complete_registered_agent_execution_v1")
          expect(args).toMatchObject({
            p_execution_id: executionId,
            p_result: expect.objectContaining({
              status: "succeeded",
              mode,
              effect: mode === "shadow" ? "observed" : "simulated",
            }),
          })
          return {
            data: {
              attempt: { id: executionId, status: "succeeded", mode },
              draft: { id: draftId, status: "executed" },
              item: { id: itemId, status: "executed" },
              duplicate: false,
            },
            error: null,
          }
        }
      )

      const result = await executeWorkflowActionRpc({
        supabase: { rpc } as never,
        completionSupabase: { rpc: completionRpc } as never,
        companyId,
        actionDraftId: draftId,
        decisionId,
        rawToken: "t".repeat(64),
        idempotencyKey: `api:${executionId}`,
        payload: { quantity: 12 },
        actorId: "10000000-0000-4000-8000-000000000001",
        inputHash: "a".repeat(64),
        clientSurface: "api",
      })

      expect(result).toMatchObject({
        attempt: { id: executionId, status: "succeeded", mode },
        duplicate: false,
      })
      expect(calls).toEqual([
        "get_registered_agent_execution_context_v1",
        "get_registered_agent_execution_context_v1",
        "begin_registered_agent_execution_v1",
        "get_registered_agent_execution_context_v1",
        "complete_registered_agent_execution_v1",
      ])
    }
  )

  it("stops before a receipt when the current lifecycle is paused", async () => {
    const rpc = vi.fn(async () => ({
      data: context("dry_run", {
        allowed: false,
        reason: "agent_not_active",
        lifecycleState: "paused",
      }),
      error: null,
    }))

    await expect(
      executeWorkflowActionRpc({
        supabase: { rpc } as never,
        completionSupabase: { rpc } as never,
        companyId,
        actionDraftId: draftId,
        decisionId,
        rawToken: "t".repeat(64),
        idempotencyKey: `api:${executionId}`,
        payload: { quantity: 12 },
        actorId: "10000000-0000-4000-8000-000000000001",
        inputHash: "a".repeat(64),
        clientSurface: "api",
      })
    ).rejects.toMatchObject({ rpcCode: "agent_not_active" })
    expect(rpc).toHaveBeenCalledTimes(2)
  })

  it("does not dispatch after a policy change invalidates the frozen binding", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: context("fixture"), error: null })
      .mockResolvedValueOnce({ data: context("fixture"), error: null })
      .mockResolvedValueOnce({
        data: { kind: "started", executionId },
        error: null,
      })
      .mockResolvedValueOnce({
        data: context("fixture", {
          allowed: false,
          reason: "execution_context_stale",
          policyVersion: 2,
        }),
        error: null,
      })
    const completionRpc = vi.fn()

    await expect(
      executeWorkflowActionRpc({
        supabase: { rpc } as never,
        completionSupabase: { rpc: completionRpc } as never,
        companyId,
        actionDraftId: draftId,
        decisionId,
        rawToken: "t".repeat(64),
        idempotencyKey: `api:${executionId}`,
        payload: { quantity: 12 },
        actorId: "10000000-0000-4000-8000-000000000001",
        inputHash: "a".repeat(64),
        clientSurface: "api",
      })
    ).rejects.toMatchObject({ rpcCode: "execution_context_stale" })

    expect(rpc).toHaveBeenCalledTimes(4)
    expect(completionRpc).not.toHaveBeenCalled()
  })
})

function context(
  mode: "fixture" | "dry_run" | "shadow",
  policyOverrides: Partial<ReturnType<typeof policy>> = {}
) {
  return {
    kind: "registered" as const,
    companyId,
    agentId,
    workflowRunId: runId,
    itemId,
    actionDraftId: draftId,
    decisionId,
    actionId: "create_purchase_order",
    actionVersion: "1.0.0",
    capabilityId: "procurement.purchase-order.create",
    capabilityVersion: "1.0.0",
    connectorId: "synthetic-commerce",
    schemaDigest: "schema-digest",
    mode,
    allowedModes: [mode],
    timeoutMs: 1_000,
    retryClass: "never",
    inputSchema: { type: "object" },
    outputSchema: { type: "object" },
    input: { quantity: 12 },
    approvalId: decisionId,
    expected: {
      agentConfigVersion: 1,
      lifecycleVersion: 3,
      policyVersion: 1,
      bindingVersion: 3,
    },
    policy: policy(policyOverrides),
  }
}

function policy(
  overrides: Partial<{
    allowed: boolean
    reason: string | null
    lifecycleState: string
    policyVersion: number
  }> = {}
) {
  return {
    allowed: true,
    reason: null,
    lifecycleState: "active",
    agentConfigVersion: 1,
    lifecycleVersion: 3,
    policyVersion: 1,
    bindingVersion: 3,
    capabilityGranted: true,
    connectorHealthy: true,
    approvalValid: true,
    ...overrides,
  }
}
