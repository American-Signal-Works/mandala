import type { BaseMessage } from "@langchain/core/messages"
import type { WorkItemDetail } from "@workspace/control-plane"
import { describe, expect, it, vi } from "vitest"
import {
  WorkItemQuestionUnavailableError,
  answerWorkItemQuestion,
} from "./work-item-question"

describe("selected work-item questions", () => {
  it("grounds a read-only answer in the selected item without exposing audit history", async () => {
    let capturedMessages: BaseMessage[] = []
    const invokeModel = vi.fn(async (messages: BaseMessage[]) => {
      capturedMessages = messages
      return "648 units is about 41 days of recent demand. Check storage capacity and supplier minimums before approving it."
    })
    const result = await answerWorkItemQuestion(
      {
        detail: workItemDetail(),
        question: "Is 648 a good quantity for this?",
      },
      {
        invokeModel,
        now: vi.fn().mockReturnValueOnce(100).mockReturnValue(135),
      }
    )

    expect(result).toEqual({
      answer:
        "648 units is about 41 days of recent demand. Check storage capacity and supplier minimums before approving it.",
      model: "injected-test-model",
      durationMs: 35,
      trace: null,
    })
    const prompt = capturedMessages
      .map((message) => String(message.content))
      .join("\n")
    expect(prompt).toContain("Is 648 a good quantity for this?")
    expect(prompt).toContain('"recent30DaySales":478')
    expect(prompt).toContain('"leadTimeDays":26')
    expect(prompt).toContain('"quantity":648')
    expect(prompt).not.toContain("audit-secret")
    expect(prompt).not.toContain("40000000-0000-4000-8000-000000000001")
  })

  it("rejects an empty model answer", async () => {
    await expect(
      answerWorkItemQuestion(
        {
          detail: workItemDetail(),
          question: "Why this quantity?",
        },
        { invokeModel: async () => "   " }
      )
    ).rejects.toBeInstanceOf(WorkItemQuestionUnavailableError)
  })
})

function workItemDetail(): WorkItemDetail {
  const createdAt = "2026-07-13T00:42:30.675Z"
  const itemId = "40000000-0000-4000-8000-000000000001"
  const runId = "30000000-0000-4000-8000-000000000001"
  return {
    item: {
      id: itemId,
      workflowRunId: runId,
      itemType: "procurement_reorder_review",
      title: "Review test-agent reorder · Cold Brew Bottle 639",
      status: "active",
      priority: 50,
      resolutionState: {},
      createdAt,
      updatedAt: createdAt,
    },
    contextPacket: {
      id: "60000000-0000-4000-8000-000000000001",
      sources: [{ source: "fixture_inventory" }],
      facts: {
        onHandInventory: 4,
        reorderPoint: 300,
        inboundUnits: 0,
        recent30DaySales: 478,
        recent90DaySales: 1466,
        leadTimeDays: 26,
      },
      memoryRefs: [],
      freshnessState: "fresh",
      warnings: [],
      createdAt,
    },
    recommendation: {
      id: "90000000-0000-4000-8000-000000000001",
      status: "ready_for_review",
      rationaleSummary: "Order 648 units for human review.",
      warningState: "pass",
      warnings: [],
      confidence: 0.82,
      freshnessState: "fresh",
      output: { recommendedQuantity: 648 },
      createdAt,
    },
    evidence: {
      id: "80000000-0000-4000-8000-000000000001",
      sourceRefs: [{ source: "fixture_inventory" }],
      assumptions: ["Synthetic fixture data."],
      warnings: [],
      evidence: [],
      createdAt,
    },
    draft: {
      id: "50000000-0000-4000-8000-000000000001",
      workflowRunId: runId,
      workflowItemId: itemId,
      actionType: "execute_mock_purchase_order",
      status: "pending_review",
      payload: { items: [{ sku: "SYN-0639", quantity: 648 }] },
      editPolicy: { editable: true },
      updatedAt: createdAt,
    },
    decision: null,
    attempt: null,
    auditEvents: [
      {
        id: "70000000-0000-4000-8000-000000000001",
        eventType: "recommendation_created",
        summary: "audit-secret",
        payload: {},
        trace: {},
        createdAt,
      },
    ],
  }
}
