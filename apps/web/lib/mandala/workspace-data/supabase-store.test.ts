import { describe, expect, it, vi } from "vitest"

import type { WorkflowSupabaseClient } from "../workflows"
import { SupabaseWorkspaceDataStore } from "./supabase-store"

const companyId = "20000000-0000-4000-8000-000000000001"
const otherCompanyId = "20000000-0000-4000-8000-000000000002"
const sourceId = "30000000-0000-4000-8000-000000000001"
const otherSourceId = "30000000-0000-4000-8000-000000000002"
const recordId = "40000000-0000-4000-8000-000000000001"
const bindingSnapshotId = "50000000-0000-4000-8000-000000000001"
const now = new Date("2026-07-23T16:00:00.000Z")
const rawProviderError = "provider-secret-credit-payload"

const connectedReadAccess = {
  status: "connected",
  permissions: { read: true, write: false },
}

describe("SupabaseWorkspaceDataStore source readability", () => {
  it("loads a connected source's last-known-good records during retry backoff", async () => {
    const fake = clientFor({
      external_sources: [sourceRow()],
      workspace_data_catalogs: [
        catalogRow({ freshestObservedAt: "2026-07-23T15:00:00.000Z" }),
      ],
      external_records: [
        externalRecord(),
        externalRecord({
          id: "40000000-0000-4000-8000-000000000002",
          company: otherCompanyId,
        }),
        externalRecord({
          id: "40000000-0000-4000-8000-000000000003",
          source: otherSourceId,
        }),
        externalRecord({
          id: "40000000-0000-4000-8000-000000000004",
          recordType: "sales_order",
        }),
      ],
    })
    const store = workspaceStore(fake.client)

    await expect(
      store.loadRecords({
        companyId,
        sourceKey: "shiphero",
        recordType: "inventory_position",
        limit: 10,
      })
    ).resolves.toEqual([
      expect.objectContaining({
        id: recordId,
        companyId,
        sourceId,
        sourceKey: "shiphero",
        recordType: "inventory_position",
      }),
    ])

    expect(fake.queries.external_sources?.[0]?.eq).toHaveBeenCalledWith(
      "company_id",
      companyId
    )
    expect(fake.queries.external_sources?.[0]?.select).toHaveBeenCalledWith(
      "id, source_key, sync_status, config, last_synced_at"
    )
    expect(fake.queries.external_sources?.[0]?.eq).toHaveBeenCalledWith(
      "source_key",
      "shiphero"
    )
    expect(fake.queries.external_records?.[0]?.eq).toHaveBeenCalledWith(
      "company_id",
      companyId
    )
    expect(fake.queries.external_records?.[0]?.eq).toHaveBeenCalledWith(
      "record_type",
      "inventory_position"
    )
    expect(fake.queries.external_records?.[0]?.in).toHaveBeenCalledWith(
      "source_id",
      [sourceId]
    )
    expect(fake.queries.external_records?.[0]?.order).toHaveBeenCalledWith(
      "pulled_at",
      { ascending: false }
    )
    expect(fake.queries.external_records?.[0]?.order).toHaveBeenCalledWith(
      "id",
      { ascending: true }
    )
    expect(fake.queries.external_records?.[0]?.range).toHaveBeenCalledWith(0, 9)
  })

  it("does not read a snapshot while the next sync is running", async () => {
    const fake = clientFor({
      external_sources: [sourceRow({ syncStatus: "syncing" })],
      workspace_data_catalogs: [
        catalogRow({ freshestObservedAt: "2026-07-23T15:00:00.000Z" }),
      ],
      external_records: [externalRecord()],
    })
    const store = workspaceStore(fake.client)

    await expect(
      store.loadRecords({
        companyId,
        sourceKey: "shiphero",
        recordType: "inventory_position",
        limit: 1,
      })
    ).resolves.toEqual([])
    expect(fake.from).toHaveBeenCalledTimes(1)
  })

  it.each([
    {
      label: "paused",
      access: {
        status: "paused",
        permissions: { read: true, write: false },
      },
    },
    {
      label: "disconnected",
      access: {
        status: "disconnected",
        permissions: { read: true, write: false },
      },
    },
    {
      label: "read denied",
      access: {
        status: "connected",
        permissions: { read: false, write: false },
      },
    },
    {
      label: "access error",
      access: {
        status: "error",
        permissions: { read: true, write: false },
      },
    },
    {
      label: "malformed",
      access: {
        status: "connected",
        permissions: { read: "yes", write: false },
      },
    },
  ])(
    "does not load records when connector access is $label",
    async ({ access }) => {
      const fake = clientFor({
        external_sources: [sourceRow({ access })],
        external_records: [externalRecord()],
      })
      const store = workspaceStore(fake.client)

      await expect(
        store.loadRecords({
          companyId,
          sourceKey: "shiphero",
          recordType: "inventory_position",
          limit: 10,
        })
      ).resolves.toEqual([])
      expect(fake.from).toHaveBeenCalledTimes(1)
    }
  )
})

describe("SupabaseWorkspaceDataStore source coverage", () => {
  it("checks a fresh last-known-good snapshot without exposing the provider error", async () => {
    const fake = coverageClient({
      source: sourceRow(),
      catalog: catalogRow({
        freshestObservedAt: "2026-07-23T15:00:00.000Z",
      }),
    })
    const store = workspaceStore(fake.client)

    const coverage = await inspectInventoryCoverage(store)

    expect(coverage).toEqual([
      expect.objectContaining({
        sourceId,
        sourceKey: "shiphero",
        recordType: "inventory_position",
        status: "checked",
        error:
          "Latest source sync failed; coverage is based on the last-known-good snapshot.",
      }),
    ])
    expect(JSON.stringify(coverage)).not.toContain(rawProviderError)
    expect(fake.queries.external_sources?.[0]?.select).toHaveBeenCalledWith(
      "id, source_key, sync_status, config, last_synced_at"
    )
  })

  it("keeps a snapshot unavailable while the next sync is running", async () => {
    const fake = coverageClient({
      source: sourceRow({ syncStatus: "syncing" }),
      catalog: catalogRow({
        freshestObservedAt: "2026-07-23T15:00:00.000Z",
      }),
    })
    const store = workspaceStore(fake.client)

    await expect(inspectInventoryCoverage(store)).resolves.toEqual([
      expect.objectContaining({
        status: "unavailable",
        error:
          "Source sync is still running; a completed snapshot is not available.",
      }),
    ])
  })

  it("keeps an expired error-state snapshot stale", async () => {
    const fake = coverageClient({
      source: sourceRow({
        lastSyncedAt: "2026-07-20T15:59:59.000Z",
      }),
      catalog: catalogRow({
        freshestObservedAt: "2026-07-20T15:59:59.000Z",
      }),
    })
    const store = workspaceStore(fake.client)

    await expect(inspectInventoryCoverage(store)).resolves.toEqual([
      expect.objectContaining({
        status: "stale",
        error:
          "Latest source sync failed; coverage is based on the last-known-good snapshot.",
      }),
    ])
  })

  it("blocks an error-state source when a partial cycle advanced the catalog", async () => {
    const source = sourceRow({
      lastSyncedAt: "2026-07-23T14:00:00.000Z",
    })
    const catalog = catalogRow({
      freshestObservedAt: "2026-07-23T15:00:00.000Z",
    })
    const fake = clientFor({
      external_sources: [source],
      workspace_data_catalogs: [catalog],
      external_records: [externalRecord()],
    })
    const store = workspaceStore(fake.client)

    await expect(
      store.loadRecords({
        companyId,
        sourceKey: "shiphero",
        recordType: "inventory_position",
        limit: 10,
      })
    ).resolves.toEqual([])
    await expect(inspectInventoryCoverage(store)).resolves.toEqual([
      expect.objectContaining({
        status: "unavailable",
        freshestObservedAt: "2026-07-23T14:00:00.000Z",
        error: "Source data changed after the last completed sync.",
      }),
    ])
  })

  it("keeps schema-drifted error-state coverage blocked", async () => {
    const fake = coverageClient({
      source: sourceRow(),
      catalog: catalogRow({
        freshestObservedAt: "2026-07-23T15:00:00.000Z",
        profileStatus: "drifted",
      }),
    })
    const store = workspaceStore(fake.client)

    await expect(inspectInventoryCoverage(store)).resolves.toEqual([
      expect.objectContaining({
        status: "schema_drift",
        error:
          "Latest source sync failed; coverage is based on the last-known-good snapshot.",
      }),
    ])
  })

  it.each([
    { label: "pending", profileStatus: "pending" as const },
    { label: "detached", profileStatus: "detached" as const },
    { label: "missing", profileStatus: null },
  ])("keeps a $label catalog unavailable", async ({ profileStatus }) => {
    const source = sourceRow()
    const catalog = profileStatus
      ? catalogRow({
          freshestObservedAt: "2026-07-23T15:00:00.000Z",
          profileStatus,
        })
      : undefined
    const fake = clientFor({
      external_sources: [source],
      workspace_data_catalogs: catalog ? [catalog] : [],
      external_records: [externalRecord()],
    })
    const store = workspaceStore(fake.client)

    await expect(
      store.loadRecords({
        companyId,
        sourceKey: "shiphero",
        recordType: "inventory_position",
        limit: 10,
      })
    ).resolves.toEqual([])
    await expect(inspectInventoryCoverage(store)).resolves.toEqual([
      expect.objectContaining({
        status: "unavailable",
        error: "Source data catalog is not ready.",
      }),
    ])
  })

  it("preserves ready idle-source behavior without a degraded-sync notice", async () => {
    const source = sourceRow({ syncStatus: "idle" })
    const catalog = catalogRow({
      freshestObservedAt: "2026-07-23T15:00:00.000Z",
    })
    const fake = clientFor({
      external_sources: [source],
      workspace_data_catalogs: [catalog],
      external_records: [externalRecord()],
    })
    const store = workspaceStore(fake.client)

    await expect(
      store.loadRecords({
        companyId,
        sourceKey: "shiphero",
        recordType: "inventory_position",
        limit: 10,
      })
    ).resolves.toHaveLength(1)
    const coverage = await inspectInventoryCoverage(store)
    expect(coverage).toEqual([
      expect.objectContaining({
        status: "checked",
      }),
    ])
    expect(coverage[0]).not.toHaveProperty("error")
  })

  it("keeps an idle mid-cycle snapshot unavailable when a resume cursor remains", async () => {
    const source = sourceRow({
      syncStatus: "idle",
      cursor: { phase: "inventory", after: "partial-page" },
      lastSyncedAt: "2026-07-23T14:00:00.000Z",
    })
    const catalog = catalogRow({
      freshestObservedAt: "2026-07-23T15:00:00.000Z",
    })
    const fake = clientFor({
      external_sources: [source],
      workspace_data_catalogs: [catalog],
      external_records: [externalRecord()],
    })
    const store = workspaceStore(fake.client)

    await expect(
      store.loadRecords({
        companyId,
        sourceKey: "shiphero",
        recordType: "inventory_position",
        limit: 10,
      })
    ).resolves.toEqual([])
    await expect(inspectInventoryCoverage(store)).resolves.toEqual([
      expect.objectContaining({
        status: "unavailable",
        error: "Source data changed after the last completed sync.",
      }),
    ])
  })

  it.each([
    {
      label: "paused",
      access: {
        status: "paused",
        permissions: { read: true, write: false },
      },
    },
    {
      label: "disconnected",
      access: {
        status: "disconnected",
        permissions: { read: true, write: false },
      },
    },
    {
      label: "read denied",
      access: {
        status: "connected",
        permissions: { read: false, write: false },
      },
    },
    {
      label: "access error",
      access: {
        status: "error",
        permissions: { read: true, write: false },
      },
    },
    {
      label: "malformed",
      access: {
        status: "connected",
        permissions: { read: "yes", write: false },
      },
    },
  ])("keeps $label connector access unavailable", async ({ access }) => {
    const fake = coverageClient({
      source: sourceRow({ access }),
      catalog: catalogRow({
        freshestObservedAt: "2026-07-23T15:00:00.000Z",
      }),
    })
    const store = workspaceStore(fake.client)

    await expect(inspectInventoryCoverage(store)).resolves.toEqual([
      expect.objectContaining({
        status: "unavailable",
        error: "Source is not connected with read permission.",
      }),
    ])
  })
})

function workspaceStore(client: WorkflowSupabaseClient) {
  return new SupabaseWorkspaceDataStore(client, bindingSnapshotId, () => now)
}

function inspectInventoryCoverage(store: SupabaseWorkspaceDataStore) {
  return store.inspectCoverage({
    companyId,
    sourceKey: "shiphero",
    recordType: "inventory_position",
    maximumFreshnessHours: 72,
  })
}

function sourceRow(
  input: {
    access?: Record<string, unknown>
    syncStatus?: "idle" | "syncing" | "error"
    lastSyncedAt?: string | null
    cursor?: Record<string, unknown> | null
  } = {}
) {
  return {
    id: sourceId,
    company_id: companyId,
    source_key: "shiphero",
    sync_status: input.syncStatus ?? "error",
    config: {
      access: input.access ?? connectedReadAccess,
      sync: { cursor: input.cursor ?? null },
    },
    last_synced_at:
      input.lastSyncedAt === undefined
        ? "2026-07-23T15:00:00.000Z"
        : input.lastSyncedAt,
    last_sync_error: rawProviderError,
  }
}

function externalRecord(
  input: {
    id?: string
    company?: string
    source?: string
    recordType?: string
  } = {}
) {
  return {
    id: input.id ?? recordId,
    company_id: input.company ?? companyId,
    source_id: input.source ?? sourceId,
    record_type: input.recordType ?? "inventory_position",
    external_id: "SKU-1@warehouse-1",
    payload: { sku: "SKU-1", on_hand: 12 },
    pulled_at: "2026-07-23T15:00:00.000Z",
  }
}

function catalogRow(input: {
  freshestObservedAt: string
  profileStatus?: "pending" | "ready" | "drifted" | "detached"
}) {
  return {
    source_id: sourceId,
    company_id: companyId,
    source_key: "shiphero",
    record_type: "inventory_position",
    record_count: 1,
    schema_hash: "a".repeat(64),
    profile_status: input.profileStatus ?? "ready",
    freshest_observed_at: input.freshestObservedAt,
  }
}

function coverageClient(input: {
  source: ReturnType<typeof sourceRow>
  catalog?: ReturnType<typeof catalogRow>
}) {
  return clientFor({
    external_sources: [input.source],
    workspace_data_catalogs: input.catalog ? [input.catalog] : [],
  })
}

function clientFor(rowsByTable: Record<string, unknown[]>) {
  const queries: Record<string, ReturnType<typeof queryFor>[]> = {}
  const from = vi.fn((table: string) => {
    const query = queryFor(rowsByTable[table] ?? [])
    queries[table] = [...(queries[table] ?? []), query]
    return query
  })
  return {
    client: { from } as unknown as WorkflowSupabaseClient,
    from,
    queries,
  }
}

function queryFor(initialRows: unknown[]) {
  let rows = [...initialRows]
  const result = () => ({ data: rows, error: null })
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn((column: string, value: unknown) => {
      rows = rows.filter((row) => rowValue(row, column) === value)
      return query
    }),
    in: vi.fn((column: string, values: readonly unknown[]) => {
      rows = rows.filter((row) => values.includes(rowValue(row, column)))
      return query
    }),
    order: vi.fn((column: string, options: { ascending?: boolean } = {}) => {
      const direction = options.ascending === false ? -1 : 1
      rows.sort(
        (left, right) =>
          String(rowValue(left, column)).localeCompare(
            String(rowValue(right, column))
          ) * direction
      )
      return query
    }),
    limit: vi.fn((count: number) => {
      rows = rows.slice(0, count)
      return query
    }),
    range: vi.fn((from: number, to: number) => {
      rows = rows.slice(from, to + 1)
      return query
    }),
    single: vi.fn(() =>
      Promise.resolve({ data: rows[0] ?? null, error: null })
    ),
    maybeSingle: vi.fn(() =>
      Promise.resolve({ data: rows[0] ?? null, error: null })
    ),
    then: (
      onFulfilled: (value: ReturnType<typeof result>) => unknown,
      onRejected?: (reason: unknown) => unknown
    ) => Promise.resolve(result()).then(onFulfilled, onRejected),
  }
  return query
}

function rowValue(row: unknown, column: string): unknown {
  if (!row || typeof row !== "object" || Array.isArray(row)) return undefined
  return (row as Record<string, unknown>)[column]
}
