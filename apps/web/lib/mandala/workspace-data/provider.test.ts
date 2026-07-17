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
    const provider = new WorkspaceDatasetProvider(store)
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
})

function field(name: string, expression: WorkspaceMappingExpression) {
  return {
    name,
    expression,
    required: true,
    modelAllowed: true,
    classification: "internal" as const,
  }
}
