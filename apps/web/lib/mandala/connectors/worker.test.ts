import { describe, expect, it, vi } from "vitest"

import { runConnectorSyncBatch } from "./worker"
import type {
  ConnectorAdapter,
  ConnectorPullResult,
  ConnectorSyncStore,
  SyncableSource,
} from "./types"

function sourceFor(overrides: Partial<SyncableSource> = {}): SyncableSource {
  return {
    id: "source-1",
    companyId: "company-1",
    sourceKey: "shiphero",
    kind: "inventory_platform",
    config: {},
    sync: {
      enabled: true,
      intervalMinutes: 720,
      cursor: null,
      leaseExpiresAt: null,
      leaseToken: null,
      failureCount: 0,
      nextAttemptAt: null,
      watermarks: {},
    },
    lastSyncedAt: null,
    ...overrides,
  }
}

function storeFor(source: SyncableSource | null): ConnectorSyncStore {
  return {
    claimDueSource: vi.fn().mockResolvedValue(source),
    upsertRecords: vi.fn().mockResolvedValue({ written: 2, skipped: 1 }),
    saveCursor: vi.fn().mockResolvedValue(undefined),
    completeSync: vi.fn().mockResolvedValue(undefined),
    failSync: vi.fn().mockResolvedValue(undefined),
  }
}

function adapterFor(result: ConnectorPullResult): ConnectorAdapter {
  return { sourceKey: "shiphero", pull: vi.fn().mockResolvedValue(result) }
}

const options = { sourceKeys: ["shiphero"], leaseSeconds: 240, maxApiCalls: 6 }

describe("runConnectorSyncBatch", () => {
  it("returns unclaimed when no source is due", async () => {
    const store = storeFor(null)
    const result = await runConnectorSyncBatch({
      store,
      adapters: [adapterFor({ records: [], nextCursor: null, apiCalls: 0 })],
      options,
    })
    expect(result).toEqual({ claimed: false })
    expect(store.upsertRecords).not.toHaveBeenCalled()
  })

  it("saves the cursor when a slice ends mid-cycle", async () => {
    const source = sourceFor()
    const store = storeFor(source)
    const cursor = {
      phase: "inventory",
      after: "abc",
      vendorNames: {},
      maxSalesOrderDate: null,
    }
    const result = await runConnectorSyncBatch({
      store,
      adapters: [
        adapterFor({
          records: [
            {
              recordType: "purchase_order",
              externalId: "po-1",
              payload: { po_number: "A1" },
            },
          ],
          nextCursor: cursor,
          apiCalls: 6,
        }),
      ],
      options,
    })
    expect(store.saveCursor).toHaveBeenCalledWith({ source, cursor })
    expect(store.completeSync).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      claimed: true,
      completed: false,
      phase: "inventory",
      written: 2,
      skipped: 1,
    })
  })

  it("completes the cycle and forwards watermarks when the pull finishes", async () => {
    const source = sourceFor()
    const store = storeFor(source)
    const result = await runConnectorSyncBatch({
      store,
      adapters: [
        adapterFor({
          records: [],
          nextCursor: null,
          apiCalls: 2,
          watermarks: { salesSince: "2026-07-17T00:00:00Z" },
        }),
      ],
      options,
    })
    expect(store.completeSync).toHaveBeenCalledWith(
      expect.objectContaining({
        source,
        watermarks: { salesSince: "2026-07-17T00:00:00Z" },
      })
    )
    expect(result).toMatchObject({ claimed: true, completed: true })
  })

  it("marks the source failed and keeps the cursor when the adapter throws", async () => {
    const source = sourceFor()
    const store = storeFor(source)
    const adapter: ConnectorAdapter = {
      sourceKey: "shiphero",
      pull: vi.fn().mockRejectedValue(new Error("shiphero_rate_limited")),
    }
    const result = await runConnectorSyncBatch({
      store,
      adapters: [adapter],
      options,
    })
    expect(store.failSync).toHaveBeenCalledWith(
      expect.objectContaining({ source, error: "shiphero_rate_limited" })
    )
    expect(result).toMatchObject({
      claimed: true,
      completed: false,
      error: "shiphero_rate_limited",
    })
  })

  it("rejects malformed adapter records before writing them", async () => {
    const source = sourceFor()
    const store = storeFor(source)
    const adapter: ConnectorAdapter = {
      sourceKey: "shiphero",
      pull: vi.fn().mockResolvedValue({
        records: [
          { recordType: "purchase_order", externalId: "", payload: {} },
        ],
        nextCursor: null,
        apiCalls: 1,
      }),
    }

    const result = await runConnectorSyncBatch({
      store,
      adapters: [adapter],
      options,
    })

    expect(store.upsertRecords).not.toHaveBeenCalled()
    expect(store.failSync).toHaveBeenCalled()
    expect(result).toMatchObject({ claimed: true, completed: false })
  })

  it("fails cleanly when a claimed source has no adapter", async () => {
    const source = sourceFor({ kind: "erp", sourceKey: "netsuite" })
    const store = storeFor(source)
    const result = await runConnectorSyncBatch({
      store,
      adapters: [adapterFor({ records: [], nextCursor: null, apiCalls: 0 })],
      options: { ...options, sourceKeys: ["shiphero", "netsuite"] },
    })
    expect(store.failSync).toHaveBeenCalled()
    expect(result).toMatchObject({ claimed: true, error: "no_adapter" })
  })
})
