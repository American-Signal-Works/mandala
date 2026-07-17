import { describe, expect, it } from "vitest"
import {
  sanitizeLegacyItemDetail,
  sanitizePublicProjection,
} from "./public-projection"

describe("public control-plane projection", () => {
  it("removes nested and case-variant private fields", () => {
    expect(
      sanitizePublicProjection({
        safe: "visible",
        Memory_Refs: [{ id: "private" }],
        nested: {
          PROMPT: "private",
          rawTrace: { internal: true },
          connectorCredentials: { password: "private" },
          approved: true,
        },
      })
    ).toEqual({ safe: "visible", nested: { approved: true } })
  })

  it("redacts bearer and token text inside otherwise approved summaries", () => {
    expect(
      sanitizePublicProjection({
        summary: "Provider failed with Bearer abc.def and api_token=top-secret",
      })
    ).toEqual({ summary: "Provider failed with [redacted] and [redacted]" })
  })

  it("redacts high-risk secret values even under generic keys", () => {
    const projected = sanitizePublicProjection({
      messages: [
        "provider returned sk-abcdefgh12345678",
        "session eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature12345678",
        "webhook_secret=whsec_examplevalue",
        "-----BEGIN PRIVATE KEY-----\nprivate-material\n-----END PRIVATE KEY-----",
      ],
    })

    expect(JSON.stringify(projected)).not.toMatch(
      /sk-abcdefgh|eyJhbGci|whsec_example|private-material/
    )
  })

  it("preserves the legacy detail shape with empty memory refs and traces", () => {
    expect(
      sanitizeLegacyItemDetail({
        contextPacket: {
          facts: { SKU: "123", apiToken: "private" },
          memoryRefs: [{ id: "private" }],
        },
        auditEvents: [
          {
            payload: { Safe: true, Hidden_Reasoning: "private" },
            trace: { langsmith: "private" },
          },
        ],
      })
    ).toEqual({
      contextPacket: { facts: { SKU: "123" }, memoryRefs: [] },
      auditEvents: [{ payload: { Safe: true }, trace: {} }],
    })
  })

  it("preserves bounded operational citations while removing private fields", () => {
    const projected = sanitizeLegacyItemDetail({
      contextPacket: {
        memoryRefs: [{ id: "private" }],
        operationalContext: {
          provider: "supermemory",
          status: "complete",
          tokenEstimate: 13,
          citations: [
            {
              providerReference: "provider-search-result-1",
              canonicalRecordId: "22000000-0000-4000-8000-000000000001",
              rawTrace: "private",
            },
          ],
          apiToken: "private",
        },
      },
    })

    expect(projected).toEqual({
      contextPacket: {
        memoryRefs: [],
        operationalContext: {
          provider: "supermemory",
          status: "complete",
          tokenEstimate: 13,
          citations: [
            {
              providerReference: "provider-search-result-1",
              canonicalRecordId: "22000000-0000-4000-8000-000000000001",
            },
          ],
        },
      },
    })
  })
})
