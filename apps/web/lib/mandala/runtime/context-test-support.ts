import type { ContextRetrievalResult } from "@workspace/control-plane"
import type { RuntimeContextRetriever } from "./graph"

export const TEST_CONTEXT_COMPANY_ID = "00000000-0000-4000-8000-000000000001"
const requestId = "00000000-0000-4000-8000-000000000002"
const hash = "0".repeat(64)

export function testContextResult(input?: {
  status?: ContextRetrievalResult["provenance"]["status"]
  fallbackReason?: ContextRetrievalResult["provenance"]["fallbackReason"]
  scopeId?: string
}): ContextRetrievalResult {
  const status = input?.status ?? "disabled"
  const scopeId = input?.scopeId ?? TEST_CONTEXT_COMPANY_ID
  return {
    provenance: {
      provider: status === "disabled" ? "off" : "supermemory",
      status,
      requestId,
      scope: { companyId: scopeId, workspaceScopeId: scopeId },
      queryHash: hash,
      filterHash: hash,
      policyVersion: 1,
      bounds: {
        maximumResults: 5,
        maximumCharacters: 12_000,
        maximumTokens: 4_000,
        maximumAgeHours: 8_760,
        minimumConfidence: 0,
        timeoutMs: 2_000,
      },
      resultCount: 0,
      characterCount: 0,
      tokenEstimate: 0,
      latencyMs: 0,
      fallbackReason:
        input?.fallbackReason ?? (status === "disabled" ? "context_off" : null),
      indexSnapshotMarker: null,
      citations: [],
    },
    items: [],
  }
}

export function testCompleteContextResult(
  excerpt = "A bounded operational fact."
): ContextRetrievalResult {
  const citation = {
    providerReference: "provider-document-1",
    providerDocumentId: "provider-document-1",
    stableCustomId: "stable-document-1",
    canonicalRecordId: "00000000-0000-4000-8000-000000000003",
    canonicalRecordVersion: "version-1",
    sourceId: "00000000-0000-4000-8000-000000000004",
    sourceKey: "inventory",
    recordType: "inventory_item",
    rank: 1,
    score: 0.92,
    providerUpdatedAt: "2026-07-16T12:00:00.000Z",
    sourceObservedAt: "2026-07-16T12:00:00.000Z",
    freshness: "fresh" as const,
    contentHash: "1".repeat(64),
    policyHash: "2".repeat(64),
  }
  return {
    provenance: {
      ...testContextResult({ status: "empty" }).provenance,
      provider: "supermemory",
      status: "complete",
      resultCount: 1,
      characterCount: excerpt.length,
      tokenEstimate: Math.ceil(excerpt.length / 4),
      latencyMs: 12,
      fallbackReason: null,
      indexSnapshotMarker: "snapshot-1",
      citations: [citation],
    },
    items: [{ citation, excerpt, untrustedEvidence: true }],
  }
}

export function testContextRetriever(
  result: ContextRetrievalResult = testContextResult()
): RuntimeContextRetriever {
  return { retrieve: async () => result }
}
