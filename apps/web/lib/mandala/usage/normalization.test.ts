import { AIMessage } from "@langchain/core/messages"
import { describe, expect, it } from "vitest"
import { normalizeProviderUsage, splitProviderModel } from "./normalization"

describe("provider usage normalization", () => {
  it("keeps only numeric provider usage fields", () => {
    const measuredAt = new Date("2026-07-15T12:00:00.000Z")
    const measurement = normalizeProviderUsage({
      providerModel: "openai/gpt-5.4-mini",
      measuredAt,
      response: new AIMessage({
        content: "private model output",
        usage_metadata: {
          input_tokens: 120,
          output_tokens: 30,
          total_tokens: 150,
          input_token_details: { cache_read: 40 },
          output_token_details: { reasoning: 10 },
        },
      }),
    })

    expect(measurement).toEqual({
      provider: "openai",
      model: "gpt-5.4-mini",
      measuredAt: measuredAt.toISOString(),
      completeness: "complete",
      metrics: {
        input_tokens: 120,
        output_tokens: 30,
        total_tokens: 150,
        cached_input_tokens: 40,
        reasoning_output_tokens: 10,
        requests: 1,
      },
    })
    expect(JSON.stringify(measurement)).not.toContain("private model output")
  })

  it("marks absent and incomplete metadata explicitly", () => {
    expect(
      normalizeProviderUsage({ providerModel: "openai/gpt-5.4-mini" })
    ).toMatchObject({ completeness: "unavailable", metrics: { requests: 1 } })
    expect(
      normalizeProviderUsage({
        providerModel: "openai/gpt-5.4-mini",
        response: new AIMessage({
          content: "",
          usage_metadata: {
            input_tokens: 12,
            output_tokens: Number.NaN,
            total_tokens: Number.NaN,
          },
        }),
      })
    ).toMatchObject({
      completeness: "partial",
      metrics: { input_tokens: 12, requests: 1 },
    })
  })

  it("requires explicit provider/model attribution", () => {
    expect(splitProviderModel("anthropic/claude-sonnet-4.5")).toEqual({
      provider: "anthropic",
      model: "claude-sonnet-4.5",
    })
    expect(() => splitProviderModel("unknown-model")).toThrow("provider/model")
  })
})
