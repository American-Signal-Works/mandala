import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import { compileAgentSkill } from "../skills/compiler"
import { syntheticCompilerCapabilities } from "../skills/catalog-compiler"
import {
  generateSyntheticCommerceDataset,
  getProcurementFixtureScenario,
} from "../workflows"
import { createGenericWorkflowRuntime } from "./graph"

const loadSkill = (id: string) =>
  readFile(resolve(process.cwd(), "../../skills", id, "SKILL.md"), "utf8")

describe("real Skill v1 files on the generic runtime", () => {
  it("preserves the clean procurement quantity through compiled rules", async () => {
    const source = await loadSkill("procurement-reorder")
    const compiled = compileAgentSkill({
      source,
      capabilities: syntheticCompilerCapabilities(),
    })
    expect(compiled.ok).toBe(true)
    if (!compiled.ok) return

    const scenario = getProcurementFixtureScenario("clean_reorder")
    const runtime = createGenericWorkflowRuntime({
      manifest: compiled.manifest,
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
          rationale: "Fresh inventory is below its reorder point with no duplicate open order.",
          confidence: 0.86,
          warnings: [],
          context: {},
        }),
        reviewPersister: async () => ({
          workflowItemId: "item-clean",
          recommendationId: "recommendation-clean",
          evidenceId: "evidence-clean",
          actionDraftId: "draft-clean",
        }),
        actionHandler: async () => ({
          attemptId: "attempt-clean",
          status: "succeeded",
          output: { mode: "mock" },
        }),
      },
    })

    const started = await runtime.start({
      companyId: "company-clean",
      actorId: "user-clean",
      workflowDefinitionId: "workflow-clean",
      workflowRunId: "run-clean",
      manifestDigest: compiled.manifest.manifestDigest,
      mode: "mock",
      sandboxEnabled: false,
      trigger: { id: "synthetic-test", kind: "fixture", input: {} },
    })

    expect(started.output.status).toBe("waiting_for_approval")
    expect(started.output.review?.recommendation.output).toMatchObject({
      sku: scenario.sku.sku,
      availableInventory: 18,
      recommendedQuantity: 144,
    })
    expect(started.output.review?.draft?.payload).toMatchObject({
      lines: [{ sku: scenario.sku.sku, quantity: 144 }],
      mode: "mock",
    })
  })

  it("runs Sales Spike Investigator from only its SKILL.md", async () => {
    const source = await loadSkill("sales-spike-investigator")
    const compiled = compileAgentSkill({
      source,
      capabilities: syntheticCompilerCapabilities(),
    })
    expect(compiled.ok).toBe(true)
    if (!compiled.ok) return

    const dataset = generateSyntheticCommerceDataset({
      seed: "skill-only-sales-spike",
      generatedAt: new Date("2026-07-13T12:00:00.000Z"),
    })
    const selected = dataset.products.find(
      (product) => product.salesSpike && product.recentSpikeMultiplier >= 1.2
    )
    expect(selected).toBeTruthy()
    if (!selected) return

    const runtime = createGenericWorkflowRuntime({
      manifest: compiled.manifest,
      dependencies: {
        capabilityProvider: {
          load: async ({ bindings }) => ({
            data: Object.fromEntries(
              bindings.map((binding) => [binding.alias, { dataset: dataset.summary.digest }])
            ),
            sourceRefs: [],
          }),
        },
        agentJudgment: async () => ({
          proposal: { selection: selected },
          rationale: "A recent promotion aligns with the daily sales increase, but durability is uncertain.",
          confidence: 0.75,
          warnings: [],
          context: {},
        }),
        reviewPersister: async () => ({
          workflowItemId: "item-spike",
          recommendationId: "recommendation-spike",
          evidenceId: "evidence-spike",
          actionDraftId: null,
        }),
      },
    })

    const result = await runtime.start({
      companyId: "company-spike",
      actorId: "user-spike",
      workflowDefinitionId: "workflow-spike",
      workflowRunId: "run-spike",
      manifestDigest: compiled.manifest.manifestDigest,
      mode: "mock",
      sandboxEnabled: false,
      trigger: { id: "synthetic-test", kind: "fixture", input: {} },
    })

    expect(result.output.status).toBe("completed")
    expect(result.output.review).toMatchObject({
      item: { type: "sales_spike_review" },
      recommendation: {
        output: {
          sku: selected.sku,
          recentSpikeMultiplier: selected.recentSpikeMultiplier,
        },
      },
      draft: null,
    })
  })
})
