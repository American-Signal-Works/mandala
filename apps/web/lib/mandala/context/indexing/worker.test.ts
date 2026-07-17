import { describe, expect, it, vi } from "vitest"
import type {
  ContextIndexLease,
  ContextIndexOperation,
  ContextIndexProvider,
} from "@workspace/control-plane"
import type { ContextIndexRepository } from "./repository"
import { hashContextIndexContent } from "./projector"
import {
  ContextIndexProviderExecutionError,
  createContextIndexProviderResolver,
  createMissingContextIndexProviderResolver,
  runContextIndexBatch,
} from "./worker"

const now = new Date("2026-07-17T03:00:00.000Z")

describe("Context provider-neutral index worker", () => {
  it("dispatches add, replace, and delete and records strict completions", async () => {
    const leases = [lease("add", 1), lease("replace", 2), lease("delete", 3)]
    const repository = repositoryFor(leases)
    const provider = providerFor()
    provider.add = vi.fn(async (document) => ({
      ...completeResult(document.requestId, "add"),
      completedAt: "2020-01-01T00:00:00.000Z",
    }))

    const summary = await runContextIndexBatch({
      repository,
      resolveProvider: createContextIndexProviderResolver([provider]),
      workerId: "context-worker-1",
      now,
    })

    expect(summary).toMatchObject({
      claimed: 3,
      completed: 3,
      retryScheduled: 0,
      deadLettered: 0,
      reconciliationRequired: 0,
      leaseUnresolved: 0,
    })
    expect(provider.add).toHaveBeenCalledTimes(1)
    expect(provider.replace).toHaveBeenCalledTimes(1)
    expect(provider.delete).toHaveBeenCalledTimes(1)
    expect(repository.complete).toHaveBeenCalledTimes(3)
    expect(repository.claim).toHaveBeenCalledWith({
      workerId: "context-worker-1",
      limit: 25,
      leaseSeconds: 120,
      now: now.toISOString(),
    })
    expect(repository.complete).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: expect.objectContaining({ completedAt: now.toISOString() }),
      })
    )
    expect(repository.fail).not.toHaveBeenCalled()
  })

  it("classifies transient, terminal, and unknown outcomes without blind replay", async () => {
    const leases = [lease("add", 1), lease("add", 2), lease("add", 3)]
    const repository = repositoryFor(leases)
    repository.fail = vi.fn(async ({ disposition }) =>
      disposition === "retry"
        ? "pending"
        : disposition === "terminal"
          ? "dead_letter"
          : "reconciliation_required"
    )
    let call = 0
    const provider = providerFor()
    provider.add = vi.fn(async () => {
      call += 1
      if (call === 1) {
        throw new ContextIndexProviderExecutionError(
          "provider_rate_limited",
          "transient"
        )
      }
      if (call === 2) {
        throw new ContextIndexProviderExecutionError(
          "provider_rejected_document",
          "terminal"
        )
      }
      throw new Error("raw provider detail must not escape")
    })

    const summary = await runContextIndexBatch({
      repository,
      resolveProvider: createContextIndexProviderResolver([provider]),
      workerId: "context-worker-1",
      now,
    })

    expect(summary).toMatchObject({
      retryScheduled: 1,
      deadLettered: 1,
      reconciliationRequired: 1,
    })
    expect(repository.fail).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        disposition: "retry",
        errorCode: "provider_rate_limited",
        now: now.toISOString(),
      })
    )
    expect(repository.fail).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ disposition: "terminal" })
    )
    expect(repository.fail).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        disposition: "reconciliation_required",
        errorCode: "provider_outcome_unknown",
      })
    )
  })

  it("dead-letters invalid results and an explicitly missing provider adapter", async () => {
    const invalidRepository = repositoryFor([lease("add", 1)])
    const invalidProvider = providerFor()
    invalidProvider.add = vi.fn(async () => ({ unsafe: "shape" }) as never)
    const invalid = await runContextIndexBatch({
      repository: invalidRepository,
      resolveProvider: createContextIndexProviderResolver([invalidProvider]),
      workerId: "context-worker-1",
      now,
    })
    expect(invalid).toMatchObject({ deadLettered: 1 })
    expect(invalidRepository.fail).toHaveBeenCalledWith(
      expect.objectContaining({
        disposition: "terminal",
        errorCode: "invalid_provider_result",
      })
    )

    const missingRepository = repositoryFor([lease("add", 2)])
    const missing = await runContextIndexBatch({
      repository: missingRepository,
      resolveProvider: createMissingContextIndexProviderResolver(),
      workerId: "context-worker-1",
      now,
    })
    expect(missing).toMatchObject({ deadLettered: 1 })
    expect(missingRepository.fail).toHaveBeenCalledWith(
      expect.objectContaining({
        disposition: "terminal",
        errorCode: "provider_adapter_missing",
      })
    )
  })

  it("marks accepted/incomplete provider outcomes for reconciliation", async () => {
    const repository = repositoryFor([lease("add", 1)])
    repository.fail = vi.fn().mockResolvedValue("reconciliation_required")
    const provider = providerFor()
    provider.add = vi.fn(async (document) => ({
      requestId: document.requestId,
      provider: "supermemory" as const,
      operation: "add" as const,
      status: "accepted" as const,
      providerDocumentId: "provider-doc-1",
      receipt: null,
      estimatedCostMicrounits: 0,
      completedAt: now.toISOString(),
    }))

    const result = await runContextIndexBatch({
      repository,
      resolveProvider: createContextIndexProviderResolver([provider]),
      workerId: "context-worker-1",
      now,
    })
    expect(result).toMatchObject({ reconciliationRequired: 1 })
    expect(repository.fail).toHaveBeenCalledWith(
      expect.objectContaining({
        disposition: "reconciliation_required",
        errorCode: "provider_completion_unknown",
      })
    )
  })

  it("leaves leases unresolved after provider success or failed failure recording", async () => {
    const completionRepository = repositoryFor([lease("add", 1)])
    completionRepository.complete = vi
      .fn()
      .mockRejectedValue(new Error("db down"))
    const completion = await runContextIndexBatch({
      repository: completionRepository,
      resolveProvider: createContextIndexProviderResolver([providerFor()]),
      workerId: "context-worker-1",
      now,
    })
    expect(completion).toMatchObject({ leaseUnresolved: 1 })
    expect(completionRepository.fail).not.toHaveBeenCalled()

    const failureRepository = repositoryFor([lease("add", 2)])
    failureRepository.fail = vi.fn().mockRejectedValue(new Error("db down"))
    const provider = providerFor()
    provider.add = vi.fn(async () => {
      throw new ContextIndexProviderExecutionError("provider_busy", "transient")
    })
    const failure = await runContextIndexBatch({
      repository: failureRepository,
      resolveProvider: createContextIndexProviderResolver([provider]),
      workerId: "context-worker-1",
      now,
    })
    expect(failure).toMatchObject({ leaseUnresolved: 1 })
  })

  it("enforces option bounds and never exceeds configured concurrency", async () => {
    const leases = Array.from({ length: 8 }, (_, index) =>
      lease("add", index + 1)
    )
    const repository = repositoryFor(leases)
    let active = 0
    let peak = 0
    const provider = providerFor()
    provider.add = vi.fn(async (document) => {
      active += 1
      peak = Math.max(peak, active)
      await Promise.resolve()
      active -= 1
      return completeResult(document.requestId, "add")
    })
    const summary = await runContextIndexBatch({
      repository,
      resolveProvider: createContextIndexProviderResolver([provider]),
      workerId: "context-worker-1",
      concurrency: 2,
      limit: 8,
      now,
    })
    expect(summary.completed).toBe(8)
    expect(peak).toBeLessThanOrEqual(2)
    await expect(
      runContextIndexBatch({
        repository,
        resolveProvider: createContextIndexProviderResolver([provider]),
        workerId: "context-worker-1",
        concurrency: 21,
        now,
      })
    ).rejects.toThrow()
  })
})

function repositoryFor(leases: ContextIndexLease[]): ContextIndexRepository {
  return {
    prepare: vi.fn().mockResolvedValue({
      recoveredCount: 0,
      deadLetteredCount: 0,
      preparedAt: now.toISOString(),
    }),
    reconcile: vi.fn(),
    claim: vi.fn().mockResolvedValue(leases),
    loadProjection: vi.fn(async ({ lease }) => lease.projectionSource!),
    complete: vi.fn().mockResolvedValue(undefined),
    fail: vi.fn().mockResolvedValue("dead_letter"),
  }
}

function providerFor(): ContextIndexProvider {
  return {
    provider: "supermemory",
    add: vi.fn(async (document) => completeResult(document.requestId, "add")),
    replace: vi.fn(async (_providerDocumentId, document) =>
      completeResult(document.requestId, "replace")
    ),
    delete: vi.fn(async (request) =>
      completeResult(request.requestId, "delete")
    ),
    list: vi.fn(),
    processingStatus: vi.fn(),
    health: vi.fn(),
  }
}

function completeResult(requestId: string, operation: ContextIndexOperation) {
  return {
    requestId,
    provider: "supermemory" as const,
    operation,
    status: "complete" as const,
    providerDocumentId: "provider-doc-1",
    receipt: null,
    estimatedCostMicrounits: 0,
    completedAt: now.toISOString(),
  }
}

function lease(
  operation: ContextIndexOperation,
  ordinal: number
): ContextIndexLease {
  const suffix = ordinal.toString().padStart(12, "0")
  const eventId = `30000000-0000-4000-8000-${suffix}`
  const projectedContent = '{"/name": "Acme"}'
  const isDelete = operation === "delete"
  return {
    leaseId: `70000000-0000-4000-8000-${suffix}`,
    leasedUntil: "2026-07-17T03:02:00.000Z",
    event: {
      id: eventId,
      companyId: "20000000-0000-4000-8000-000000000001",
      provider: "supermemory",
      operation,
      canonicalRecordId: `50000000-0000-4000-8000-${suffix}`,
      canonicalRecordVersion: "version-1",
      stableCustomId: `ctx_${ordinal.toString(16).padStart(64, "0")}`,
      providerDocumentId:
        operation === "add" ? null : `provider-doc-${ordinal}`,
      policyVersion: 1,
      policyHash: "a".repeat(64),
      expectedContentHash: hashContextIndexContent(projectedContent),
      attempt: 1,
      maxAttempts: 5,
    },
    projectionSource: isDelete
      ? null
      : {
          eventId,
          record: {
            id: `50000000-0000-4000-8000-${suffix}`,
            companyId: "20000000-0000-4000-8000-000000000001",
            sourceId: "60000000-0000-4000-8000-000000000001",
            sourceKey: "erpnext",
            recordType: "inventory_item",
            externalId: `ITEM-${ordinal}`,
            canonicalRecordVersion: "version-1",
            payload: { name: "Acme", ignored: "private" },
            observedAt: "2026-07-17T02:30:00.000Z",
          },
          policy: {
            id: "40000000-0000-4000-8000-000000000001",
            companyId: "20000000-0000-4000-8000-000000000001",
            sourceKey: "erpnext",
            recordType: "inventory_item",
            policyVersion: 1,
            policyHash: "a".repeat(64),
            approvedFieldPaths: ["/name"],
            maximumContentBytes: 65_536,
            classification: "internal",
            retentionDays: 365,
            projectionVersion: 1,
          },
          projectedContent,
        },
  }
}
