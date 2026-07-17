import { describe, expect, it } from "vitest"
import {
  ContextProviderNotOperationalError,
  OffContextProvider,
  resolveContextProvider,
} from "./off-provider"

const companyId = "20000000-0000-4000-8000-000000000001"
const requestId = "30000000-0000-4000-8000-000000000001"
const timestamp = "2026-07-16T20:00:00.000Z"

describe("OffContextProvider", () => {
  it("returns immutable, traceable empty retrieval without provider work", async () => {
    const provider = new OffContextProvider(() => new Date(timestamp))
    const result = await provider.retrieve({
      requestId,
      provider: "off",
      scope: { companyId, workspaceScopeId: companyId },
      query: "bounded evidence",
      queryHash: "a".repeat(64),
      filterHash: "b".repeat(64),
      policyVersion: 1,
      filters: {
        sourceKeys: ["erpnext"],
        recordTypes: ["purchase_order"],
        canonicalRecordIds: [requestId],
      },
      bounds: {
        maximumResults: 5,
        maximumCharacters: 12_000,
        maximumTokens: 4_000,
        maximumAgeHours: 8_760,
        minimumConfidence: 0,
        timeoutMs: 2_000,
      },
    })

    expect(result).toMatchObject({
      provenance: {
        provider: "off",
        status: "disabled",
        resultCount: 0,
        latencyMs: 0,
        fallbackReason: "context_off",
      },
      items: [],
    })
    expect(Object.isFrozen(result)).toBe(true)
    expect(Object.isFrozen(result.provenance)).toBe(true)
  })

  it("reports disabled health and rejects unavailable providers", async () => {
    const provider = new OffContextProvider(() => new Date(timestamp))
    await expect(
      provider.health({ companyId, workspaceScopeId: companyId })
    ).resolves.toMatchObject({
      provider: "off",
      status: "disabled",
      checkedAt: timestamp,
    })
    expect(resolveContextProvider("off")).toBeInstanceOf(OffContextProvider)
    expect(() => resolveContextProvider("supermemory")).toThrow(
      ContextProviderNotOperationalError
    )
  })
})
