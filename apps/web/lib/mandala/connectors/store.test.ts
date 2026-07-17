import { describe, expect, it, vi } from "vitest"

import { stableStringify, SupabaseConnectorSyncStore } from "./store"
import type { SyncableSource } from "./types"

describe("stableStringify", () => {
  it("compares payloads independent of key order", () => {
    expect(stableStringify({ b: 1, a: { d: 2, c: [{ f: 3, e: 4 }] } })).toBe(
      stableStringify({ a: { c: [{ e: 4, f: 3 }], d: 2 }, b: 1 })
    )
  })
})

function sourceFor(): SyncableSource {
  return {
    id: "source-1",
    companyId: "company-1",
    sourceKey: "shiphero",
    kind: "shiphero",
    config: {},
    sync: { enabled: true, intervalMinutes: 720, cursor: null, leaseExpiresAt: null, watermarks: {} },
    lastSyncedAt: null,
  }
}

// Chainable fake for the two query shapes upsertRecords uses: the existing-
// payload select (select().eq().eq().eq().in() -> rows) and upsert().
function clientFor(existingRows: Array<{ external_id: string; payload: unknown }>) {
  const upsert = vi.fn().mockResolvedValue({ error: null })
  const query = {
    eq: vi.fn(() => query),
    in: vi.fn().mockResolvedValue({ data: existingRows, error: null }),
  }
  const from = vi.fn(() => ({
    select: vi.fn(() => query),
    upsert,
  }))
  return { client: { from }, upsert }
}

describe("SupabaseConnectorSyncStore.upsertRecords", () => {
  it("skips unchanged rows and writes only changed/new ones", async () => {
    const { client, upsert } = clientFor([
      { external_id: "sku-1@wh-1", payload: { sku: "sku-1", on_hand: 10 } },
      { external_id: "sku-2@wh-1", payload: { on_hand: 5, sku: "sku-2" } },
    ])
    const store = new SupabaseConnectorSyncStore(client)
    const outcome = await store.upsertRecords({
      source: sourceFor(),
      pulledAt: "2026-07-17T00:00:00Z",
      records: [
        // unchanged (same content, different key order than stored)
        { recordType: "inventory_position", externalId: "sku-2@wh-1", payload: { sku: "sku-2", on_hand: 5 } },
        // changed
        { recordType: "inventory_position", externalId: "sku-1@wh-1", payload: { sku: "sku-1", on_hand: 12 } },
        // new
        { recordType: "inventory_position", externalId: "sku-3@wh-1", payload: { sku: "sku-3", on_hand: 1 } },
      ],
    })

    expect(outcome).toEqual({ written: 2, skipped: 1 })
    expect(upsert).toHaveBeenCalledTimes(1)
    const [rows, conflict] = upsert.mock.calls[0] as [Array<{ external_id: string; payload: unknown }>, unknown]
    expect(rows.map((row: { external_id: string }) => row.external_id).sort()).toEqual([
      "sku-1@wh-1",
      "sku-3@wh-1",
    ])
    expect(conflict).toEqual({ onConflict: "company_id,source_id,record_type,external_id" })
  })

  it("dedups repeated identities within a slice, last occurrence winning", async () => {
    const { client, upsert } = clientFor([])
    const store = new SupabaseConnectorSyncStore(client)
    const outcome = await store.upsertRecords({
      source: sourceFor(),
      pulledAt: "2026-07-17T00:00:00Z",
      records: [
        { recordType: "vendor", externalId: "v-1", payload: { name: "Old Name" } },
        { recordType: "vendor", externalId: "v-1", payload: { name: "New Name" } },
      ],
    })
    expect(outcome).toEqual({ written: 1, skipped: 0 })
    const [rows] = upsert.mock.calls[0] as [Array<{ payload: unknown }>]
    expect(rows).toHaveLength(1)
    expect(rows[0]?.payload).toEqual({ name: "New Name" })
  })
})
