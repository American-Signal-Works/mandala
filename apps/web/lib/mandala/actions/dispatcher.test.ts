import { describe, expect, it, vi } from "vitest"
import { createSimulationAdapter } from "./adapters"
import {
  ExecutorFailure,
  type ActionExecutionRequest,
  type ExecutionPolicySnapshot,
  type ExecutorDefinition,
} from "./contracts"
import { createActionDispatcher } from "./dispatcher"
import { InMemoryExecutionReceiptStore } from "./receipts"
import { ExecutorRegistry } from "./registry"

describe("server-owned action dispatcher", () => {
  it("binds the exact action, capability, connector, and schema versions", async () => {
    const adapter = vi.fn(async () => ({
      output: { ok: true },
      effect: "simulated" as const,
    }))
    const dispatch = dispatcher({
      ...definition(),
      adapter: { execute: adapter },
    })

    const result = await dispatch(request({ capabilityVersion: "2.0.0" }))

    expect(result).toMatchObject({
      status: "failed",
      code: "executor_not_registered",
      retryClass: "terminal",
      attempt: 0,
    })
    expect(adapter).not.toHaveBeenCalled()
  })

  it("names live mode but blocks it before registry or policy dispatch", async () => {
    const recheckPolicy = vi.fn(async () => policy())
    const dispatch = dispatcher(definition(), { recheckPolicy })

    const result = await dispatch(request({ mode: "live" }))

    expect(result).toMatchObject({
      status: "failed",
      code: "live_adapter_unavailable",
      effect: "none",
    })
    expect(recheckPolicy).not.toHaveBeenCalled()
  })

  it("rechecks lifecycle and current versions immediately before execution", async () => {
    const adapter = vi.fn(async () => ({
      output: {},
      effect: "simulated" as const,
    }))
    const dispatch = dispatcher(
      { ...definition(), adapter: { execute: adapter } },
      {
        recheckPolicy: async () =>
          policy({ lifecycleState: "paused", lifecycleVersion: 2 }),
      }
    )

    const paused = await dispatch(request())
    expect(paused).toMatchObject({
      status: "failed",
      code: "agent_not_active",
    })
    expect(adapter).not.toHaveBeenCalled()

    const staleDispatch = dispatcher(
      { ...definition(), adapter: { execute: adapter } },
      { recheckPolicy: async () => policy({ policyVersion: 2 }) }
    )
    const stale = await staleDispatch(request())
    expect(stale.code).toBe("execution_context_stale")
    expect(adapter).not.toHaveBeenCalled()
  })

  it("validates bounded input and output at the registered schema boundary", async () => {
    const invalidInput = dispatcher({
      ...definition(),
      validateInput: () => false,
    })
    await expect(invalidInput(request())).resolves.toMatchObject({
      status: "failed",
      code: "execution_input_invalid",
    })

    const invalidOutput = dispatcher({
      ...definition(),
      validateOutput: () => false,
    })
    await expect(invalidOutput(request())).resolves.toMatchObject({
      status: "failed",
      code: "execution_output_invalid",
      retryClass: "terminal",
    })
  })

  it("retries only classified safe failures and replays a completed receipt", async () => {
    const adapter = vi
      .fn()
      .mockRejectedValueOnce(
        new ExecutorFailure(
          "temporarily_unavailable",
          "retryable",
          "Try again."
        )
      )
      .mockResolvedValue({
        output: { draftId: "draft-1" },
        effect: "simulated",
      })
    const dispatch = dispatcher({
      ...definition(),
      adapter: { execute: adapter },
    })

    const first = await dispatch(request())
    const replay = await dispatch(request())

    expect(first).toMatchObject({
      status: "succeeded",
      retryClass: "none",
      attempt: 2,
      replayed: false,
    })
    expect(replay).toEqual({ ...first, replayed: true })
    expect(adapter).toHaveBeenCalledTimes(2)
  })

  it("rechecks policy and lifecycle again before every retry attempt", async () => {
    const adapter = vi.fn().mockRejectedValueOnce(
      new ExecutorFailure(
        "temporarily_unavailable",
        "retryable",
        "Try again."
      )
    )
    const recheckPolicy = vi
      .fn()
      .mockResolvedValueOnce(policy())
      .mockResolvedValueOnce(policy())
      .mockResolvedValueOnce(
        policy({ lifecycleState: "paused", lifecycleVersion: 2 })
      )
    const dispatch = dispatcher(
      { ...definition(), adapter: { execute: adapter } },
      { recheckPolicy }
    )

    const result = await dispatch(request())

    expect(result).toMatchObject({
      status: "failed",
      code: "agent_not_active",
      attempt: 2,
    })
    expect(recheckPolicy).toHaveBeenCalledTimes(3)
    expect(adapter).toHaveBeenCalledTimes(1)
  })

  it("rejects a changed request that reuses an idempotency key", async () => {
    const dispatch = dispatcher(definition())
    await dispatch(request())

    const conflict = await dispatch(request({ input: { quantity: 99 } }))

    expect(conflict).toMatchObject({
      status: "failed",
      code: "idempotency_key_reused",
      retryClass: "terminal",
    })
  })

  it("reports a concurrent duplicate as processing without a second call", async () => {
    let release!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const adapter = vi.fn(async () => {
      await held
      return { output: { ok: true }, effect: "simulated" as const }
    })
    const dispatch = dispatcher({
      ...definition(),
      adapter: { execute: adapter },
    })

    const first = dispatch(request())
    await vi.waitFor(() => expect(adapter).toHaveBeenCalledTimes(1))
    const duplicate = await dispatch(request())
    release()
    await first

    expect(duplicate).toMatchObject({
      status: "processing",
      code: "execution_in_progress",
      attempt: 0,
    })
    expect(adapter).toHaveBeenCalledTimes(1)
  })

  it("never retries a timeout whose external outcome could be unknown", async () => {
    const adapter = vi.fn(async () => new Promise<never>(() => {}))
    const dispatch = dispatcher({
      ...definition(),
      adapter: { execute: adapter },
      timeoutMs: 2,
      retryPolicy: {
        ...definition().retryPolicy,
        timeoutOutcome: "unknown",
      },
    })

    const result = await dispatch(request())
    const replay = await dispatch(request())

    expect(result).toMatchObject({
      status: "reconciliation_required",
      retryClass: "unknown",
      code: "executor_timeout_outcome_unknown",
      effect: "unknown",
      attempt: 1,
    })
    expect(replay).toMatchObject({
      status: "reconciliation_required",
      effect: "unknown",
      replayed: true,
    })
    expect(adapter).toHaveBeenCalledTimes(1)
  })

  it("projects comparable effects for fixture, mock, dry-run, and shadow", async () => {
    const dispatch = dispatcher({
      ...definition(),
      allowedModes: ["fixture", "mock", "dry_run", "shadow"],
      adapter: createSimulationAdapter({ execute: (input) => input }),
    })

    for (const mode of ["fixture", "mock", "dry_run", "shadow"] as const) {
      const result = await dispatch(
        request({ mode, idempotencyKey: `idempotency-${mode}` })
      )
      expect(result.effect).toBe(mode === "shadow" ? "observed" : "simulated")
      expect(result.status).toBe("succeeded")
    }
  })
})

function dispatcher(
  executor: ExecutorDefinition,
  overrides: {
    recheckPolicy?: () => Promise<ExecutionPolicySnapshot>
  } = {}
) {
  return createActionDispatcher({
    registry: new ExecutorRegistry([executor]),
    receipts: new InMemoryExecutionReceiptStore(),
    recheckPolicy: overrides.recheckPolicy ?? (async () => policy()),
    createId: () => "execution-1",
    now: () => new Date("2026-07-14T12:00:00.000Z"),
    wait: async () => {},
  })
}

function definition(): ExecutorDefinition {
  return {
    actionId: "create_purchase_order",
    actionVersion: "1.0.0",
    capabilityId: "procurement.purchase-order.create",
    capabilityVersion: "1.0.0",
    connectorId: "synthetic-commerce",
    schemaDigest: "schema-1",
    allowedModes: ["mock"],
    timeoutMs: 1_000,
    retryPolicy: {
      maxAttempts: 2,
      backoffMs: 0,
      retryableCodes: ["temporarily_unavailable"],
      timeoutOutcome: "retryable",
    },
    validateInput: (input) => Boolean(input && typeof input === "object"),
    validateOutput: (output) => Boolean(output && typeof output === "object"),
    adapter: createSimulationAdapter({ execute: (input) => input }),
  }
}

function request(
  overrides: Partial<ActionExecutionRequest> = {}
): ActionExecutionRequest {
  return {
    companyId: "company-1",
    agentId: "agent-1",
    workflowRunId: "run-1",
    itemId: "item-1",
    actorId: "user-1",
    actionId: "create_purchase_order",
    actionVersion: "1.0.0",
    capabilityId: "procurement.purchase-order.create",
    capabilityVersion: "1.0.0",
    connectorId: "synthetic-commerce",
    schemaDigest: "schema-1",
    mode: "mock",
    idempotencyKey: "idempotency-1",
    input: { quantity: 12 },
    approvalId: "approval-1",
    expected: {
      agentConfigVersion: 1,
      lifecycleVersion: 1,
      policyVersion: 1,
      bindingVersion: 1,
    },
    ...overrides,
  }
}

function policy(
  overrides: Partial<ExecutionPolicySnapshot> = {}
): ExecutionPolicySnapshot {
  return {
    allowed: true,
    reason: null,
    lifecycleState: "active",
    agentConfigVersion: 1,
    lifecycleVersion: 1,
    policyVersion: 1,
    bindingVersion: 1,
    capabilityGranted: true,
    connectorHealthy: true,
    approvalValid: true,
    ...overrides,
  }
}
