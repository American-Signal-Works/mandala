import { describe, expect, it, vi } from "vitest"
import type { ContextIndexRepository } from "./repository"
import {
  runContextIndexReconciliation,
  type ContextIndexInventoryProvider,
} from "./reconciliation"

const COMPANY_ID = "10000000-0000-4000-8000-000000000001"
const OUTBOX_ID = "20000000-0000-4000-8000-000000000001"
const STABLE_ID = `ctx_${"a".repeat(64)}`
const NOW = new Date("2026-07-24T17:00:00.000Z")

function repository(overrides: Partial<ContextIndexRepository> = {}) {
  return {
    claimReconciliation: vi.fn().mockResolvedValue([
      {
        outboxId: OUTBOX_ID,
        companyId: COMPANY_ID,
        provider: "supermemory",
        stableCustomId: STABLE_ID,
        attempt: 1,
        nextAttemptAt: "2026-07-24T17:05:00.000Z",
      },
    ]),
    confirmReconciliation: vi.fn().mockResolvedValue({
      companyId: COMPANY_ID,
      suppliedCount: 1,
      settledCount: 1,
      unmatchedCount: 0,
    }),
    ...overrides,
  } as unknown as ContextIndexRepository
}

describe("runContextIndexReconciliation", () => {
  it("settles a completed exact inventory match once without payload data", async () => {
    const repo = repository()
    const provider: ContextIndexInventoryProvider = {
      reconciliationStatusBatch: vi.fn().mockResolvedValue([
        {
          stableCustomId: STABLE_ID,
          providerDocumentId: "provider-document-1",
          status: "complete",
        },
      ]),
    }

    const result = await runContextIndexReconciliation({
      repository: repo,
      provider,
      workerId: "reconcile-worker",
      limit: 100,
      now: NOW,
    })

    expect(repo.confirmReconciliation).toHaveBeenCalledWith({
      companyId: COMPANY_ID,
      documents: [
        {
          stableCustomId: STABLE_ID,
          providerDocumentId: "provider-document-1",
          status: "complete",
        },
      ],
      now: NOW.toISOString(),
    })
    expect(JSON.stringify(result)).not.toMatch(
      /payload|content|provider-document|ctx_/
    )
    expect(result).toEqual({
      claimedCount: 1,
      providerMatchedCount: 1,
      settledCount: 1,
      unmatchedCount: 0,
      providerStatus: "complete",
    })
  })

  it("leaves unmatched inventory quarantined without confirming or resending", async () => {
    const repo = repository()
    const provider: ContextIndexInventoryProvider = {
      reconciliationStatusBatch: vi.fn().mockResolvedValue([]),
    }

    const result = await runContextIndexReconciliation({
      repository: repo,
      provider,
      workerId: "reconcile-worker",
      limit: 100,
      now: NOW,
    })

    expect(repo.confirmReconciliation).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      settledCount: 0,
      unmatchedCount: 1,
      providerStatus: "complete",
    })
  })

  it("does not call the provider when no reconciliation work is due", async () => {
    const repo = repository({
      claimReconciliation: vi.fn().mockResolvedValue([]),
    })
    const provider: ContextIndexInventoryProvider = {
      reconciliationStatusBatch: vi.fn(),
    }

    const result = await runContextIndexReconciliation({
      repository: repo,
      provider,
      workerId: "reconcile-worker",
      limit: 100,
      now: NOW,
    })

    expect(provider.reconciliationStatusBatch).not.toHaveBeenCalled()
    expect(result.providerStatus).toBe("not_called")
  })

  it("keeps the pre-advanced backoff when the provider read fails", async () => {
    const repo = repository()
    const provider: ContextIndexInventoryProvider = {
      reconciliationStatusBatch: vi
        .fn()
        .mockRejectedValue(new Error("provider_unavailable")),
    }

    const result = await runContextIndexReconciliation({
      repository: repo,
      provider,
      workerId: "reconcile-worker",
      limit: 100,
      now: NOW,
    })

    expect(repo.confirmReconciliation).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      settledCount: 0,
      unmatchedCount: 1,
      providerStatus: "failed",
    })
  })

  it("fails closed on an inventory identity that was not claimed", async () => {
    const repo = repository()
    const provider: ContextIndexInventoryProvider = {
      reconciliationStatusBatch: vi.fn().mockResolvedValue([
        {
          stableCustomId: `ctx_${"f".repeat(64)}`,
          providerDocumentId: "unclaimed-provider-document",
          status: "complete",
        },
      ]),
    }

    const result = await runContextIndexReconciliation({
      repository: repo,
      provider,
      workerId: "reconcile-worker",
      limit: 100,
      now: NOW,
    })

    expect(repo.confirmReconciliation).not.toHaveBeenCalled()
    expect(result.providerStatus).toBe("failed")
  })

  it("rejects a cross-tenant claim envelope before any provider call", async () => {
    const repo = repository({
      claimReconciliation: vi.fn().mockResolvedValue([
        {
          outboxId: OUTBOX_ID,
          companyId: COMPANY_ID,
          provider: "supermemory",
          stableCustomId: STABLE_ID,
          attempt: 1,
          nextAttemptAt: "2026-07-24T17:05:00.000Z",
        },
        {
          outboxId: "20000000-0000-4000-8000-000000000002",
          companyId: "10000000-0000-4000-8000-000000000002",
          provider: "supermemory",
          stableCustomId: `ctx_${"b".repeat(64)}`,
          attempt: 1,
          nextAttemptAt: "2026-07-24T17:05:00.000Z",
        },
      ]),
    })
    const provider: ContextIndexInventoryProvider = {
      reconciliationStatusBatch: vi.fn(),
    }

    await expect(
      runContextIndexReconciliation({
        repository: repo,
        provider,
        workerId: "reconcile-worker",
        limit: 100,
        now: NOW,
      })
    ).rejects.toThrow("context_index_reconciliation_batch_invalid")
    expect(provider.reconciliationStatusBatch).not.toHaveBeenCalled()
  })
})
