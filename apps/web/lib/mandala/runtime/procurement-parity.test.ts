import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { beforeAll, describe, expect, it } from "vitest"
import { compileAgentSkill, type CompiledAgentManifest } from "../skills/compiler"
import { syntheticCompilerCapabilities } from "../skills/catalog-compiler"
import {
  WorkflowMemoryStore,
  getProcurementFixtureScenario,
  runProcurementFixtureScenario,
  type StaticProcurementFixtureScenarioId,
} from "../workflows"
import { createGenericWorkflowRuntime } from "./graph"

const companyId = "company-parity"
const actorId = "actor-parity"
let manifest: CompiledAgentManifest

beforeAll(async () => {
  const source = await readFile(
    resolve(process.cwd(), "../../skills/procurement-reorder/SKILL.md"),
    "utf8"
  )
  const compiled = compileAgentSkill({
    source,
    capabilities: syntheticCompilerCapabilities(),
  })
  if (!compiled.ok) {
    throw new Error(compiled.diagnostics.map((item) => item.message).join("\n"))
  }
  manifest = compiled.manifest
})

describe("compiled procurement shadow parity", () => {
  it.each([
    ["clean_reorder", "waiting_for_approval"],
    ["sales_spike_warning", "waiting_for_approval"],
    ["duplicate_open_order", "blocked"],
    ["stale_inventory", "blocked"],
    ["no_action", "suppressed"],
  ] as const)("matches legacy business behavior for %s", async (scenarioId, status) => {
    const scenario = getProcurementFixtureScenario(scenarioId)
    const legacy = runProcurementFixtureScenario({
      store: new WorkflowMemoryStore(),
      companyId,
      actorUserId: actorId,
      scenarioId,
      now: new Date("2026-07-13T12:00:00.000Z"),
    })
    const generic = await runCompiledScenario(scenarioId)

    expect(generic.output.status).toBe(status)
    if (status === "waiting_for_approval") {
      expect(generic.output.review?.recommendation.output).toMatchObject({
        recommendedQuantity: legacy.recommendation?.output.recommendedQuantity,
        availableInventory: legacy.recommendation?.output.availableInventory,
        reorderPoint: legacy.recommendation?.output.reorderPoint,
      })
      expect(generic.output.review?.item.priority).toBe(legacy.item?.priority)
      expect(generic.output.warnings).toEqual(legacy.recommendation?.warnings)
    } else {
      expect(generic.output.review).toBeNull()
      expect(legacy.item).toBeNull()
    }
    expect(scenario.sku.sku).toBeTruthy()
  })
})

async function runCompiledScenario(scenarioId: StaticProcurementFixtureScenarioId) {
  const scenario = getProcurementFixtureScenario(scenarioId)
  const runtime = createGenericWorkflowRuntime({
    manifest,
    dependencies: {
      capabilityProvider: {
        load: async ({ bindings }) => ({
          data: Object.fromEntries(
            bindings
              .filter((binding) => binding.access === "read")
              .map((binding) => [binding.alias, { snapshot: scenario.sourceSnapshotId }])
          ),
          sourceRefs: [],
        }),
      },
      agentJudgment: async () => ({
        proposal: { selection: scenario.sku },
        rationale: "Compiled shadow run selected the fixture product from bounded source data.",
        confidence: 0.86,
        warnings: [],
        context: {},
      }),
      reviewPersister: async () => ({
        workflowItemId: `item-${scenarioId}`,
        recommendationId: `recommendation-${scenarioId}`,
        evidenceId: `evidence-${scenarioId}`,
        actionDraftId: `draft-${scenarioId}`,
      }),
      actionHandler: async () => ({
        attemptId: `attempt-${scenarioId}`,
        status: "succeeded",
        output: { mode: "mock" },
      }),
    },
  })
  return runtime.start({
    companyId,
    actorId,
    workflowDefinitionId: "workflow-parity",
    workflowRunId: `run-${scenarioId}`,
    manifestDigest: manifest.manifestDigest,
    mode: "shadow",
    sandboxEnabled: false,
    trigger: { id: "synthetic-test", kind: "fixture", input: {} },
  })
}
