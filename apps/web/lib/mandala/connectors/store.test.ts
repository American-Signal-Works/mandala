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
  }
}

// Chainable fake for the two query shapes upsertRecords uses: the existing-
// payload select (select().eq().eq().eq().in() -> rows) and upsert().
function clientFor(
  existingRows: Array<{ external_id: string; payload: unknown }>
) {
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

function claimClientFor(input: {
  rows: Array<Record<string, unknown>>
  claimRows?: Array<{ id: string }>
}) {
  const loadQuery = {
    in: vi.fn(() => loadQuery),
    order: vi.fn().mockResolvedValue({ data: input.rows, error: null }),
  }
  const claimQuery = {
    eq: vi.fn(() => claimQuery),
    is: vi.fn(() => claimQuery),
    select: vi.fn().mockResolvedValue({
      data: input.claimRows ?? [{ id: "source-1" }],
      error: null,
    }),
  }
  const update = vi.fn(() => claimQuery)
  const from = vi
    .fn()
    .mockImplementationOnce(() => ({ select: vi.fn(() => loadQuery) }))
    .mockImplementationOnce(() => ({ update }))
  return { client: { from }, loadQuery, claimQuery, update }
}

function sourceRow(config: Record<string, unknown> = {}) {
  return {
    id: "source-1",
    company_id: "company-1",
    source_key: "shiphero",
    kind: "inventory_platform",
    config,
    sync_status: "idle",
    last_synced_at: null,
  }
}

const connectedReadAccess = {
  status: "connected",
  permissions: { read: true, write: false },
}

describe("SupabaseConnectorSyncStore.claimDueSource", () => {
  it("matches the provider source_key while preserving the business kind", async () => {
    const { client, loadQuery } = claimClientFor({
      rows: [
        sourceRow({
          access: connectedReadAccess,
          sync: { enabled: true },
        }),
      ],
    })
    const store = new SupabaseConnectorSyncStore(client)

    const source = await store.claimDueSource({
      now: new Date("2026-07-17T00:00:00Z"),
      sourceKeys: ["shiphero"],
      leaseSeconds: 240,
    })

    expect(loadQuery.in).toHaveBeenCalledWith("source_key", ["shiphero"])
    expect(source).toMatchObject({
      sourceKey: "shiphero",
      kind: "inventory_platform",
      sync: { enabled: true },
    })
    expect(source?.sync.leaseToken).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    )
  })

  it("does not claim a source that has not explicitly enabled sync", async () => {
    const { client } = claimClientFor({
      rows: [sourceRow({ access: connectedReadAccess })],
    })
    const store = new SupabaseConnectorSyncStore(client)

    await expect(
      store.claimDueSource({
        now: new Date("2026-07-17T00:00:00Z"),
        sourceKeys: ["shiphero"],
        leaseSeconds: 240,
      })
    ).resolves.toBeNull()
    expect(client.from).toHaveBeenCalledTimes(1)
  })

  it.each([
    { status: "paused", permissions: { read: true, write: true } },
    { status: "connected", permissions: { read: false, write: true } },
  ])(
    "does not read a connector without active read access: %j",
    async (access) => {
      const { client } = claimClientFor({
        rows: [sourceRow({ access, sync: { enabled: true } })],
      })
      const store = new SupabaseConnectorSyncStore(client)

      await expect(
        store.claimDueSource({
          now: new Date("2026-07-17T00:00:00Z"),
          sourceKeys: ["shiphero"],
          leaseSeconds: 240,
        })
      ).resolves.toBeNull()
      expect(client.from).toHaveBeenCalledTimes(1)
    }
  )

  it("honors failure backoff before reclaiming a source", async () => {
    const { client } = claimClientFor({
      rows: [
        sourceRow({
          access: connectedReadAccess,
          sync: {
            enabled: true,
            nextAttemptAt: "2026-07-17T00:05:00Z",
          },
        }),
      ],
    })
    const store = new SupabaseConnectorSyncStore(client)

    await expect(
      store.claimDueSource({
        now: new Date("2026-07-17T00:00:00Z"),
        sourceKeys: ["shiphero"],
        leaseSeconds: 240,
      })
    ).resolves.toBeNull()
    expect(client.from).toHaveBeenCalledTimes(1)
  })
})

describe("SupabaseConnectorSyncStore source lifecycle", () => {
  function updateClient(resultRows: Array<{ id: string }>) {
    const query = {
      eq: vi.fn(() => query),
      is: vi.fn(() => query),
      select: vi.fn().mockResolvedValue({ data: resultRows, error: null }),
    }
    const update = vi.fn(() => query)
    return { client: { from: vi.fn(() => ({ update })) }, query, update }
  }

  it("fences a stale worker out of source completion", async () => {
    const { client, query } = updateClient([])
    const store = new SupabaseConnectorSyncStore(client)
    const source = sourceFor()
    source.sync.leaseToken = "2c9f1d24-4c9e-4fd2-8e42-6c274c67d426"

    await expect(
      store.completeSync({ source, now: new Date("2026-07-17T00:00:00Z") })
    ).rejects.toThrow("connector_source_lease_lost")
    expect(query.eq).toHaveBeenCalledWith(
      "config->sync->>leaseToken",
      source.sync.leaseToken
    )
  })

  it("backs failures off and resets the backoff after a successful slice", async () => {
    const failed = updateClient([{ id: "source-1" }])
    const failedStore = new SupabaseConnectorSyncStore(failed.client)
    const source = sourceFor()
    source.sync.leaseToken = "2c9f1d24-4c9e-4fd2-8e42-6c274c67d426"

    await failedStore.failSync({
      source,
      error: "shiphero_rate_limited",
      now: new Date("2026-07-17T00:00:00Z"),
    })
    expect(failed.update).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({
          sync: expect.objectContaining({
            failureCount: 1,
            nextAttemptAt: "2026-07-17T00:05:00.000Z",
          }),
        }),
      })
    )

    const recovered = updateClient([{ id: "source-1" }])
    const recoveredStore = new SupabaseConnectorSyncStore(recovered.client)
    await recoveredStore.saveCursor({
      source,
      cursor: { phase: "inventory" },
    })
    expect(recovered.update).toHaveBeenCalledWith(
      expect.objectContaining({
        last_sync_error: null,
        config: expect.objectContaining({
          sync: expect.objectContaining({
            failureCount: 0,
            nextAttemptAt: null,
          }),
        }),
      })
    )
  })
})

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
        {
          recordType: "inventory_position",
          externalId: "sku-2@wh-1",
          payload: { sku: "sku-2", on_hand: 5 },
        },
        // changed
        {
          recordType: "inventory_position",
          externalId: "sku-1@wh-1",
          payload: { sku: "sku-1", on_hand: 12 },
        },
        // new
        {
          recordType: "inventory_position",
          externalId: "sku-3@wh-1",
          payload: { sku: "sku-3", on_hand: 1 },
        },
      ],
    })

    expect(outcome).toEqual({ written: 2, skipped: 1 })
    expect(upsert).toHaveBeenCalledTimes(1)
    const [rows, conflict] = upsert.mock.calls[0] as [
      Array<{ external_id: string; payload: unknown }>,
      unknown,
    ]
    expect(
      rows.map((row: { external_id: string }) => row.external_id).sort()
    ).toEqual(["sku-1@wh-1", "sku-3@wh-1"])
    expect(conflict).toEqual({
      onConflict: "company_id,source_id,record_type,external_id",
    })
  })

  it("dedups repeated identities within a slice, last occurrence winning", async () => {
    const { client, upsert } = clientFor([])
    const store = new SupabaseConnectorSyncStore(client)
    const outcome = await store.upsertRecords({
      source: sourceFor(),
      pulledAt: "2026-07-17T00:00:00Z",
      records: [
        {
          recordType: "vendor",
          externalId: "v-1",
          payload: { name: "Old Name" },
        },
        {
          recordType: "vendor",
          externalId: "v-1",
          payload: { name: "New Name" },
        },
      ],
    })
    expect(outcome).toEqual({ written: 1, skipped: 0 })
    const [rows] = upsert.mock.calls[0] as [Array<{ payload: unknown }>]
    expect(rows).toHaveLength(1)
    expect(rows[0]?.payload).toEqual({ name: "New Name" })
  })
})
