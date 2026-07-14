import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { beforeAll, describe, expect, it } from "vitest"
import { syntheticCompilerCapabilities } from "../skills/catalog-compiler"
import {
  compileAgentSkill,
  type CompiledAgentManifest,
} from "../skills/compiler"
import {
  WorkflowMemoryStore,
  getProcurementFixtureScenario,
} from "../workflows"
import type { ProcurementSkuSnapshot } from "../workflows/fixtures/procurement"
import { runCompiledWorkflowInMemory } from "./memory-runner"

let procurementManifest: CompiledAgentManifest
let investigationManifest: CompiledAgentManifest

beforeAll(async () => {
  procurementManifest = await compileSkill("procurement-reorder")
  investigationManifest = await compileSkill("sales-spike-investigator")
})

describe("compiled workflow memory runner", () => {
  it("creates a complete review package with checkpoint correlation", async () => {
    const store = new WorkflowMemoryStore()
    const scenario = getProcurementFixtureScenario("clean_reorder")

    const result = await runProcurement({
      store,
      scenario: scenario.sku,
      manifest: procurementManifest,
      triggerId: "review-run",
    })

    expect(result.run).toMatchObject({
      status: "waiting_for_approval",
      langGraphThreadId: result.run.id,
      completedAt: null,
    })
    expect(result.run.langGraphCheckpointId).toBeTruthy()
    expect(result.definition.spec.nodes).toHaveLength(
      procurementManifest.graph.length
    )
    expect(result.event).toMatchObject({
      validationStatus: "pass",
      freshnessState: "fresh",
    })
    expect(result.item).toMatchObject({
      status: "active",
      itemType: "procurement_reorder_review",
    })
    expect(result.contextPacket?.facts).toHaveProperty("rules")
    expect(result.recommendation?.output).toMatchObject({
      sku: scenario.sku.sku,
      recommendedQuantity: 144,
    })
    expect(result.evidence?.sourceRefs).toHaveLength(5)
    expect(result.draft).toMatchObject({
      status: "pending_review",
      actionType: "execute_mock_purchase_order",
    })
    expect(result.draft?.payloadHash).toBeTruthy()
    expect(result.auditEvents.map((event) => event.eventType)).toEqual([
      "event_validated",
      "recommendation_created",
    ])
    expect(
      result.auditEvents.every(
        (event) =>
          event.trace.langGraphThreadId === result.run.id &&
          event.trace.langGraphCheckpointId === result.run.langGraphCheckpointId
      )
    ).toBe(true)
    expect(store.items).toHaveLength(1)
    expect(store.contextPackets).toHaveLength(1)
    expect(store.recommendations).toHaveLength(1)
    expect(store.evidenceSnapshots).toHaveLength(1)
    expect(store.drafts).toHaveLength(1)
  })

  it.each([
    ["stale_inventory", "blocked"],
    ["no_action", "suppressed"],
  ] as const)(
    "handles terminal %s runs without review records",
    async (scenarioId, status) => {
      const store = new WorkflowMemoryStore()
      const scenario = getProcurementFixtureScenario(scenarioId)

      const result = await runProcurement({
        store,
        scenario: scenario.sku,
        manifest: procurementManifest,
        triggerId: scenarioId,
      })

      expect(result.run.status).toBe(status)
      expect(result.run.completedAt).toBeTruthy()
      expect(result.run.langGraphCheckpointId).toBeTruthy()
      expect(result.item).toBeNull()
      expect(result.contextPacket).toBeNull()
      expect(result.recommendation).toBeNull()
      expect(result.evidence).toBeNull()
      expect(result.draft).toBeNull()
      expect(store.items).toHaveLength(0)
      expect(result.event.validationResult.suppressRecommendation).toBe(
        status === "suppressed"
      )
      if (status === "blocked") {
        expect(result.event.validationStatus).toBe("blocked")
        expect(result.event.freshnessState).toBe("stale")
      }
    }
  )

  it("creates a review without inventing a draft for an advisory skill", async () => {
    const store = new WorkflowMemoryStore()
    const result = await runCompiledWorkflowInMemory({
      store,
      manifest: investigationManifest,
      companyId: "company-memory",
      actorUserId: "user-memory",
      trigger: {
        id: "spike-review",
        kind: "manual",
        input: { source: "test" },
      },
      capabilityProvider: capabilityProvider(investigationManifest),
      agentJudgment: async () => ({
        proposal: {
          selection: {
            sku: "DEMO-SPIKE-1",
            title: "Demo product",
            recent30DaySales: 150,
            trailing90DaySales: 270,
            recentSpikeMultiplier: 1.4,
            inventoryOnHand: 20,
            inboundUnits: 0,
          },
        },
        rationale: "A bounded sales signal warrants manager review.",
        confidence: 0.75,
        warnings: [],
        context: {},
      }),
      now: new Date("2026-07-13T12:00:00.000Z"),
    })

    expect(result.run.status).toBe("waiting_for_approval")
    expect(result.item?.itemType).toBe("sales_spike_review")
    expect(result.recommendation?.output).toMatchObject({
      sku: "DEMO-SPIKE-1",
      recentSpikeMultiplier: 1.4,
      availableInventory: 20,
    })
    expect(result.draft).toBeNull()
    expect(store.drafts).toHaveLength(0)
  })

  it("suppresses duplicate active items without duplicating their records", async () => {
    const store = new WorkflowMemoryStore()
    const scenario = getProcurementFixtureScenario("clean_reorder")
    const first = await runProcurement({
      store,
      scenario: scenario.sku,
      manifest: procurementManifest,
      triggerId: "first",
    })
    const duplicate = await runProcurement({
      store,
      scenario: scenario.sku,
      manifest: procurementManifest,
      triggerId: "second",
    })

    expect(duplicate.run.status).toBe("suppressed")
    expect(duplicate.item?.id).toBe(first.item?.id)
    expect(duplicate.draft?.id).toBe(first.draft?.id)
    expect(duplicate.auditEvents.map((event) => event.eventType)).toContain(
      "item_duplicate_suppressed"
    )
    expect(store.items).toHaveLength(1)
    expect(store.recommendations).toHaveLength(1)
    expect(store.evidenceSnapshots).toHaveLength(1)
    expect(store.drafts).toHaveLength(1)
  })
})

async function runProcurement(input: {
  store: WorkflowMemoryStore
  scenario: ProcurementSkuSnapshot
  manifest: CompiledAgentManifest
  triggerId: string
}) {
  return runCompiledWorkflowInMemory({
    store: input.store,
    manifest: input.manifest,
    companyId: "company-memory",
    actorUserId: "user-memory",
    trigger: {
      id: input.triggerId,
      kind: "fixture",
      input: { snapshot: input.triggerId },
    },
    capabilityProvider: capabilityProvider(input.manifest),
    agentJudgment: async () => ({
      proposal: { selection: input.scenario },
      rationale: "A bounded source-data review selected this product.",
      confidence: 0.82,
      warnings: [],
      context: {},
    }),
    now: new Date("2026-07-13T12:00:00.000Z"),
  })
}

function capabilityProvider(manifest: CompiledAgentManifest) {
  return {
    load: async () => ({
      data: Object.fromEntries(
        manifest.capabilityBindings
          .filter((binding) => binding.access === "read")
          .map((binding) => [binding.alias, { snapshot: "snapshot-1" }])
      ),
      sourceRefs: manifest.capabilityBindings
        .filter((binding) => binding.access === "read")
        .map((binding) => ({
          capabilityAlias: binding.alias,
          connectorId: binding.connectorId,
          observedAt: "2026-07-13T12:00:00.000Z",
          reference: { snapshotId: `${binding.alias}-snapshot` },
        })),
    }),
  }
}

async function compileSkill(slug: string): Promise<CompiledAgentManifest> {
  const source = await readFile(
    resolve(process.cwd(), `../../skills/${slug}/SKILL.md`),
    "utf8"
  )
  const compiled = compileAgentSkill({
    source,
    capabilities: syntheticCompilerCapabilities(),
  })
  if (!compiled.ok) {
    throw new Error(compiled.diagnostics.map((item) => item.message).join("\n"))
  }
  return compiled.manifest
}
