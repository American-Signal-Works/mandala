import { describe, expect, it } from "vitest"
import {
  contextIndexLeaseSchema,
  contextIndexOutboxEventSchema,
  contextIndexWorkerSummarySchema,
  contextIndexingPolicySchema,
  contextPacketProvenanceSchema,
  contextProviderSchema,
  contextRetrievalRequestSchema,
  contextRetrievalResultSchema,
  contextTenantScopeSchema,
  contextWorkspaceConfigurationRequestSchema,
  contextWorkspaceSettingsSchema,
  contextWorkspaceStatusSchema,
} from "../src/context.js"

const companyId = "20000000-0000-4000-8000-000000000001"
const requestId = "30000000-0000-4000-8000-000000000001"
const timestamp = "2026-07-16T20:00:00.000Z"

describe("Context control-plane contracts", () => {
  it("strictly validates bounded index outbox, lease, and summary contracts", () => {
    const event = {
      id: requestId,
      companyId,
      provider: "supermemory",
      operation: "add",
      canonicalRecordId: "50000000-0000-4000-8000-000000000001",
      canonicalRecordVersion: "version-1",
      stableCustomId: `ctx_${"a".repeat(64)}`,
      providerDocumentId: null,
      policyVersion: 1,
      policyHash: "b".repeat(64),
      expectedContentHash: "c".repeat(64),
      attempt: 1,
      maxAttempts: 5,
    }
    expect(contextIndexOutboxEventSchema.parse(event)).toMatchObject(event)
    expect(
      contextIndexOutboxEventSchema.safeParse({
        ...event,
        provider: "off",
      }).success
    ).toBe(false)
    expect(
      contextIndexOutboxEventSchema.safeParse({
        ...event,
        operation: "replace",
      }).success
    ).toBe(false)
    expect(
      contextIndexLeaseSchema.safeParse({
        leaseId: "70000000-0000-4000-8000-000000000001",
        leasedUntil: timestamp,
        event,
        projectionSource: null,
      }).success
    ).toBe(false)
    expect(
      contextIndexWorkerSummarySchema.safeParse({
        claimed: 1,
        completed: 0,
        retryScheduled: 0,
        deadLettered: 0,
        reconciliationRequired: 0,
        leaseUnresolved: 0,
        results: [],
      }).success
    ).toBe(false)
  })

  it("allows only the approved provider names", () => {
    expect(contextProviderSchema.options).toEqual(["off", "supermemory"])
    expect(contextProviderSchema.safeParse("custom").success).toBe(false)
  })

  it("requires company and workspace scope to be the same canonical tenant", () => {
    expect(
      contextTenantScopeSchema.safeParse({
        companyId,
        workspaceScopeId: companyId,
      }).success
    ).toBe(true)
    expect(
      contextTenantScopeSchema.safeParse({
        companyId,
        workspaceScopeId: "20000000-0000-4000-8000-000000000002",
      }).success
    ).toBe(false)
  })

  it("defaults workspace settings to Context Off and Sandbox On", () => {
    expect(
      contextWorkspaceSettingsSchema.parse({
        companyId,
        workspaceScopeId: companyId,
        updatedBy: requestId,
        updatedAt: timestamp,
      })
    ).toMatchObject({
      provider: "off",
      sandboxEnabled: true,
      readiness: "disabled",
      configurationVersion: 1,
    })
    expect(
      contextWorkspaceSettingsSchema.safeParse({
        companyId,
        workspaceScopeId: companyId,
        provider: "supermemory",
        sandboxEnabled: true,
        readiness: "disabled",
        configurationVersion: 1,
        updatedBy: requestId,
        updatedAt: timestamp,
      }).success
    ).toBe(false)
    expect(
      contextWorkspaceSettingsSchema.safeParse({
        companyId,
        workspaceScopeId: companyId,
        provider: "off",
        sandboxEnabled: true,
        readiness: "ready",
        configurationVersion: 1,
        updatedBy: requestId,
        updatedAt: timestamp,
      }).success
    ).toBe(false)
    expect(
      contextWorkspaceSettingsSchema.safeParse({
        companyId,
        workspaceScopeId: companyId,
        updatedBy: requestId,
        updatedAt: timestamp,
        providerCredential: "must-not-be-accepted",
      }).success
    ).toBe(false)
  })

  it("strictly bounds public workspace configuration mutations", () => {
    expect(
      contextWorkspaceConfigurationRequestSchema.parse({
        companyId,
        provider: "supermemory",
        expectedConfigurationVersion: 1,
        reason: "Prepare the provider while keeping indexing disabled.",
      })
    ).toMatchObject({ provider: "supermemory" })
    expect(
      contextWorkspaceConfigurationRequestSchema.safeParse({
        companyId,
        expectedConfigurationVersion: 1,
        reason: "No setting was supplied.",
      }).success
    ).toBe(false)
    expect(
      contextWorkspaceConfigurationRequestSchema.safeParse({
        companyId,
        provider: "supermemory",
        readiness: "ready",
        expectedConfigurationVersion: 1,
        reason: "A client cannot declare readiness.",
      }).success
    ).toBe(false)
  })

  it("requires truthful, unavailable status until a provider ledger exists", () => {
    const unavailable = {
      indexingCoverage: {
        status: "unavailable" as const,
        eligibleRecordCount: null,
        indexedRecordCount: null,
        percent: null,
      },
      synchronization: {
        status: "unavailable" as const,
        lagSeconds: null,
        lastSynchronizedAt: null,
        recentErrorCount: null,
      },
    }
    expect(
      contextWorkspaceStatusSchema.parse({
        schemaVersion: 1,
        companyId,
        provider: "off",
        sandboxEnabled: true,
        readiness: "disabled",
        configurationVersion: 1,
        updatedAt: timestamp,
        providerStatus: {
          operational: false,
          status: "disabled",
          detailCode: "context_off",
        },
        ...unavailable,
      })
    ).toMatchObject({ readiness: "disabled", ...unavailable })
    expect(
      contextWorkspaceStatusSchema.safeParse({
        schemaVersion: 1,
        companyId,
        provider: "supermemory",
        sandboxEnabled: true,
        readiness: "ready",
        configurationVersion: 2,
        updatedAt: timestamp,
        providerStatus: {
          operational: false,
          status: "ready",
          detailCode: "provider_not_operational",
        },
        ...unavailable,
      }).success
    ).toBe(false)
    for (const inconsistent of [
      {
        readiness: "disabled",
        providerStatus: {
          operational: false,
          status: "disabled",
          detailCode: "context_off",
        },
      },
      {
        readiness: "ready",
        providerStatus: {
          operational: false,
          status: "ready",
          detailCode: "provider_ready",
        },
      },
      {
        readiness: "error",
        providerStatus: {
          operational: true,
          status: "error",
          detailCode: "provider_error",
        },
      },
    ] as const) {
      expect(
        contextWorkspaceStatusSchema.safeParse({
          schemaVersion: 1,
          companyId,
          provider: "supermemory",
          sandboxEnabled: true,
          configurationVersion: 2,
          updatedAt: timestamp,
          ...unavailable,
          ...inconsistent,
        }).success
      ).toBe(false)
    }
  })

  it("accepts measured indexing evidence without inventing coverage", () => {
    const status = contextWorkspaceStatusSchema.parse({
      schemaVersion: 1,
      companyId,
      provider: "supermemory",
      sandboxEnabled: true,
      readiness: "not_ready",
      configurationVersion: 1,
      updatedAt: timestamp,
      providerStatus: {
        operational: false,
        status: "not_ready",
        detailCode: "provider_not_operational",
      },
      indexingCoverage: {
        status: "evidence_only",
        eligibleRecordCount: 12,
        indexedRecordCount: 7,
        percent: null,
      },
      synchronization: {
        status: "available",
        lagSeconds: null,
        lastSynchronizedAt: null,
        recentErrorCount: 2,
      },
    })
    expect(status.indexingCoverage.status).toBe("evidence_only")
  })

  it("keeps provider indexing default-deny and SQL-compatible", () => {
    const policy = contextIndexingPolicySchema.parse({
      id: requestId,
      companyId,
      sourceKey: "erpnext",
      recordType: "purchase_order",
      policyVersion: 1,
      classification: "internal",
      retentionDays: 365,
      projectionVersion: 1,
      reason: "Initial disabled policy.",
      createdBy: requestId,
      createdAt: timestamp,
    })
    expect(policy).toMatchObject({
      indexingEnabled: false,
      approvedFieldPaths: [],
      maximumContentBytes: 65_536,
    })
    expect(
      contextIndexingPolicySchema.safeParse({
        ...policy,
        indexingEnabled: true,
        approvedFieldPaths: ["/vendor/name", "/api_access_token"],
      }).success
    ).toBe(false)
    for (const sensitiveAlias of ["/apiKey", "/private_key", "/clientSecret"]) {
      expect(
        contextIndexingPolicySchema.safeParse({
          ...policy,
          indexingEnabled: true,
          approvedFieldPaths: ["/vendor/name", sensitiveAlias],
        }).success
      ).toBe(false)
    }
    expect(
      contextIndexingPolicySchema.safeParse({
        ...policy,
        indexingEnabled: true,
        approvedFieldPaths: [""],
      }).success
    ).toBe(false)
  })

  it("bounds retrieval inputs and provenance", () => {
    const request = contextRetrievalRequestSchema.parse({
      requestId,
      provider: "off",
      scope: { companyId, workspaceScopeId: companyId },
      query: "open purchase order evidence",
      queryHash: "a".repeat(64),
      filterHash: "b".repeat(64),
      policyVersion: 1,
      filters: {
        sourceKeys: ["erpnext"],
        recordTypes: ["purchase_order"],
        canonicalRecordIds: [requestId],
      },
      bounds: {},
    })
    expect(request.bounds).toMatchObject({
      maximumResults: 5,
      maximumCharacters: 12_000,
      maximumTokens: 4_000,
      timeoutMs: 2_000,
    })

    expect(
      contextPacketProvenanceSchema.safeParse({
        provider: "off",
        status: "disabled",
        requestId,
        scope: request.scope,
        queryHash: request.queryHash,
        filterHash: request.filterHash,
        policyVersion: 1,
        bounds: request.bounds,
        resultCount: 1,
        characterCount: 0,
        tokenEstimate: 0,
        latencyMs: 0,
        fallbackReason: "context_off",
        indexSnapshotMarker: null,
        citations: [],
      }).success
    ).toBe(false)

    const citation = {
      providerReference: "provider-doc-1",
      providerDocumentId: "provider-document-1",
      stableCustomId: "workspace-record-1",
      canonicalRecordId: requestId,
      canonicalRecordVersion: "version-1",
      sourceId: "40000000-0000-4000-8000-000000000001",
      sourceKey: "erpnext",
      recordType: "purchase_order",
      rank: 1,
      score: 0.9,
      providerUpdatedAt: timestamp,
      sourceObservedAt: timestamp,
      freshness: "fresh" as const,
      contentHash: "c".repeat(64),
      policyHash: "d".repeat(64),
    }
    const excerpt = "bounded evidence"
    const result = {
      provenance: {
        provider: "supermemory" as const,
        status: "complete" as const,
        requestId,
        scope: request.scope,
        queryHash: request.queryHash,
        filterHash: request.filterHash,
        policyVersion: 1,
        bounds: request.bounds,
        resultCount: 1,
        characterCount: excerpt.length,
        tokenEstimate: 3,
        latencyMs: 12,
        fallbackReason: null,
        indexSnapshotMarker: "snapshot-1",
        citations: [citation],
      },
      items: [{ citation, excerpt, untrustedEvidence: true as const }],
    }
    expect(contextRetrievalResultSchema.safeParse(result).success).toBe(true)
    expect(
      contextRetrievalResultSchema.safeParse({
        ...result,
        items: [
          {
            ...result.items[0],
            citation: { ...citation, stableCustomId: "different-record" },
          },
        ],
      }).success
    ).toBe(false)
    expect(
      contextRetrievalResultSchema.safeParse({
        ...result,
        provenance: { ...result.provenance, characterCount: 0 },
      }).success
    ).toBe(false)
    expect(
      contextRetrievalResultSchema.safeParse({
        ...result,
        provenance: {
          ...result.provenance,
          provider: "off",
          status: "disabled",
          fallbackReason: "context_off",
        },
      }).success
    ).toBe(false)
  })
})
