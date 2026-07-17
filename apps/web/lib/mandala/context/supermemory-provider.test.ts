import { afterEach, describe, expect, it, vi } from "vitest"
import {
  SupermemoryContextProvider,
  SupermemoryProviderError,
  createSupermemoryIndexProvider,
  createSupermemoryRetrievalProvider,
  createSupermemoryRetrievalProviderFromEnvironment,
} from "./supermemory-provider"

const companyId = "20000000-0000-4000-8000-000000000001"
const requestId = "30000000-0000-4000-8000-000000000001"
const canonicalRecordId = "40000000-0000-4000-8000-000000000001"
const secondCanonicalRecordId = "40000000-0000-4000-8000-000000000002"
const sourceId = "50000000-0000-4000-8000-000000000001"
const timestamp = "2026-07-16T20:00:00.000Z"
const observedAt = "2026-07-15T20:00:00.000Z"
const fakeApiKey = "test_only_supermemory_key_123456"

afterEach(() => {
  vi.useRealTimers()
})

describe("SupermemoryContextProvider retrieval", () => {
  it("uses the pinned v4 shape, exact tenant filters, and strict citations", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = []
    const provider = providerWith(async (url, init) => {
      calls.push({ url, init })
      return jsonResponse({
        results: [searchResult()],
        timing: 12,
        total: 1,
      })
    })

    const result = await provider.retrieve(retrievalRequest())

    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toBe("https://api.supermemory.ai/v4/search")
    expect(new Headers(calls[0]!.init.headers).get("Authorization")).toBe(
      `Bearer ${fakeApiKey}`
    )
    const body = JSON.parse(String(calls[0]!.init.body))
    expect(body).toMatchObject({
      q: "late purchase order delivery",
      containerTag: `company:${companyId}`,
      searchMode: "hybrid",
      limit: 5,
      threshold: 0.5,
      rerank: false,
      filters: {
        AND: expect.arrayContaining([
          { key: "company_id", value: companyId },
          { key: "workspace_scope_id", value: companyId },
          { key: "container_tag", value: `company:${companyId}` },
          { key: "source_key", value: "erpnext" },
          { key: "record_type", value: "purchase_order" },
          { key: "canonical_record_id", value: canonicalRecordId },
          {
            filterType: "numeric",
            key: "policy_version",
            value: "7",
            numericOperator: "=",
          },
        ]),
      },
    })
    expect(body).not.toHaveProperty("containerTags")
    expect(result).toMatchObject({
      provenance: {
        provider: "supermemory",
        status: "complete",
        resultCount: 1,
        fallbackReason: null,
        indexSnapshotMarker: expect.stringMatching(/^sm_[0-9a-f]{64}$/),
      },
      items: [
        {
          excerpt: "Supplier promised delivery on Friday.",
          untrustedEvidence: true,
          citation: {
            providerReference: "chunk_provider_1",
            providerDocumentId: null,
            stableCustomId: `ctx_${"1".repeat(64)}`,
            canonicalRecordId,
            canonicalRecordVersion: "version-1",
            sourceId,
            sourceKey: "erpnext",
            recordType: "purchase_order",
            contentHash: "c".repeat(64),
            policyHash: "b".repeat(64),
            freshness: "fresh",
          },
        },
      ],
    })
    expect(Object.isFrozen(result)).toBe(true)
    expect(Object.isFrozen(result.items[0])).toBe(true)
  })

  it("fails closed on malformed output without reflecting provider content", async () => {
    const provider = providerWith(async () =>
      jsonResponse({
        results: [
          {
            ...searchResult(),
            metadata: { company_id: "wrong-tenant", raw: "do not echo" },
          },
        ],
      })
    )

    const result = await provider.retrieve(retrievalRequest())

    expect(result).toMatchObject({
      provenance: {
        status: "failed",
        fallbackReason: "provider_error",
        resultCount: 0,
      },
      items: [],
    })
    expect(JSON.stringify(result)).not.toContain("do not echo")
  })

  it("rejects wrong-scope, stale, and duplicate evidence and records the fallback", async () => {
    const provider = providerWith(async () =>
      jsonResponse({
        results: [
          searchResult({
            id: "wrong_scope",
            metadata: { company_id: "20000000-0000-4000-8000-000000000099" },
          }),
          searchResult({ id: "valid" }),
          searchResult({ id: "duplicate", similarity: 0.91 }),
          searchResult({
            id: "stale",
            metadata: {
              canonical_record_id: secondCanonicalRecordId,
              observed_at: "2020-01-01T00:00:00.000Z",
            },
          }),
        ],
      })
    )

    const result = await provider.retrieve(
      retrievalRequest({
        filters: {
          sourceKeys: ["erpnext"],
          recordTypes: ["purchase_order"],
          canonicalRecordIds: [canonicalRecordId, secondCanonicalRecordId],
        },
      })
    )

    expect(result.provenance).toMatchObject({
      status: "partial",
      fallbackReason: "policy_rejected",
      resultCount: 1,
    })
    expect(result.items[0]!.citation.providerReference).toBe("duplicate")
  })

  it("truncates only at result boundaries when the provider over-returns", async () => {
    const provider = providerWith(async () =>
      jsonResponse({
        results: [
          searchResult({ id: "first", similarity: 0.9 }),
          searchResult({
            id: "second",
            similarity: 0.8,
            metadata: { canonical_record_id: secondCanonicalRecordId },
          }),
        ],
      })
    )
    const request = retrievalRequest({
      filters: {
        sourceKeys: ["erpnext"],
        recordTypes: ["purchase_order"],
        canonicalRecordIds: [canonicalRecordId, secondCanonicalRecordId],
      },
      bounds: {
        maximumResults: 1,
        maximumCharacters: 100,
        maximumTokens: 100,
        maximumAgeHours: 8_760,
        minimumConfidence: 0.5,
        timeoutMs: 2_000,
      },
    })

    const result = await provider.retrieve(request)

    expect(result.provenance).toMatchObject({
      status: "partial",
      fallbackReason: "bounds_exceeded",
      resultCount: 1,
    })
    expect(result.items.map((item) => item.citation.providerReference)).toEqual(
      ["first"]
    )
  })

  it("classifies cancellation as a bounded timeout", async () => {
    vi.useFakeTimers()
    const provider = providerWith(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError"))
          )
        })
    )

    const resultPromise = provider.retrieve(
      retrievalRequest({
        bounds: {
          maximumResults: 5,
          maximumCharacters: 12_000,
          maximumTokens: 4_000,
          maximumAgeHours: 8_760,
          minimumConfidence: 0.5,
          timeoutMs: 100,
        },
      })
    )
    await vi.advanceTimersByTimeAsync(100)

    await expect(resultPromise).resolves.toMatchObject({
      provenance: { status: "timeout", fallbackReason: "timeout" },
      items: [],
    })
  })

  it.each([
    [401, "failed", "provider_error"],
    [403, "failed", "provider_error"],
    [429, "unavailable", "provider_unavailable"],
    [500, "unavailable", "provider_unavailable"],
  ] as const)(
    "normalizes HTTP %s without returning the response body",
    async (status, expectedStatus, fallbackReason) => {
      const provider = providerWith(
        async () =>
          new Response(`sensitive provider body ${fakeApiKey}`, { status })
      )

      const result = await provider.retrieve(retrievalRequest())

      expect(result.provenance).toMatchObject({
        status: expectedStatus,
        fallbackReason,
      })
      expect(JSON.stringify(result)).not.toContain(fakeApiKey)
      expect(JSON.stringify(result)).not.toContain("sensitive provider body")
    }
  )
})

describe("SupermemoryContextProvider indexing", () => {
  it("uses the official batch endpoint and preserves result order", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = []
    const provider = providerWith(async (url, init) => {
      calls.push({ url, init })
      return jsonResponse({
        results: [
          { id: "provider_doc_1", status: "queued" },
          { id: "provider_doc_2", status: "done" },
        ],
        success: 2,
        failed: 0,
      })
    })
    const second = {
      ...indexDocument(),
      requestId: "30000000-0000-4000-8000-000000000002",
      canonicalRecordId: secondCanonicalRecordId,
      stableCustomId: `ctx_${"2".repeat(64)}`,
      externalId: "PO-0002",
    }

    const result = await provider.addBatch([indexDocument(), second])

    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toBe("https://api.supermemory.ai/v3/documents/batch")
    const body = JSON.parse(String(calls[0]!.init.body))
    expect(body.documents).toHaveLength(2)
    expect(body.documents[0]).toMatchObject({
      customId: `ctx_${"1".repeat(64)}`,
      containerTag: `company:${companyId}`,
      taskType: "superrag",
    })
    expect(body.documents[1]).toMatchObject({
      customId: `ctx_${"2".repeat(64)}`,
      metadata: { canonical_record_id: secondCanonicalRecordId },
    })
    expect(result).toMatchObject([
      {
        requestId,
        status: "accepted",
        providerDocumentId: "provider_doc_1",
      },
      {
        requestId: second.requestId,
        status: "complete",
        providerDocumentId: "provider_doc_2",
      },
    ])
  })

  it("splits large worker batches into bounded parallel provider requests", async () => {
    const requestSizes: number[] = []
    const provider = providerWith(async (_url, init) => {
      const body = JSON.parse(String(init.body)) as {
        documents: Array<{ customId: string }>
      }
      requestSizes.push(body.documents.length)
      return jsonResponse({
        results: body.documents.map((document) => ({
          id: `provider_${document.customId.slice(-4)}`,
          status: "queued",
        })),
        success: body.documents.length,
        failed: 0,
      })
    })
    const documents = Array.from({ length: 26 }, (_, index) => {
      const ordinal = String(index + 1).padStart(12, "0")
      return {
        ...indexDocument(),
        requestId: `30000000-0000-4000-8000-${ordinal}`,
        canonicalRecordId: `20000000-0000-4000-8000-${ordinal}`,
        stableCustomId: `ctx_${(index + 1).toString(16).padStart(64, "0")}`,
        externalId: `PO-${ordinal}`,
      }
    })

    const results = await provider.addBatch(documents)

    expect(requestSizes).toEqual([25, 1])
    expect(results).toHaveLength(26)
    expect(results.map((result) => result.requestId)).toEqual(
      documents.map((document) => document.requestId)
    )
  })

  it("fails closed when a batch response cannot map one result per document", async () => {
    const provider = providerWith(async () =>
      jsonResponse({
        results: [{ id: "provider_doc_1", status: "queued" }],
        success: 1,
        failed: 0,
      })
    )

    await expect(
      provider.addBatch([
        indexDocument(),
        {
          ...indexDocument(),
          requestId: "30000000-0000-4000-8000-000000000002",
        },
      ])
    ).rejects.toMatchObject({ code: "provider_response_malformed" })
  })

  it("pins add and full replacement to v3 with flat identity metadata", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = []
    const provider = providerWith(async (url, init) => {
      calls.push({ url, init })
      return jsonResponse({
        id: "provider_doc_add",
        status: calls.length === 1 ? "queued" : "done",
      })
    })

    const added = await provider.add(indexDocument())
    const replaced = await provider.replace("provider_doc_add", indexDocument())

    expect(added).toMatchObject({
      operation: "add",
      status: "accepted",
      providerDocumentId: "provider_doc_add",
    })
    expect(replaced).toMatchObject({
      operation: "replace",
      status: "complete",
      providerDocumentId: "provider_doc_add",
    })
    expect(calls.map((call) => [call.init.method, call.url])).toEqual([
      ["POST", "https://api.supermemory.ai/v3/documents"],
      ["PATCH", "https://api.supermemory.ai/v3/documents/provider_doc_add"],
    ])
    const addBody = JSON.parse(String(calls[0]!.init.body))
    expect(addBody).toMatchObject({
      content: '{"status":"open"}',
      containerTag: `company:${companyId}`,
      customId: `ctx_${"1".repeat(64)}`,
      taskType: "superrag",
      metadata: {
        company_id: companyId,
        workspace_scope_id: companyId,
        container_tag: `company:${companyId}`,
        stable_custom_id: `ctx_${"1".repeat(64)}`,
        canonical_record_id: canonicalRecordId,
        canonical_record_version: "version-1",
        source_id: sourceId,
        source_key: "erpnext",
        record_type: "purchase_order",
        policy_version: 7,
        policy_hash: "b".repeat(64),
        content_hash: "c".repeat(64),
        observed_at: observedAt,
      },
    })
    expect(addBody).not.toHaveProperty("containerTags")
    expect(JSON.parse(String(calls[1]!.init.body))).toEqual(addBody)
  })

  it("deletes by the stored provider ID without sending content", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = []
    const provider = providerWith(async (url, init) => {
      calls.push({ url, init })
      return new Response(null, { status: 204 })
    })

    const result = await provider.delete({
      requestId,
      provider: "supermemory",
      scope: { companyId, workspaceScopeId: companyId },
      stableCustomId: `ctx_${"1".repeat(64)}`,
      providerDocumentId: "provider/doc id",
      canonicalRecordId,
    })

    expect(calls[0]).toMatchObject({
      url: "https://api.supermemory.ai/v3/documents/provider%2Fdoc%20id",
      init: { method: "DELETE" },
    })
    expect(calls[0]!.init.body).toBeUndefined()
    expect(result).toMatchObject({
      operation: "delete",
      status: "complete",
      providerDocumentId: "provider/doc id",
    })
  })

  it("treats an already-missing provider document as an idempotent delete", async () => {
    const provider = providerWith(
      async () => new Response(null, { status: 404 })
    )

    await expect(
      provider.delete({
        requestId,
        provider: "supermemory",
        scope: { companyId, workspaceScopeId: companyId },
        stableCustomId: `ctx_${"1".repeat(64)}`,
        providerDocumentId: "provider_doc_1",
        canonicalRecordId,
      })
    ).resolves.toMatchObject({ status: "complete" })
  })

  it("uses v3 array container tags for bounded pagination", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = []
    const provider = providerWith(async (url, init) => {
      calls.push({ url, init })
      return jsonResponse({
        memories: [
          {
            id: "provider_doc_1",
            customId: `ctx_${"1".repeat(64)}`,
            containerTags: [`company:${companyId}`],
          },
        ],
        pagination: { currentPage: 2, totalPages: 3 },
      })
    })

    const result = await provider.list({
      requestId,
      provider: "supermemory",
      scope: { companyId, workspaceScopeId: companyId },
      cursor: "2",
      limit: 25,
    })

    expect(calls[0]!.url).toBe("https://api.supermemory.ai/v3/documents/list")
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({
      containerTags: [`company:${companyId}`],
      includeContent: false,
      limit: 25,
      page: 2,
    })
    expect(result).toEqual({
      requestId,
      provider: "supermemory",
      status: "complete",
      documents: [
        {
          stableCustomId: `ctx_${"1".repeat(64)}`,
          providerDocumentId: "provider_doc_1",
        },
      ],
      nextCursor: "3",
    })
  })

  it("fails closed when a listed document omits its tenant container", async () => {
    const provider = providerWith(async () =>
      jsonResponse({
        memories: [
          {
            id: "provider_doc_1",
            customId: `ctx_${"1".repeat(64)}`,
          },
        ],
        pagination: { currentPage: 1, totalPages: 1 },
      })
    )

    await expect(
      provider.list({
        requestId,
        provider: "supermemory",
        scope: { companyId, workspaceScopeId: companyId },
        cursor: null,
        limit: 25,
      })
    ).resolves.toMatchObject({ status: "failed", documents: [] })
  })

  it.each([
    ["queued", "pending"],
    ["embedding", "processing"],
    ["done", "complete"],
    ["failed", "failed"],
  ] as const)(
    "maps document status %s to %s",
    async (providerStatus, status) => {
      let requestedUrl = ""
      const provider = providerWith(async (url) => {
        requestedUrl = url
        return jsonResponse({
          id: "provider_doc_1",
          customId: `ctx_${"1".repeat(64)}`,
          status: providerStatus,
        })
      })

      await expect(
        provider.processingStatus({
          requestId,
          scope: { companyId, workspaceScopeId: companyId },
          stableCustomId: `ctx_${"1".repeat(64)}`,
          providerDocumentId: "provider_doc_1",
        })
      ).resolves.toMatchObject({ status })
      expect(requestedUrl).toBe(
        "https://api.supermemory.ai/v3/documents/provider_doc_1"
      )
    }
  )

  it("fails closed when status returns a different provider document", async () => {
    const provider = providerWith(async () =>
      jsonResponse({
        id: "provider_doc_other",
        customId: `ctx_${"1".repeat(64)}`,
        status: "done",
      })
    )

    await expect(
      provider.processingStatus({
        requestId,
        scope: { companyId, workspaceScopeId: companyId },
        stableCustomId: `ctx_${"1".repeat(64)}`,
        providerDocumentId: "provider_doc_1",
      })
    ).rejects.toMatchObject({
      code: "provider_response_malformed",
      failureClass: "failed",
    })
  })

  it("rejects a replacement response for a different provider document", async () => {
    const provider = providerWith(async () =>
      jsonResponse({ id: "provider_doc_other", status: "done" })
    )

    await expect(
      provider.replace("provider_doc_1", indexDocument())
    ).rejects.toMatchObject({ code: "provider_response_identity_mismatch" })
  })

  it("reports scoped health with no document content request", async () => {
    let body: unknown
    const provider = providerWith(async (_url, init) => {
      body = JSON.parse(String(init.body))
      return jsonResponse({
        memories: [],
        pagination: { currentPage: 1, totalPages: 0 },
      })
    })

    await expect(
      provider.health({ companyId, workspaceScopeId: companyId })
    ).resolves.toMatchObject({
      provider: "supermemory",
      status: "healthy",
      detailCode: "provider_ready",
    })
    expect(body).toEqual({
      containerTags: [`company:${companyId}`],
      includeContent: false,
      limit: 1,
      page: 1,
    })
  })
})

describe("Supermemory provider composition", () => {
  it("constructs retrieval and indexing as separately injectable capabilities", () => {
    const options = {
      apiKey: fakeApiKey,
      testTransport: async () => jsonResponse({}),
    }
    const retrieval = createSupermemoryRetrievalProvider(options)
    const indexing = createSupermemoryIndexProvider(options)

    expect(Object.keys(retrieval).sort()).toEqual([
      "health",
      "provider",
      "retrieve",
    ])
    expect(Object.keys(indexing).sort()).toEqual([
      "add",
      "addBatch",
      "delete",
      "health",
      "list",
      "processingStatus",
      "provider",
      "replace",
    ])
  })

  it("rejects missing configuration with a content-free error", () => {
    expect(() => new SupermemoryContextProvider({ apiKey: "" })).toThrow(
      expect.objectContaining({
        name: "SupermemoryProviderError",
        code: "provider_configuration_invalid",
        failureClass: "configuration",
        message: "provider_configuration_invalid",
      })
    )
    expect(() => new SupermemoryProviderError("unsafe!", "failed")).toThrow(
      "Provider error codes must be safe identifiers."
    )
  })

  it("reads the key only from the server environment factory", () => {
    const prior = process.env.SUPERMEMORY_API_KEY
    process.env.SUPERMEMORY_API_KEY = fakeApiKey
    try {
      const provider = createSupermemoryRetrievalProviderFromEnvironment({
        testTransport: async () => jsonResponse({}),
      })
      expect(Object.keys(provider).sort()).toEqual([
        "health",
        "provider",
        "retrieve",
      ])
    } finally {
      if (prior === undefined) delete process.env.SUPERMEMORY_API_KEY
      else process.env.SUPERMEMORY_API_KEY = prior
    }
  })
})

function providerWith(
  testTransport: (input: string, init: RequestInit) => Promise<Response>
) {
  return new SupermemoryContextProvider({
    apiKey: fakeApiKey,
    testTransport,
    now: () => new Date(timestamp),
  })
}

function retrievalRequest(overrides: Record<string, unknown> = {}) {
  return {
    requestId,
    provider: "supermemory" as const,
    scope: { companyId, workspaceScopeId: companyId },
    query: "late purchase order delivery",
    queryHash: "a".repeat(64),
    filterHash: "b".repeat(64),
    policyVersion: 7,
    filters: {
      sourceKeys: ["erpnext"],
      recordTypes: ["purchase_order"],
      canonicalRecordIds: [canonicalRecordId],
    },
    bounds: {
      maximumResults: 5,
      maximumCharacters: 12_000,
      maximumTokens: 4_000,
      maximumAgeHours: 8_760,
      minimumConfidence: 0.5,
      timeoutMs: 2_000,
    },
    ...overrides,
  }
}

function searchResult(
  overrides: {
    id?: string
    similarity?: number
    metadata?: Record<string, string | number | boolean>
  } = {}
) {
  return {
    id: overrides.id ?? "chunk_provider_1",
    chunk: "Supplier promised delivery on Friday.",
    similarity: overrides.similarity ?? 0.88,
    metadata: {
      company_id: companyId,
      workspace_scope_id: companyId,
      container_tag: `company:${companyId}`,
      stable_custom_id: `ctx_${"1".repeat(64)}`,
      canonical_record_id: canonicalRecordId,
      canonical_record_version: "version-1",
      source_id: sourceId,
      source_key: "erpnext",
      record_type: "purchase_order",
      policy_version: 7,
      policy_hash: "b".repeat(64),
      content_hash: "c".repeat(64),
      observed_at: observedAt,
      ...overrides.metadata,
    },
    updatedAt: timestamp,
    version: 1,
  }
}

function indexDocument() {
  return {
    requestId,
    provider: "supermemory" as const,
    scope: { companyId, workspaceScopeId: companyId },
    stableCustomId: `ctx_${"1".repeat(64)}`,
    canonicalRecordId,
    canonicalRecordVersion: "version-1",
    sourceId,
    sourceKey: "erpnext",
    recordType: "purchase_order",
    externalId: "PO-0001",
    containerTag: `company:${companyId}`,
    policyVersion: 7,
    policyHash: "b".repeat(64),
    contentHash: "c".repeat(64),
    content: '{"status":"open"}',
    observedAt,
  }
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}
