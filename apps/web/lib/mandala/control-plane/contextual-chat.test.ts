import type { ControlOutcome } from "@workspace/control-plane"
import { describe, expect, it, vi } from "vitest"
import { routeContextualChat } from "./contextual-chat"

const companyId = "10000000-0000-4000-8000-000000000001"
const itemId = "20000000-0000-4000-8000-000000000001"
const conversationId = "30000000-0000-4000-8000-000000000001"

describe("contextual chat routing", () => {
  it("answers a selected-item question without proposing a mutation", async () => {
    const parseCommand = vi.fn<() => Promise<ControlOutcome>>()
    const result = await routeContextualChat(
      request("Why is this recommendation blocked?"),
      {
        getReviewVersion: async () => "v2",
        answerQuestion: async () => "The source data is stale.",
        parseCommand,
      }
    )

    expect(result).toMatchObject({
      route: "question",
      message: "The source data is stale.",
      reviewVersion: "v2",
      command: null,
      mutated: false,
    })
    expect(parseCommand).not.toHaveBeenCalled()
  })

  it("gives explicit action language precedence over question grammar", async () => {
    const parseCommand = vi.fn(async (phrase: string): Promise<ControlOutcome> => {
      expect(phrase).toContain(itemId)
      return {
        status: "resolved",
        intent: {
          kind: "record_decision",
          companyId,
          itemId,
          decision: "approve",
          patches: [],
          warningsAcknowledged: false,
          risk: "state_change",
        },
        confirmationRequired: true,
      }
    })
    const result = await routeContextualChat(
      request("Can you approve it?"),
      {
        getReviewVersion: async () => "v2",
        answerQuestion: vi.fn(),
        parseCommand,
      }
    )

    expect(result).toMatchObject({
      route: "command",
      confirmationRequired: true,
      mutated: false,
    })
  })

  it("blocks stale selected-item context before parsing", async () => {
    const parseCommand = vi.fn<() => Promise<ControlOutcome>>()
    const result = await routeContextualChat(
      { ...request("Approve it"), expectedReviewVersion: "v1" },
      {
        getReviewVersion: async () => "v2",
        answerQuestion: vi.fn(),
        parseCommand,
      }
    )

    expect(result.route).toBe("blocked")
    expect(result.message).toContain("changed")
    expect(parseCommand).not.toHaveBeenCalled()
  })

  it("does not turn a negated action into a canonical command", async () => {
    const parseCommand = vi.fn(async (phrase: string): Promise<ControlOutcome> => {
      expect(phrase).toContain("do not approve")
      return {
        status: "blocked",
        reasonCode: "unsupported_command",
        reasons: ["No action was proposed."],
        confirmationRequired: false,
      }
    })
    const result = await routeContextualChat(
      request("Please do not approve it"),
      {
        getReviewVersion: async () => "v2",
        answerQuestion: vi.fn(),
        parseCommand,
      }
    )

    expect(result).toMatchObject({ route: "blocked", mutated: false })
  })
})

function request(input: string) {
  return {
    companyId,
    input,
    selectedItemId: itemId,
    expectedReviewVersion: null,
    conversationId,
  }
}
