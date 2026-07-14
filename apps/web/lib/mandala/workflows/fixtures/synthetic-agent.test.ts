import { AIMessage } from "@langchain/core/messages"
import { describe, expect, it } from "vitest"
import { WorkflowMemoryStore } from "../engine"
import { runSyntheticProcurementAgentScenario } from "./procurement-workflow"
import { runSyntheticProcurementTestAgent } from "./synthetic-agent"
import {
  findSyntheticCandidates,
  generateSyntheticCommerceDataset,
} from "./synthetic-commerce"

describe("synthetic procurement test agent", () => {
  it("uses read-only discovery tools before submitting one safe candidate", async () => {
    const dataset = generateSyntheticCommerceDataset({
      seed: "agent-loop-test",
    })
    const selectedSku = findSyntheticCandidates(dataset, { limit: 1 })[0]!.sku
    const calls = [
      { name: "get_dataset_summary", args: {} },
      {
        name: "search_inventory",
        args: { limit: 10, minimumSpikeMultiplier: 0, sort: "stockout_risk" },
      },
      { name: "inspect_sku", args: { sku: selectedSku } },
      {
        name: "submit_recommendation",
        args: {
          sku: selectedSku,
          rationale:
            "Available inventory is low relative to reorder point and recent sales support human review.",
          riskFlags: [],
        },
      },
    ]
    let index = 0

    const agent = await runSyntheticProcurementTestAgent({
      dataset,
      dependencies: {
        invokeModel: async () => {
          const call = calls[index++]!
          return new AIMessage({
            content: "",
            tool_calls: [
              {
                id: `call-${index}`,
                name: call.name,
                args: call.args,
                type: "tool_call",
              },
            ],
          })
        },
      },
    })

    expect(agent.selection.sku).toBe(selectedSku)
    expect(agent.toolCalls.map((call) => call.name)).toEqual(
      calls.map((call) => call.name)
    )
    expect(agent.dataset.productCount).toBe(1_200)
    expect(agent.dataset.salesRecordCount).toBe(108_000)

    const workflow = runSyntheticProcurementAgentScenario({
      store: new WorkflowMemoryStore(),
      companyId: "company_fixture",
      actorUserId: "user_fixture",
      agent,
      now: new Date("2026-07-12T12:00:00.000Z"),
    })
    expect(workflow.run.status).toBe("waiting_for_approval")
    expect(workflow.item?.title).toContain("test-agent")
    expect(workflow.recommendation?.rationaleSummary).toContain(
      "analyzing 1200 synthetic products"
    )
    expect(workflow.draft?.payload).toMatchObject({ mode: "mock" })

    const nextSnapshot = runSyntheticProcurementAgentScenario({
      store: new WorkflowMemoryStore(),
      companyId: "company_fixture",
      actorUserId: "user_fixture",
      agent: {
        ...agent,
        dataset: {
          ...agent.dataset,
          seed: "next-snapshot",
          digest: "f".repeat(64),
        },
      },
      now: new Date("2026-07-12T12:05:00.000Z"),
    })
    expect(nextSnapshot.run.id).not.toBe(workflow.run.id)
  })

  it("refuses a model-selected SKU that was not inspected", async () => {
    const dataset = generateSyntheticCommerceDataset({
      seed: "unsafe-agent-test",
    })
    const selectedSku = findSyntheticCandidates(dataset, { limit: 1 })[0]!.sku
    let index = 0
    const calls = [
      { name: "get_dataset_summary", args: {} },
      { name: "search_inventory", args: {} },
      {
        name: "submit_recommendation",
        args: {
          sku: selectedSku,
          rationale:
            "This recommendation deliberately skips required inspection.",
          riskFlags: [],
        },
      },
    ]

    await expect(
      runSyntheticProcurementTestAgent({
        dataset,
        dependencies: {
          invokeModel: async () => {
            const call = calls[Math.min(index++, calls.length - 1)]!
            return new AIMessage({
              content: "",
              tool_calls: [
                {
                  id: `call-${index}`,
                  name: call.name,
                  args: call.args,
                  type: "tool_call",
                },
              ],
            })
          },
        },
      })
    ).rejects.toMatchObject({ errorClass: "tool_limit" })
  })
})
