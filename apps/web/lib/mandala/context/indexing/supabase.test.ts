import { createHash } from "node:crypto"
import { describe, expect, it, vi } from "vitest"
import { ContextIndexRepositoryError } from "./repository"
import {
  SupabaseContextIndexRepository,
  contextIndexRpcNames,
  type ContextIndexRpcExecutor,
} from "./supabase"

const now = "2026-07-17T03:00:00.000Z"

describe("Supabase Context index repository", () => {
  it("accepts provider processing batches up to the 600-document ceiling", async () => {
    const rpc = vi.fn<ContextIndexRpcExecutor["rpc"]>().mockResolvedValue({
      data: { claims: [] },
      error: null,
    })
    const repository = new SupabaseContextIndexRepository({ rpc })

    await expect(
      repository.claimProcessing({
        workerId: "worker-1",
        limit: 600,
        leaseSeconds: 120,
        now,
      })
    ).resolves.toHaveLength(0)
    expect(rpc).toHaveBeenCalledWith(contextIndexRpcNames.claimProcessing, {
      p_worker_id: "worker-1",
      p_limit: 600,
      p_lease_seconds: 120,
      p_now: now,
    })
  })

  it("maps a provider batch claim up to the official 600-document ceiling", async () => {
    const rpc = vi.fn<ContextIndexRpcExecutor["rpc"]>().mockResolvedValue({
      data: { claims: [claim()] },
      error: null,
    })
    const repository = new SupabaseContextIndexRepository({ rpc })

    await expect(
      repository.claimAddBatch({
        workerId: "worker-1",
        limit: 600,
        leaseSeconds: 120,
        now,
      })
    ).resolves.toHaveLength(1)
    expect(rpc).toHaveBeenCalledWith(contextIndexRpcNames.claimAddBatch, {
      p_worker_id: "worker-1",
      p_limit: 600,
      p_lease_seconds: 120,
      p_now: now,
    })
  })

  it("uses the bounded replacement RPC and rejects contradictory provider identities", async () => {
    const replacement = {
      ...claim(),
      operation: "replace",
      providerDocumentId: "provider-doc-1",
    }
    const rpc = vi
      .fn<ContextIndexRpcExecutor["rpc"]>()
      .mockResolvedValueOnce({ data: { claims: [replacement] }, error: null })
      .mockResolvedValueOnce({
        data: {
          claims: [
            {
              ...claim(),
              providerDocumentId: "provider-doc-should-not-be-on-add",
            },
          ],
        },
        error: null,
      })
    const repository = new SupabaseContextIndexRepository({ rpc })

    await expect(
      repository.claim({
        workerId: "worker-1",
        limit: 25,
        leaseSeconds: 120,
        now,
      })
    ).resolves.toEqual([
      expect.objectContaining({
        event: expect.objectContaining({
          operation: "replace",
          providerDocumentId: "provider-doc-1",
        }),
      }),
    ])
    expect(rpc).toHaveBeenNthCalledWith(
      1,
      "claim_context_index_replace_v1",
      expect.objectContaining({ p_limit: 25 })
    )
    await expect(
      repository.claimAddBatch({
        workerId: "worker-1",
        limit: 25,
        leaseSeconds: 120,
        now,
      })
    ).rejects.toMatchObject({ code: "repository_invalid_response" })
  })

  it("maps the bounded RPC lifecycle and preserves one injected clock", async () => {
    const rpc = vi
      .fn<ContextIndexRpcExecutor["rpc"]>()
      .mockResolvedValueOnce({
        data: { recoveredCount: 1, deadLetteredCount: 0 },
        error: null,
      })
      .mockResolvedValueOnce({ data: { claims: [claim()] }, error: null })
      .mockResolvedValueOnce({
        data: {
          outboxId: claim().outboxId,
          status: "completed",
          operation: "add",
          deletionConfirmed: false,
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: {
          outboxId: claim().outboxId,
          status: "retry",
          availableAt: "2026-07-17T03:01:00.000Z",
        },
        error: null,
      })
    const repository = new SupabaseContextIndexRepository({ rpc })

    expect(await repository.prepare({ now, limit: 25 })).toEqual({
      recoveredCount: 1,
      deadLetteredCount: 0,
      preparedAt: now,
    })
    const [lease] = await repository.claim({
      workerId: "worker-1",
      limit: 25,
      leaseSeconds: 120,
      now,
    })
    expect(lease?.projectionSource?.projectedContent).toBe('{"/name": "Acme"}')
    expect(
      (await repository.loadProjection({ workerId: "worker-1", lease: lease! }))
        .record.payload
    ).toEqual({ name: "Acme" })
    await repository.complete({
      workerId: "worker-1",
      lease: lease!,
      outcome: {
        eventId: lease!.event.id,
        provider: "supermemory",
        operation: "add",
        providerDocumentId: "provider-doc-1",
        receipt: null,
        contentHash: claim().contentHash,
        estimatedCostMicrounits: 0,
        completedAt: now,
      },
    })
    expect(
      await repository.fail({
        workerId: "worker-1",
        lease: lease!,
        disposition: "retry",
        errorCode: "provider_busy",
        now,
      })
    ).toBe("pending")

    expect(rpc).toHaveBeenNthCalledWith(1, contextIndexRpcNames.prepare, {
      p_now: now,
      p_limit: 25,
    })
    expect(rpc).toHaveBeenNthCalledWith(2, contextIndexRpcNames.claim, {
      p_worker_id: "worker-1",
      p_limit: 25,
      p_lease_seconds: 120,
      p_now: now,
    })
    expect(rpc).toHaveBeenNthCalledWith(
      4,
      contextIndexRpcNames.fail,
      expect.objectContaining({ p_now: now, p_disposition: "transient" })
    )
  })

  it("rejects malformed service responses and maps lease loss safely", async () => {
    const malformed = new SupabaseContextIndexRepository({
      rpc: vi.fn().mockResolvedValue({
        data: { claims: [{ ...claim(), canonicalPayload: "raw" }] },
        error: null,
      }),
    })
    await expect(
      malformed.claim({
        workerId: "worker-1",
        limit: 1,
        leaseSeconds: 120,
        now,
      })
    ).rejects.toMatchObject({ code: "repository_invalid_response" })

    const lost = new SupabaseContextIndexRepository({
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: { message: "context_index_lease_lost private detail" },
      }),
    })
    await expect(lost.prepare({ now, limit: 1 })).rejects.toEqual(
      expect.any(ContextIndexRepositoryError)
    )
    await expect(lost.prepare({ now, limit: 1 })).rejects.toMatchObject({
      code: "lease_lost",
      message: "lease_lost",
    })
  })

  it("strictly maps dry-run reconciliation evidence", async () => {
    const companyId = "20000000-0000-4000-8000-000000000001"
    const rpc = vi.fn().mockResolvedValue({
      data: {
        jobId: "80000000-0000-4000-8000-000000000001",
        companyId,
        provider: "supermemory",
        mode: "dry_run",
        status: "completed",
        eligibleCount: 12,
        queuedCount: 0,
        policyHash: "a".repeat(64),
        snapshotHash: "b".repeat(64),
        queryHash: "c".repeat(64),
      },
      error: null,
    })
    const repository = new SupabaseContextIndexRepository({ rpc })
    expect(
      await repository.reconcile({
        companyId,
        mode: "dry_run",
        requestedLimit: 0,
        now,
      })
    ).toMatchObject({ eligibleCount: 12, queuedCount: 0 })
    expect(rpc).toHaveBeenCalledWith(contextIndexRpcNames.reconcile, {
      p_company_id: companyId,
      p_mode: "dry_run",
      p_requested_limit: 0,
      p_now: now,
    })
  })

  it("maps accepted provider identity into poll-only RPCs", async () => {
    const processing = {
      outboxId: claim().outboxId,
      leaseId: "71000000-0000-4000-8000-000000000001",
      leaseExpiresAt: "2026-07-17T03:02:00.000Z",
      companyId: claim().companyId,
      provider: "supermemory",
      operation: "add",
      stableCustomId: claim().stableCustomId,
      providerDocumentId: "provider-doc-1",
      contentHash: claim().contentHash,
      pollAttempt: 1,
      maximumPollAttempts: 120,
    }
    const rpc = vi
      .fn<ContextIndexRpcExecutor["rpc"]>()
      .mockResolvedValueOnce({ data: { claims: [processing] }, error: null })
      .mockResolvedValueOnce({
        data: { outboxId: claim().outboxId, status: "awaiting_provider" },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { outboxId: claim().outboxId, status: "awaiting_provider" },
        error: null,
      })
    const repository = new SupabaseContextIndexRepository({ rpc })
    const [lease] = await repository.claimProcessing({
      workerId: "worker-1",
      limit: 1,
      leaseSeconds: 120,
      now,
    })
    expect(lease).toMatchObject({
      providerDocumentId: "provider-doc-1",
    })
    expect(lease).not.toHaveProperty("projectionSource")
    await repository.accept({
      workerId: "worker-1",
      lease: lease!,
      providerDocumentId: "provider-doc-1",
      now,
    })
    await expect(
      repository.deferProcessing({
        workerId: "worker-1",
        lease: lease!,
        status: "processing",
        now,
      })
    ).resolves.toBe("awaiting_provider")
    expect(rpc).toHaveBeenNthCalledWith(
      1,
      contextIndexRpcNames.claimProcessing,
      expect.objectContaining({ p_worker_id: "worker-1" })
    )
    expect(rpc).toHaveBeenNthCalledWith(
      2,
      contextIndexRpcNames.accept,
      expect.objectContaining({ p_provider_document_id: "provider-doc-1" })
    )
    expect(rpc).toHaveBeenNthCalledWith(
      3,
      contextIndexRpcNames.deferProcessing,
      expect.objectContaining({ p_processing_status: "processing" })
    )
  })

  it("never places projected content into completion or failure RPCs", async () => {
    const rpc = vi
      .fn<ContextIndexRpcExecutor["rpc"]>()
      .mockResolvedValueOnce({ data: { claims: [claim()] }, error: null })
      .mockResolvedValueOnce({
        data: {
          outboxId: claim().outboxId,
          status: "completed",
          operation: "add",
          deletionConfirmed: false,
        },
        error: null,
      })
    const repository = new SupabaseContextIndexRepository({ rpc })
    const [lease] = await repository.claim({
      workerId: "worker-1",
      limit: 1,
      leaseSeconds: 120,
      now,
    })
    await repository.complete({
      workerId: "worker-1",
      lease: lease!,
      outcome: {
        eventId: lease!.event.id,
        provider: "supermemory",
        operation: "add",
        providerDocumentId: "provider-doc-1",
        receipt: null,
        contentHash: claim().contentHash,
        estimatedCostMicrounits: 0,
        completedAt: now,
      },
    })
    const serialized = JSON.stringify(rpc.mock.calls.slice(1))
    expect(serialized).not.toContain("projectedContent")
    expect(serialized).not.toContain('{\\"/name\\": \\"Acme\\"}')
  })
})

function claim() {
  const outboxId = "30000000-0000-4000-8000-000000000001"
  const projectedContent = '{"/name": "Acme"}'
  return {
    outboxId,
    leaseId: "70000000-0000-4000-8000-000000000001",
    leaseExpiresAt: "2026-07-17T03:02:00.000Z",
    companyId: "20000000-0000-4000-8000-000000000001",
    provider: "supermemory",
    operation: "add",
    canonicalRecordId: "50000000-0000-4000-8000-000000000001",
    canonicalVersion: "version-1",
    policyId: "40000000-0000-4000-8000-000000000001",
    policyVersion: 1,
    policyHash: "a".repeat(64),
    contentHash: sha256(projectedContent),
    stableCustomId: `ctx_${"c".repeat(64)}`,
    providerDocumentId: null,
    sourceKey: "erpnext",
    recordType: "inventory_item",
    sourceId: "60000000-0000-4000-8000-000000000001",
    externalId: "ITEM-1",
    observedAt: "2026-07-17T02:30:00.000Z",
    approvedFieldPaths: ["/name"],
    maximumContentBytes: 65_536,
    classification: "internal",
    retentionDays: 365,
    projectionVersion: 1,
    canonicalPayload: { name: "Acme" },
    projectedContent,
    attempt: 1,
    maxAttempts: 5,
  }
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex")
}
