import { describe, expect, it } from "vitest"
import type {
  WorkspaceCapabilityMappingSpec,
  WorkspaceMappingExpression,
} from "@workspace/control-plane"
import type { CompiledCapabilityBinding } from "../skills/compiler"
import { WorkspaceDatasetProvider, type WorkspaceDataStore } from "./provider"

const binding: CompiledCapabilityBinding = {
  id: "workspace.records.read",
  version: "1.0.0",
  access: "read",
  connectorId: "workspace-connector",
  schemaDigest: "a".repeat(64),
  toolName: "workspace.read.workspace_records_read",
  healthy: true,
  granted: true,
  schemaCompatible: true,
  modelAllowedPaths: ["records[]"],
  alias: "tickets",
  useInPrompt: true,
}

const spec = {
  schemaVersion: "mandala.workspace-data/v1" as const,
  capabilityKey: "workspace.records.read",
  capabilityVersion: "1.0.0",
  datasets: [
    {
      alias: "tickets",
      recordType: "support_ticket",
      entityPath: "/ticket_id",
      maximumFreshnessHours: 24,
      required: true,
    },
  ],
  output: {
    collection: "records",
    entityKey: "ticket_id",
    fields: [
      field("ticket_id", {
        op: "first" as const,
        dataset: "tickets",
        path: "/ticket_id",
      }),
      field("severity", {
        op: "max" as const,
        dataset: "tickets",
        path: "/severity",
      }),
      field("age_hours", { op: "age_hours" as const, dataset: "tickets" }),
    ],
  },
  signal: {
    id: "high-severity-ticket",
    all: [
      { left: "severity", operator: "gte" as const, right: { value: 4 } },
      { left: "age_hours", operator: "lte" as const, right: { value: 24 } },
    ],
  },
  bounds: {
    maximumInputRows: 10,
    maximumOutputRows: 10,
    maximumOutputBytes: 65_536,
  },
} satisfies WorkspaceCapabilityMappingSpec

describe("WorkspaceDatasetProvider", () => {
  it("catalogs a differently shaped fixture through the same provider", async () => {
    const store: WorkspaceDataStore = {
      resolveMapping: async () => ({
        mappingVersionId: "10000000-0000-4000-8000-000000000001",
        mappingKey: "workspace.records.read",
        specHash: "b".repeat(64),
        catalogDigest: "c".repeat(64),
        spec,
      }),
      loadRecords: async () => [
        {
          id: "r1",
          companyId: "company",
          sourceId: "source",
          sourceKey: "helpdesk",
          recordType: "support_ticket",
          externalId: "T-42",
          payload: { ticket_id: "T-42", severity: 5 },
          pulledAt: "2026-07-16T19:00:00.000Z",
        },
      ],
    }
    const provider = new WorkspaceDatasetProvider(
      store,
      () => new Date("2026-07-16T20:00:00.000Z")
    )
    const prepared = await provider.prepare({
      companyId: "company",
      bindings: [binding],
    })
    expect(prepared.signal).toMatchObject({
      id: "high-severity-ticket",
      entityValue: "T-42",
    })
    expect(prepared.projections[0]?.records).toEqual([
      { ticket_id: "T-42", severity: 5, age_hours: 1 },
    ])
    expect(prepared.projections[0]?.sourceRefs[0]?.capabilityAlias).toBe(
      "tickets"
    )
  })

  it("carries only canonical records that underpin the selected signal", async () => {
    const store: WorkspaceDataStore = {
      resolveMapping: async () => ({
        mappingVersionId: "10000000-0000-4000-8000-000000000001",
        mappingKey: "workspace.records.read",
        specHash: "b".repeat(64),
        catalogDigest: "c".repeat(64),
        spec,
      }),
      loadRecords: async () => [
        {
          id: "r-signal",
          companyId: "company",
          sourceId: "source",
          sourceKey: "helpdesk",
          recordType: "support_ticket",
          externalId: "T-42",
          payload: { ticket_id: "T-42", severity: 5 },
          pulledAt: "2026-07-16T19:00:00.000Z",
        },
        {
          id: "r-unrelated",
          companyId: "company",
          sourceId: "source",
          sourceKey: "helpdesk",
          recordType: "support_ticket",
          externalId: "T-99",
          payload: { ticket_id: "T-99", severity: 1 },
          pulledAt: "2026-07-16T19:00:00.000Z",
        },
      ],
    }
    const provider = new WorkspaceDatasetProvider(
      store,
      () => new Date("2026-07-16T20:00:00.000Z")
    )
    await provider.prepare({ companyId: "company", bindings: [binding] })

    const loaded = await provider.load({
      state: { companyId: "company" } as never,
      manifest: {} as never,
      bindings: [binding],
      allowedTools: [binding.toolName],
    })

    expect(loaded.sourceRefs).toHaveLength(1)
    expect(loaded.sourceRefs[0]?.reference).toMatchObject({
      canonicalRecordId: "r-signal",
      entityValues: ["T-42"],
    })
  })

  it("retains source evidence when the selected signal is after the first 100 rows", async () => {
    const targetId = "r-target"
    const store: WorkspaceDataStore = {
      resolveMapping: async () => ({
        mappingVersionId: "10000000-0000-4000-8000-000000000001",
        mappingKey: "workspace.records.read",
        specHash: "b".repeat(64),
        catalogDigest: "c".repeat(64),
        spec: {
          ...spec,
          bounds: {
            maximumInputRows: 150,
            maximumOutputRows: 150,
            maximumOutputBytes: 65_536,
          },
        },
      }),
      loadRecords: async () => [
        ...Array.from({ length: 100 }, (_, index) => ({
          id: `r-${index}`,
          companyId: "company",
          sourceId: "source",
          sourceKey: "helpdesk",
          recordType: "support_ticket",
          externalId: `T-${index}`,
          payload: { ticket_id: `T-${index}`, severity: 1 },
          pulledAt: "2026-07-16T19:00:00.000Z",
        })),
        {
          id: targetId,
          companyId: "company",
          sourceId: "source",
          sourceKey: "helpdesk",
          recordType: "support_ticket",
          externalId: "T-target",
          payload: { ticket_id: "T-target", severity: 5 },
          pulledAt: "2026-07-16T19:00:00.000Z",
        },
      ],
    }
    const provider = new WorkspaceDatasetProvider(
      store,
      () => new Date("2026-07-16T20:00:00.000Z")
    )
    await provider.prepare({ companyId: "company", bindings: [binding] })

    const loaded = await provider.load({
      state: { companyId: "company" } as never,
      manifest: {} as never,
      bindings: [binding],
      allowedTools: [binding.toolName],
    })

    expect(loaded.sourceRefs).toHaveLength(1)
    expect(loaded.sourceRefs[0]?.reference).toMatchObject({
      canonicalRecordId: targetId,
      entityValues: ["T-target"],
    })
  })

  it("enforces declared row and byte bounds", async () => {
    const store: WorkspaceDataStore = {
      resolveMapping: async () => ({
        mappingVersionId: "10000000-0000-4000-8000-000000000001",
        mappingKey: "workspace.records.read",
        specHash: "b".repeat(64),
        catalogDigest: "c".repeat(64),
        spec: {
          ...spec,
          bounds: { ...spec.bounds, maximumOutputBytes: 1_024 },
        },
      }),
      loadRecords: async () => [
        {
          id: "r1",
          companyId: "company",
          sourceId: "source",
          sourceKey: "helpdesk",
          recordType: "support_ticket",
          externalId: "T-42",
          payload: {
            ticket_id: "T-42",
            severity: 5,
            ignored: "x".repeat(10_000),
          },
          pulledAt: "2026-07-16T19:00:00.000Z",
        },
      ],
    }
    const provider = new WorkspaceDatasetProvider(
      store,
      () => new Date("2026-07-16T20:00:00.000Z")
    )
    await expect(
      provider.prepare({ companyId: "company", bindings: [binding] })
    ).resolves.toBeTruthy()
  })

  it("rejects a mapping that has no qualifying signal", async () => {
    const store: WorkspaceDataStore = {
      resolveMapping: async () => ({
        mappingVersionId: "10000000-0000-4000-8000-000000000001",
        mappingKey: "workspace.records.read",
        specHash: "b".repeat(64),
        catalogDigest: "c".repeat(64),
        spec,
      }),
      loadRecords: async () => [
        {
          id: "r1",
          companyId: "company",
          sourceId: "source",
          sourceKey: "helpdesk",
          recordType: "support_ticket",
          externalId: "T-1",
          payload: { ticket_id: "T-1", severity: 1 },
          pulledAt: "2026-07-16T19:00:00.000Z",
        },
      ],
    }
    const provider = new WorkspaceDatasetProvider(
      store,
      () => new Date("2026-07-16T20:00:00.000Z")
    )
    await expect(
      provider.prepare({ companyId: "company", bindings: [binding] })
    ).rejects.toMatchObject({
      code: "qualifying_signal_not_found",
    })
  })

  it("enumerates every qualifying signal once and pins the first for load", async () => {
    const store: WorkspaceDataStore = {
      resolveMapping: async () => ({
        mappingVersionId: "10000000-0000-4000-8000-000000000001",
        mappingKey: "workspace.records.read",
        specHash: "b".repeat(64),
        catalogDigest: "c".repeat(64),
        spec,
      }),
      loadRecords: async () => [
        ticket("T-1", 5),
        ticket("T-2", 1),
        ticket("T-3", 4),
        ticket("T-3", 4),
      ],
    }
    const provider = new WorkspaceDatasetProvider(
      store,
      () => new Date("2026-07-16T20:00:00.000Z")
    )
    const prepared = await provider.prepareAll({
      companyId: "company",
      bindings: [binding],
    })

    expect(prepared.signals.map(({ entityValue }) => entityValue)).toEqual([
      "T-1",
      "T-3",
    ])

    const loaded = await provider.load({
      state: { companyId: "company" } as never,
      manifest: {} as never,
      bindings: [binding],
      allowedTools: [binding.toolName],
    })
    expect(loaded.data.tickets).toMatchObject({ ticket_id: "T-1" })
  })

  it("repoints load at the chosen entity after selectSignal", async () => {
    const store: WorkspaceDataStore = {
      resolveMapping: async () => ({
        mappingVersionId: "10000000-0000-4000-8000-000000000001",
        mappingKey: "workspace.records.read",
        specHash: "b".repeat(64),
        catalogDigest: "c".repeat(64),
        spec,
      }),
      loadRecords: async () => [ticket("T-1", 5), ticket("T-3", 4)],
    }
    const provider = new WorkspaceDatasetProvider(
      store,
      () => new Date("2026-07-16T20:00:00.000Z")
    )
    const prepared = await provider.prepareAll({
      companyId: "company",
      bindings: [binding],
    })
    provider.selectSignal(prepared.signals[1]!)

    const loaded = await provider.load({
      state: { companyId: "company" } as never,
      manifest: {} as never,
      bindings: [binding],
      allowedTools: [binding.toolName],
    })
    expect(loaded.data.tickets).toMatchObject({ ticket_id: "T-3" })
    expect(
      loaded.sourceRefs.every(({ reference }) =>
        (reference.entityValues as string[]).includes("T-3")
      )
    ).toBe(true)
  })

  it("refuses selectSignal before prepareAll", () => {
    const provider = new WorkspaceDatasetProvider(
      { resolveMapping: async () => ({}) as never, loadRecords: async () => [] },
      () => new Date("2026-07-16T20:00:00.000Z")
    )
    expect(() =>
      provider.selectSignal({
        id: "high-severity-ticket",
        mappingVersionId: "10000000-0000-4000-8000-000000000001",
        entityKey: "ticket_id",
        entityValue: "T-1",
        detectedAt: "2026-07-16T20:00:00.000Z",
        evidence: {},
      })
    ).toThrowError(
      expect.objectContaining({ code: "provider_not_prepared" })
    )
  })

  it("accepts a zero-match procurement check only with complete current coverage", async () => {
    const provider = procurementProvider([
      coverage("shiphero", "purchase_order", "authoritative", "checked"),
      coverage("trello", "board_card", "tracking", "checked"),
    ])
    const prepared = await provider.prepare({
      companyId: "company",
      bindings: [procurementBinding],
    })

    expect(prepared.projections[0]?.records[0]).toMatchObject({
      sku: "SKU-1",
      duplicateOpenOrderMatchCount: 0,
      openOrderSourceCoverageComplete: true,
    })
    expect(prepared.projections[0]?.warnings).toEqual([])
  })

  it.each([
    ["unavailable", "unavailable"],
    ["stale", "stale"],
  ] as const)(
    "marks a negative procurement check unsafe when a source is %s",
    async (_label, status) => {
      const provider = procurementProvider([
        coverage("shiphero", "purchase_order", "authoritative", "checked"),
        coverage("trello", "board_card", "tracking", status),
      ])
      const prepared = await provider.prepare({
        companyId: "company",
        bindings: [procurementBinding],
      })

      expect(prepared.projections[0]?.records[0]).toMatchObject({
        openOrderSourceCoverageComplete: false,
      })
      expect(prepared.projections[0]?.warnings).toContain(
        "Source coverage is incomplete; a negative operational conclusion is not safe."
      )
      expect(
        prepared.projections[0]?.sourceRefs.some(
          ({ reference }) =>
            reference.kind === "source_coverage" && reference.status === status
        )
      ).toBe(true)
    }
  )
})

const procurementBinding: CompiledCapabilityBinding = {
  ...binding,
  id: "procurement.open-orders.read",
  alias: "open-orders",
  toolName: "workspace.read.procurement_open_orders_read",
}

const procurementSpec = {
  schemaVersion: "mandala.workspace-data/v1" as const,
  capabilityKey: "procurement.open-orders.read",
  capabilityVersion: "1.0.0",
  datasets: [
    {
      alias: "anchor",
      recordType: "inventory_position",
      entityPath: "/sku",
      maximumFreshnessHours: 24,
      required: true,
    },
    {
      alias: "orders",
      recordType: "purchase_order",
      rowsPath: "/lines",
      entityPath: "/sku",
      maximumFreshnessHours: 168,
      required: false,
      businessObject: "procurement.purchase-order",
      evidenceRole: "authoritative" as const,
    },
    {
      alias: "tracking",
      recordType: "board_card",
      entityPath: "/sku",
      maximumFreshnessHours: 72,
      required: false,
      businessObject: "procurement.purchase-order",
      evidenceRole: "tracking" as const,
    },
  ],
  output: {
    collection: "purchaseOrders",
    entityKey: "sku",
    fields: [
      field("sku", { op: "first", dataset: "anchor", path: "/sku" }),
      field("duplicateOpenOrderMatchCount", {
        op: "literal",
        value: 0,
        confirmed: true,
      }),
    ],
  },
  signal: {
    id: "procurement-check",
    all: [
      {
        left: "duplicateOpenOrderMatchCount",
        operator: "gte" as const,
        right: { value: 0 },
      },
    ],
  },
  normalization: {
    model: "procurement.open-order" as const,
    version: "1.0.0" as const,
  },
  coveragePolicy: {
    mode: "all_relevant_sources" as const,
    requiredRoles: ["authoritative" as const],
    outputField: "openOrderSourceCoverageComplete",
    incomplete: "block" as const,
  },
  bounds: {
    maximumInputRows: 100,
    maximumOutputRows: 20,
    maximumOutputBytes: 65_536,
  },
} satisfies WorkspaceCapabilityMappingSpec

function procurementProvider(
  sourceCoverage: Array<{
    sourceId: string
    sourceKey: string
    recordType: string
    businessObject?: string
    evidenceRole?: "authoritative" | "tracking" | "supporting"
    status: "checked" | "unavailable" | "stale" | "schema_drift"
    recordCount: number
    checkedAt: string
    freshestObservedAt: string | null
  }>
) {
  const store: WorkspaceDataStore = {
    resolveMapping: async () => ({
      mappingVersionId: "10000000-0000-4000-8000-000000000001",
      mappingKey: "procurement.open-orders.read",
      specHash: "b".repeat(64),
      catalogDigest: "c".repeat(64),
      spec: procurementSpec,
    }),
    loadRecords: async ({ recordType }) =>
      recordType === "inventory_position"
        ? [
            {
              id: "inventory-record",
              companyId: "company",
              sourceId: "shiphero",
              sourceKey: "shiphero",
              recordType,
              externalId: "SKU-1",
              payload: { sku: "SKU-1" },
              pulledAt: "2026-07-17T18:00:00.000Z",
            },
          ]
        : [],
    inspectCoverage: async ({ recordType }) =>
      recordType === "inventory_position"
        ? [coverage("shiphero", recordType, undefined, "checked")]
        : sourceCoverage.filter((result) => result.recordType === recordType),
  }
  return new WorkspaceDatasetProvider(
    store,
    () => new Date("2026-07-17T19:00:00.000Z")
  )
}

function coverage(
  sourceKey: string,
  recordType: string,
  evidenceRole: "authoritative" | "tracking" | "supporting" | undefined,
  status: "checked" | "unavailable" | "stale" | "schema_drift"
) {
  return {
    sourceId: sourceKey,
    sourceKey,
    recordType,
    ...(evidenceRole
      ? {
          businessObject: "procurement.purchase-order",
          evidenceRole,
        }
      : {}),
    status,
    recordCount: 0,
    checkedAt: "2026-07-17T19:00:00.000Z",
    freshestObservedAt: "2026-07-17T18:00:00.000Z",
  }
}

function ticket(ticketId: string, severity: number) {
  return {
    id: `r-${ticketId}-${severity}`,
    companyId: "company",
    sourceId: "source",
    sourceKey: "helpdesk",
    recordType: "support_ticket",
    externalId: ticketId,
    payload: { ticket_id: ticketId, severity },
    pulledAt: "2026-07-16T19:00:00.000Z",
  }
}

function field(name: string, expression: WorkspaceMappingExpression) {
  return {
    name,
    expression,
    required: true,
    modelAllowed: true,
    classification: "internal" as const,
  }
}
