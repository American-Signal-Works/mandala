import { describe, expect, it, vi } from "vitest"
import {
  contextRetrievalResultSchema,
  type ContextRetrievalProvider,
  type ContextRetrievalRequest,
} from "@workspace/control-plane"
import type { RuntimeContextRetrievalInput } from "../runtime/graph"
import {
  ServerContextRetriever,
  type ContextRetrievalRepository,
  type EligibleContextRecord,
} from "./retrieval-service"

const companyId = "10000000-0000-4000-8000-000000000001"
const canonicalRecordId = "20000000-0000-4000-8000-000000000001"
const sourceId = "30000000-0000-4000-8000-000000000001"
const stableCustomId = `ctx_${"a".repeat(64)}`
const contentHash = "b".repeat(64)
const observedAt = "2026-07-16T12:00:00.000Z"

describe("ServerContextRetriever", () => {
  it("returns explicit disabled provenance without calling a provider", async () => {
    const provider = providerFor()
    const retriever = new ServerContextRetriever(
      repositoryFor({ provider: "off", readiness: "disabled" }),
      provider,
      true
    )

    const result = await retriever.retrieve(runtimeInput(true))

    expect(result.provenance).toMatchObject({
      provider: "off",
      status: "disabled",
      fallbackReason: "context_off",
      scope: { companyId, workspaceScopeId: companyId },
    })
    expect(provider.retrieve).not.toHaveBeenCalled()
  })

  it("builds server-owned filters and revalidates every provider citation", async () => {
    const provider = providerFor()
    const repository = repositoryFor()
    repository.loadEligibleRecords = vi.fn(repository.loadEligibleRecords)
    const retriever = new ServerContextRetriever(
      repository,
      provider,
      true,
      () => new Date("2026-07-16T13:00:00.000Z")
    )

    const result = await retriever.retrieve(runtimeInput(true))

    expect(provider.retrieve).toHaveBeenCalledOnce()
    expect(repository.loadEligibleRecords).toHaveBeenCalledWith(
      expect.objectContaining({
        candidates: [expect.objectContaining({ entityValues: ["T-42"] })],
      })
    )
    const request = vi.mocked(provider.retrieve).mock.calls[0]![0]
    expect(request).toMatchObject({
      provider: "supermemory",
      scope: { companyId, workspaceScopeId: companyId },
      filters: {
        sourceKeys: ["helpdesk"],
        recordTypes: ["support_ticket"],
        canonicalRecordIds: [canonicalRecordId],
      },
      policyVersion: 3,
    })
    expect(request.query).toContain("support_review")
    expect(request.query).toContain("helpdesk")
    expect(request.query).toContain(canonicalRecordId)
    expect(request.query).not.toContain("T-42")
    expect(result.provenance).toMatchObject({
      status: "complete",
      resultCount: 1,
      fallbackReason: null,
    })
    expect(result.provenance.indexSnapshotMarker).toMatch(/^idx_[0-9a-f]{64}$/)
    expect(result.items[0]?.untrustedEvidence).toBe(true)
    expect(result.items[0]?.citation.providerDocumentId).toBe(
      "provider-document-1"
    )
  })

  it("drops provider evidence that no longer matches the local ledger", async () => {
    const provider = providerFor({ stableCustomId: `ctx_${"f".repeat(64)}` })
    const retriever = new ServerContextRetriever(
      repositoryFor(),
      provider,
      true
    )

    const result = await retriever.retrieve(runtimeInput(true))

    expect(result.items).toEqual([])
    expect(result.provenance).toMatchObject({
      status: "empty",
      resultCount: 0,
      fallbackReason: "policy_rejected",
    })
  })

  it("rejects stale canonical versions and policy hashes from provider metadata", async () => {
    const provider = providerFor({
      canonicalRecordVersion: "stale-version",
      policyHash: "e".repeat(64),
    })
    const retriever = new ServerContextRetriever(
      repositoryFor(),
      provider,
      true
    )

    const result = await retriever.retrieve(runtimeInput(true))

    expect(result.items).toEqual([])
    expect(result.provenance).toMatchObject({
      status: "empty",
      fallbackReason: "policy_rejected",
    })
  })

  it("keeps the provider unreachable behind the explicit enable gate", async () => {
    const provider = providerFor()
    const retriever = new ServerContextRetriever(
      repositoryFor(),
      provider,
      false
    )

    const result = await retriever.retrieve(runtimeInput(true))

    expect(provider.retrieve).not.toHaveBeenCalled()
    expect(result.provenance).toMatchObject({
      provider: "supermemory",
      status: "unavailable",
      fallbackReason: "provider_unavailable",
    })
  })

  it("never sends trigger payload values or external record IDs to the provider", async () => {
    const provider = providerFor()
    const retriever = new ServerContextRetriever(
      repositoryFor(),
      provider,
      true
    )
    const input = runtimeInput(false)

    await retriever.retrieve({
      ...input,
      run: {
        ...input.run,
        trigger: {
          ...input.run.trigger,
          input: {
            apiKey: "sk-should-never-leave-mandala",
            password: "private-password",
            customerEmail: "private@example.com",
          },
        },
      },
    })

    const request = vi.mocked(provider.retrieve).mock.calls[0]![0]
    expect(request.query).not.toMatch(
      /sk-should|private-password|private@example|T-42/
    )
    expect(request.query).toContain(canonicalRecordId)
  })

  it("fails closed before provider access when canonical IDs are missing", async () => {
    const provider = providerFor()
    const retriever = new ServerContextRetriever(
      repositoryFor(),
      provider,
      true
    )
    const input = runtimeInput(true)

    const result = await retriever.retrieve({
      ...input,
      canonical: { ...input.canonical, sourceRefs: [] },
    })

    expect(provider.retrieve).not.toHaveBeenCalled()
    expect(result.provenance).toMatchObject({
      status: "failed",
      fallbackReason: "policy_rejected",
    })
  })

  it("fails closed before provider access when local retention has expired", async () => {
    const provider = providerFor()
    const repository = repositoryFor()
    repository.loadEligibleRecords = async () => [
      {
        ...eligibleRecord(),
        retentionExpiresAt: "2026-07-16T12:59:59.000Z",
      },
    ]
    const retriever = new ServerContextRetriever(
      repository,
      provider,
      true,
      () => new Date("2026-07-16T13:00:00.000Z")
    )

    const result = await retriever.retrieve(runtimeInput(true))

    expect(provider.retrieve).not.toHaveBeenCalled()
    expect(result.provenance).toMatchObject({
      status: "failed",
      fallbackReason: "policy_rejected",
    })
  })

  it("uses identical query, filters, snapshot, and citations in both Sandbox states", async () => {
    const provider = providerFor()
    const retriever = new ServerContextRetriever(
      repositoryFor(),
      provider,
      true
    )

    const sandbox = await retriever.retrieve(runtimeInput(true))
    const normal = await retriever.retrieve(runtimeInput(false))

    expect(normal.provenance.queryHash).toBe(sandbox.provenance.queryHash)
    expect(normal.provenance.filterHash).toBe(sandbox.provenance.filterHash)
    expect(normal.provenance.indexSnapshotMarker).toBe(
      sandbox.provenance.indexSnapshotMarker
    )
    expect(normal.provenance.citations).toEqual(sandbox.provenance.citations)
    expect(normal.items).toEqual(sandbox.items)
  })
})

function repositoryFor(
  settings: {
    provider: "off" | "supermemory"
    readiness: "disabled" | "ready"
  } = {
    provider: "supermemory",
    readiness: "ready",
  }
): ContextRetrievalRepository {
  return {
    readSettings: async () => ({
      company_id: companyId,
      provider: settings.provider,
      readiness: settings.readiness,
    }),
    loadEligibleRecords: async () => [eligibleRecord()],
  }
}

function eligibleRecord(): EligibleContextRecord {
  return {
    canonicalRecordId,
    sourceId,
    sourceKey: "helpdesk",
    recordType: "support_ticket",
    observedAt,
    canonicalVersion: "c".repeat(64),
    policyVersion: 3,
    policyHash: "d".repeat(64),
    contentHash,
    stableCustomId,
    providerDocumentId: "provider-document-1",
    retentionExpiresAt: "2026-08-16T12:00:00.000Z",
  }
}

function providerFor(overrides?: {
  stableCustomId?: string
  canonicalRecordVersion?: string
  policyHash?: string
}): ContextRetrievalProvider & { retrieve: ReturnType<typeof vi.fn> } {
  const retrieve = vi.fn(async (request: ContextRetrievalRequest) => {
    const citation = {
      providerReference: "provider-search-result-1",
      providerDocumentId: null,
      stableCustomId: overrides?.stableCustomId ?? stableCustomId,
      canonicalRecordId,
      canonicalRecordVersion:
        overrides?.canonicalRecordVersion ?? "c".repeat(64),
      sourceId,
      sourceKey: "helpdesk",
      recordType: "support_ticket",
      rank: 1,
      score: 0.91,
      providerUpdatedAt: "2026-07-16T12:30:00.000Z",
      sourceObservedAt: observedAt,
      freshness: "fresh" as const,
      contentHash,
      policyHash: overrides?.policyHash ?? "d".repeat(64),
    }
    const excerpt = "Ticket T-42 had a similar approved resolution."
    return contextRetrievalResultSchema.parse({
      provenance: {
        provider: "supermemory",
        status: "complete",
        requestId: request.requestId,
        scope: request.scope,
        queryHash: request.queryHash,
        filterHash: request.filterHash,
        policyVersion: request.policyVersion,
        bounds: request.bounds,
        resultCount: 1,
        characterCount: excerpt.length,
        tokenEstimate: Math.ceil(excerpt.length / 4),
        latencyMs: 14,
        fallbackReason: null,
        indexSnapshotMarker: "provider-snapshot",
        citations: [citation],
      },
      items: [{ citation, excerpt, untrustedEvidence: true }],
    })
  })
  return {
    provider: "supermemory",
    retrieve,
    health: async (scope) => ({
      provider: "supermemory",
      scope,
      status: "healthy",
      checkedAt: "2026-07-16T13:00:00.000Z",
      detailCode: "provider_ready",
    }),
  }
}

function runtimeInput(sandboxEnabled: boolean): RuntimeContextRetrievalInput {
  return {
    run: {
      companyId,
      workflowDefinitionId: "40000000-0000-4000-8000-000000000001",
      workflowRunId: "50000000-0000-4000-8000-000000000001",
      manifestDigest: "manifest-digest",
      mode: "mock",
      sandboxEnabled,
      operatingMode: sandboxEnabled ? "sandbox" : "live",
      trigger: {
        id: "high-severity-ticket",
        kind: "webhook",
        input: { entityValue: "T-42", severity: 5 },
      },
    },
    workflow: {
      identityId: "support.review",
      workflowType: "support_review",
      sourceDigest: "source-digest",
    },
    canonical: {
      data: { tickets: { ticket_id: "T-42", severity: 5 } },
      sourceRefs: [
        {
          capabilityAlias: "tickets",
          connectorId: "mandala.workspace-data",
          observedAt,
          reference: {
            canonicalRecordId,
            sourceId,
            sourceKey: "helpdesk",
            recordType: "support_ticket",
            externalId: "T-42",
            entityValues: ["T-42"],
          },
        },
      ],
    },
  }
}
