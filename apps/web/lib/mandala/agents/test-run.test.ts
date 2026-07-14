import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { beforeAll, describe, expect, it, vi } from "vitest"
import { MemorySaver } from "@langchain/langgraph"
import { syntheticCompilerCapabilities } from "../skills/catalog-compiler"
import { compileAgentSkill } from "../skills/compiler"
import type { CompiledAgentManifest } from "../skills/compiler"
import type {
  SyntheticCommerceProduct,
  WorkflowFixtureRunResult,
} from "../workflows"
import { createWorkflowFixturePersistencePayload } from "../workflows/persistence"
import { runSyntheticAgentTest } from "./test-run"

const companyId = "20000000-0000-4000-8000-000000000001"
const agentId = "a0000000-0000-4000-8000-000000000001"
const userId = "10000000-0000-4000-8000-000000000001"
const snapshotId = "b0000000-0000-4000-8000-000000000001"
const persistedRunId = "30000000-0000-4000-8000-000000000001"
const persistedItemId = "33000000-0000-4000-8000-000000000001"

let procurementManifest: CompiledAgentManifest
let salesSpikeManifest: CompiledAgentManifest

beforeAll(async () => {
  procurementManifest = await compileSkill("procurement-reorder")
  salesSpikeManifest = await compileSkill("sales-spike-investigator")
})

describe("synthetic compiled agent test runner", () => {
  it("runs a stored action skill through the generic runtime with 1,200 products", async () => {
    let captured: WorkflowFixtureRunResult | null = null
    const result = await runFor(procurementManifest, (run) => {
      captured = run
    })

    expect(result).toMatchObject({
      agentId,
      workflowRunId: persistedRunId,
      itemId: persistedItemId,
      status: "waiting_for_approval",
      dataset: {
        businessName: "Mandala Bean Co.",
        productCount: 1_200,
        salesRecordCount: 108_000,
      },
      result: {
        execution: "deterministic",
        selectedSku: expect.stringMatching(/^SYN-/),
      },
    })
    expect(captured).not.toBeNull()
    expect(captured!.definition.id).toBe(agentId)
    expect(captured!.run.workflowDefinitionId).toBe(agentId)
    expect(captured!.event.workflowDefinitionId).toBe(agentId)
    expect(captured!.item?.itemType).toBe("procurement_reorder_review")
    expect(captured!.draft).not.toBeNull()
    expect(
      Buffer.byteLength(
        JSON.stringify(createWorkflowFixturePersistencePayload(captured!))
      )
    ).toBeLessThan(2 * 1_024 * 1_024)
  })

  it("runs a no-action sales investigation from its manifest without an adapter", async () => {
    let captured: WorkflowFixtureRunResult | null = null
    const result = await runFor(salesSpikeManifest, (run) => {
      captured = run
    })

    expect(result.status).toBe("waiting_for_approval")
    expect(result.dataset).toMatchObject({
      productCount: 1_200,
      salesSpikeCount: expect.any(Number),
    })
    expect(captured!.item?.itemType).toBe("sales_spike_review")
    expect(captured!.recommendation?.output).toMatchObject({
      recentSpikeMultiplier: expect.any(Number),
    })
    expect(captured!.draft).toBeNull()
  })

  it("uses the same manifest-driven model harness for a no-action skill", async () => {
    const runModelAgent = vi.fn(async ({ dataset, manifest }) => {
      const selectedProduct = dataset.products.find(
        (product: SyntheticCommerceProduct) =>
          product.recentSpikeMultiplier >= 1.2
      )!
      expect(manifest.manifestDigest).toBe(salesSpikeManifest.manifestDigest)
      return {
        model: "injected-general-model",
        trace: null,
        toolCalls: [
          { name: "get_dataset_summary", args: {} },
          {
            name: "search_synthetic_products",
            args: { sort: "sales_spike" },
          },
          { name: "inspect_sku", args: { sku: selectedProduct.sku } },
          { name: "submit_recommendation", args: { sku: selectedProduct.sku } },
        ],
        selection: {
          sku: selectedProduct.sku,
          rationale:
            "Recent synthetic sales materially exceed the longer baseline and warrant human investigation.",
          riskFlags: [],
        },
        selectedProduct,
        dataset: dataset.summary,
      }
    })

    const result = await runFor(salesSpikeManifest, () => undefined, {
      modelEnabled: true,
      runModelAgent,
    })

    expect(runModelAgent).toHaveBeenCalledOnce()
    expect(result.result).toMatchObject({
      execution: "model",
      model: "injected-general-model",
    })
  })
})

async function runFor(
  manifest: CompiledAgentManifest,
  capture: (result: WorkflowFixtureRunResult) => void,
  options: {
    modelEnabled?: boolean
    runModelAgent?: NonNullable<
      NonNullable<
        Parameters<typeof runSyntheticAgentTest>[0]["dependencies"]
      >["runModelAgent"]
    >
  } = {}
) {
  return runSyntheticAgentTest({
    supabase: {} as never,
    agentId,
    request: { companyId, seed: "mandala-bean-test" },
    actorUserId: userId,
    clientSurface: "cli",
    dependencies: {
      now: () => new Date("2026-07-13T12:00:00.000Z"),
      loadWorkflow: vi.fn(async () => ({
        id: agentId,
        companyId,
        skillMarkdown: "# Test skill",
        manifest,
      })),
      createBindingSnapshot: vi.fn(async () => snapshotId),
      loadCheckpointer: vi.fn(async () => new MemorySaver()),
      modelEnabled: options.modelEnabled ?? false,
      ...(options.runModelAgent
        ? { runModelAgent: options.runModelAgent }
        : {}),
      persist: vi.fn(async ({ result }) => {
        capture(result)
        return {
          workflowRunId: persistedRunId,
          itemId: persistedItemId,
          draftId: result.draft?.id ?? null,
          duplicate: false,
        }
      }),
    },
  })
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
