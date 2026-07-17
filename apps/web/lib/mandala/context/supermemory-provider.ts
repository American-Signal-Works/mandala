import "server-only"

import { createHash } from "node:crypto"
import { z } from "zod"
import {
  CONTEXT_MAX_CHARACTERS,
  contextIndexDeleteRequestSchema,
  contextIndexDocumentSchema,
  contextIndexListRequestSchema,
  contextIndexListResultSchema,
  contextIndexOperationResultSchema,
  contextIndexProcessingStatusSchema,
  contextProviderHealthSchema,
  contextRetrievalRequestSchema,
  contextRetrievalResultSchema,
  contextTenantScopeSchema,
  type ContextIndexDeleteRequest,
  type ContextIndexDocument,
  type ContextIndexListRequest,
  type ContextIndexListResult,
  type ContextIndexOperationResult,
  type ContextIndexProcessingStatus,
  type ContextIndexProvider,
  type ContextProviderHealth,
  type ContextRetrievalProvider,
  type ContextRetrievalRequest,
  type ContextRetrievalResult,
  type ContextTenantScope,
} from "@workspace/control-plane"

const SUPERMEMORY_API_ORIGIN = "https://api.supermemory.ai"
const MAX_PROVIDER_RESPONSE_BYTES = 2_000_000
const SAFE_PROVIDER_REFERENCE = z.string().trim().min(1).max(500)
const STABLE_CUSTOM_ID = z.string().regex(/^ctx_[0-9a-f]{64}$/)
const TIMESTAMP = z.string().datetime({ offset: true })
const UUID = z.string().uuid()
const SHA256 = z.string().regex(/^[0-9a-f]{64}$/)

export type SupermemoryTransport = (
  input: string,
  init: RequestInit
) => Promise<Response>

export type SupermemoryProviderFailureClass =
  | "configuration"
  | "timeout"
  | "unavailable"
  | "failed"

export class SupermemoryProviderError extends Error {
  constructor(
    readonly code: string,
    readonly failureClass: SupermemoryProviderFailureClass,
    options?: { cause?: unknown }
  ) {
    if (!/^[a-z0-9_]{1,64}$/.test(code)) {
      throw new Error("Provider error codes must be safe identifiers.")
    }
    super(code, options)
    this.name = "SupermemoryProviderError"
  }
}

export interface SupermemoryContextProviderOptions {
  /** Server-only credential. Never place this object in client state. */
  readonly apiKey: string
  /** Explicit test seam. Production always uses the fixed official origin. */
  readonly testTransport?: SupermemoryTransport
  readonly now?: () => Date
}

const addOrUpdateResponseSchema = z
  .object({
    id: SAFE_PROVIDER_REFERENCE,
    status: z.enum([
      "queued",
      "extracting",
      "chunking",
      "embedding",
      "processing",
      "done",
      "complete",
      "failed",
    ]),
  })
  .passthrough()

const documentListResponseSchema = z
  .object({
    memories: z
      .array(
        z
          .object({
            id: SAFE_PROVIDER_REFERENCE,
            customId: STABLE_CUSTOM_ID,
            containerTags: z.array(SAFE_PROVIDER_REFERENCE),
          })
          .passthrough()
      )
      .max(100),
    pagination: z
      .object({
        currentPage: z.number().int().positive(),
        totalPages: z.number().int().nonnegative(),
      })
      .passthrough(),
  })
  .passthrough()

const documentStatusResponseSchema = z
  .object({
    id: SAFE_PROVIDER_REFERENCE,
    customId: STABLE_CUSTOM_ID.optional(),
    status: z.string().trim().min(1).max(100),
  })
  .passthrough()

const scalarMetadataSchema = z.union([
  z.string().max(1_000),
  z.number().finite(),
  z.boolean(),
])

const searchResultSchema = z
  .object({
    id: SAFE_PROVIDER_REFERENCE,
    memory: z.string().min(1).max(CONTEXT_MAX_CHARACTERS).optional(),
    chunk: z.string().min(1).max(CONTEXT_MAX_CHARACTERS).optional(),
    similarity: z.number().min(0).max(1),
    metadata: z.record(z.string(), scalarMetadataSchema),
    updatedAt: TIMESTAMP,
    version: z.number().int().nonnegative(),
  })
  .passthrough()
  .superRefine((result, context) => {
    if ((result.memory === undefined) === (result.chunk === undefined)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["chunk"],
        message: "Exactly one bounded evidence field is required.",
      })
    }
  })

const searchResponseSchema = z
  .object({
    results: z.array(searchResultSchema).max(100),
    timing: z.number().nonnegative().optional(),
    total: z.number().int().nonnegative().optional(),
  })
  .passthrough()

const searchMetadataSchema = z
  .object({
    company_id: UUID,
    workspace_scope_id: UUID,
    container_tag: SAFE_PROVIDER_REFERENCE,
    stable_custom_id: STABLE_CUSTOM_ID,
    canonical_record_id: UUID,
    canonical_record_version: z.string().trim().min(1).max(200),
    source_id: UUID,
    source_key: z.string().trim().min(1).max(150),
    record_type: z.string().trim().min(1).max(150),
    policy_version: z.number().int().positive(),
    policy_hash: SHA256,
    content_hash: SHA256,
    observed_at: TIMESTAMP,
  })
  .passthrough()

type ProviderRequest = {
  readonly method: "GET" | "POST" | "PATCH" | "DELETE"
  readonly path: string
  readonly timeoutMs: number
  readonly body?: unknown
}

type ProviderResponse = {
  readonly status: number
  readonly data: unknown
}

export class SupermemoryContextProvider
  implements ContextRetrievalProvider, ContextIndexProvider
{
  readonly provider = "supermemory" as const

  private readonly apiKey: string
  private readonly transport: SupermemoryTransport
  private readonly now: () => Date

  constructor(options: SupermemoryContextProviderOptions) {
    this.apiKey = validateApiKey(options.apiKey)
    this.transport = options.testTransport ?? defaultTransport
    this.now = options.now ?? (() => new Date())
  }

  async retrieve(
    request: ContextRetrievalRequest
  ): Promise<ContextRetrievalResult> {
    const parsed = contextRetrievalRequestSchema.parse(request)
    assertSupermemoryProvider(parsed.provider)
    const startedAt = this.now().getTime()

    try {
      const response = await this.request({
        method: "POST",
        path: "/v4/search",
        timeoutMs: parsed.bounds.timeoutMs,
        body: buildSearchBody(parsed),
      })
      const providerResult = searchResponseSchema.safeParse(response.data)
      if (!providerResult.success) {
        throw new SupermemoryProviderError(
          "provider_response_malformed",
          "failed",
          { cause: providerResult.error }
        )
      }
      return deepFreeze(
        buildRetrievalResult({
          request: parsed,
          response: providerResult.data,
          now: this.now(),
          latencyMs: boundedLatency(startedAt, this.now().getTime()),
        })
      )
    } catch (error) {
      const failure = normalizeProviderError(error)
      return deepFreeze(
        emptyRetrievalResult(
          parsed,
          failure.failureClass === "timeout"
            ? "timeout"
            : failure.failureClass === "unavailable"
              ? "unavailable"
              : "failed",
          failure.failureClass === "timeout"
            ? "timeout"
            : failure.failureClass === "unavailable"
              ? "provider_unavailable"
              : "provider_error",
          boundedLatency(startedAt, this.now().getTime())
        )
      )
    }
  }

  async health(scope: ContextTenantScope): Promise<ContextProviderHealth> {
    const parsedScope = contextTenantScopeSchema.parse(scope)
    try {
      await this.request({
        method: "POST",
        path: "/v3/documents/list",
        timeoutMs: 2_000,
        body: {
          containerTags: [containerTagFor(parsedScope)],
          includeContent: false,
          limit: 1,
          page: 1,
        },
      })
      return deepFreeze(
        contextProviderHealthSchema.parse({
          provider: "supermemory",
          scope: parsedScope,
          status: "healthy",
          checkedAt: this.now().toISOString(),
          detailCode: "provider_ready",
        })
      )
    } catch (error) {
      const failure = normalizeProviderError(error)
      return deepFreeze(
        contextProviderHealthSchema.parse({
          provider: "supermemory",
          scope: parsedScope,
          status:
            failure.failureClass === "failed" ? "degraded" : "unavailable",
          checkedAt: this.now().toISOString(),
          detailCode: failure.code,
        })
      )
    }
  }

  async add(
    document: ContextIndexDocument
  ): Promise<ContextIndexOperationResult> {
    const parsed = contextIndexDocumentSchema.parse(document)
    assertIndexDocumentScope(parsed)
    const response = await this.request({
      method: "POST",
      path: "/v3/documents",
      timeoutMs: 10_000,
      body: documentWriteBody(parsed),
    })
    return deepFreeze(
      indexOperationResult(
        parsed,
        "add",
        parseWriteResponse(response.data),
        this.now()
      )
    )
  }

  async replace(
    providerDocumentId: string,
    document: ContextIndexDocument
  ): Promise<ContextIndexOperationResult> {
    const parsedDocumentId = SAFE_PROVIDER_REFERENCE.parse(providerDocumentId)
    const parsed = contextIndexDocumentSchema.parse(document)
    assertIndexDocumentScope(parsed)
    const response = await this.request({
      method: "PATCH",
      path: `/v3/documents/${encodeURIComponent(parsedDocumentId)}`,
      timeoutMs: 10_000,
      body: documentWriteBody(parsed),
    })
    return deepFreeze(
      indexOperationResult(
        parsed,
        "replace",
        parseWriteResponse(response.data),
        this.now()
      )
    )
  }

  async delete(
    request: ContextIndexDeleteRequest
  ): Promise<ContextIndexOperationResult> {
    const parsed = contextIndexDeleteRequestSchema.parse(request)
    assertSupermemoryProvider(parsed.provider)
    STABLE_CUSTOM_ID.parse(parsed.stableCustomId)
    await this.request({
      method: "DELETE",
      path: `/v3/documents/${encodeURIComponent(parsed.providerDocumentId)}`,
      timeoutMs: 10_000,
    })
    return deepFreeze(
      contextIndexOperationResultSchema.parse({
        requestId: parsed.requestId,
        provider: "supermemory",
        operation: "delete",
        status: "complete",
        providerDocumentId: parsed.providerDocumentId,
        receipt: null,
        estimatedCostMicrounits: 0,
        completedAt: this.now().toISOString(),
      })
    )
  }

  async list(
    request: ContextIndexListRequest
  ): Promise<ContextIndexListResult> {
    const parsed = contextIndexListRequestSchema.parse(request)
    assertSupermemoryProvider(parsed.provider)
    const page = parseCursor(parsed.cursor)
    try {
      const response = await this.request({
        method: "POST",
        path: "/v3/documents/list",
        timeoutMs: 10_000,
        body: {
          containerTags: [containerTagFor(parsed.scope)],
          includeContent: false,
          limit: parsed.limit,
          page,
        },
      })
      const result = documentListResponseSchema.safeParse(response.data)
      if (!result.success) {
        throw new SupermemoryProviderError(
          "provider_response_malformed",
          "failed",
          { cause: result.error }
        )
      }
      const expectedContainer = containerTagFor(parsed.scope)
      if (
        result.data.pagination.currentPage !== page ||
        result.data.memories.some(
          (document) =>
            document.containerTags.length !== 1 ||
            document.containerTags[0] !== expectedContainer
        )
      ) {
        throw new SupermemoryProviderError("provider_scope_mismatch", "failed")
      }
      return deepFreeze(
        contextIndexListResultSchema.parse({
          requestId: parsed.requestId,
          provider: "supermemory",
          status: "complete",
          documents: result.data.memories.map((document) => ({
            stableCustomId: document.customId,
            providerDocumentId: document.id,
          })),
          nextCursor:
            page < result.data.pagination.totalPages ? String(page + 1) : null,
        })
      )
    } catch {
      return deepFreeze(
        contextIndexListResultSchema.parse({
          requestId: parsed.requestId,
          provider: "supermemory",
          status: "failed",
          documents: [],
          nextCursor: null,
        })
      )
    }
  }

  async processingStatus(input: {
    readonly requestId: string
    readonly scope: ContextTenantScope
    readonly stableCustomId: string
    readonly providerDocumentId: string
  }): Promise<ContextIndexProcessingStatus> {
    const requestId = UUID.parse(input.requestId)
    const scope = contextTenantScopeSchema.parse(input.scope)
    const stableCustomId = STABLE_CUSTOM_ID.parse(input.stableCustomId)
    const providerDocumentId = SAFE_PROVIDER_REFERENCE.parse(
      input.providerDocumentId
    )
    try {
      const response = await this.request({
        method: "GET",
        path: `/v3/documents/${encodeURIComponent(providerDocumentId)}`,
        timeoutMs: 10_000,
      })
      const result = documentStatusResponseSchema.safeParse(response.data)
      if (
        !result.success ||
        result.data.id !== providerDocumentId ||
        (result.data.customId !== undefined &&
          result.data.customId !== stableCustomId)
      ) {
        throw new SupermemoryProviderError(
          "provider_response_malformed",
          "failed"
        )
      }
      return deepFreeze(
        contextIndexProcessingStatusSchema.parse({
          requestId,
          provider: "supermemory",
          scope,
          stableCustomId,
          status: mapProcessingStatus(result.data.status),
          checkedAt: this.now().toISOString(),
        })
      )
    } catch {
      return deepFreeze(
        contextIndexProcessingStatusSchema.parse({
          requestId,
          provider: "supermemory",
          scope,
          stableCustomId,
          status: "failed",
          checkedAt: this.now().toISOString(),
        })
      )
    }
  }

  private async request(input: ProviderRequest): Promise<ProviderResponse> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), input.timeoutMs)
    try {
      let response: Response
      try {
        response = await this.transport(
          `${SUPERMEMORY_API_ORIGIN}${input.path}`,
          {
            method: input.method,
            headers: {
              Accept: "application/json",
              Authorization: `Bearer ${this.apiKey}`,
              ...(input.body === undefined
                ? {}
                : { "Content-Type": "application/json" }),
            },
            ...(input.body === undefined
              ? {}
              : { body: JSON.stringify(input.body) }),
            signal: controller.signal,
          }
        )
      } catch (error) {
        if (controller.signal.aborted) {
          throw new SupermemoryProviderError("provider_timeout", "timeout")
        }
        throw new SupermemoryProviderError(
          "provider_unavailable",
          "unavailable",
          { cause: error }
        )
      }

      if (!response.ok) throw errorForHttpStatus(response.status)
      if (response.status === 204)
        return { status: response.status, data: null }

      const contentLength = Number(response.headers.get("content-length"))
      if (
        Number.isFinite(contentLength) &&
        contentLength > MAX_PROVIDER_RESPONSE_BYTES
      ) {
        throw new SupermemoryProviderError(
          "provider_response_too_large",
          "failed"
        )
      }
      let text: string
      try {
        text = await response.text()
      } catch (error) {
        if (controller.signal.aborted) {
          throw new SupermemoryProviderError("provider_timeout", "timeout")
        }
        throw new SupermemoryProviderError(
          "provider_unavailable",
          "unavailable",
          { cause: error }
        )
      }
      if (Buffer.byteLength(text, "utf8") > MAX_PROVIDER_RESPONSE_BYTES) {
        throw new SupermemoryProviderError(
          "provider_response_too_large",
          "failed"
        )
      }
      try {
        return { status: response.status, data: JSON.parse(text) as unknown }
      } catch (error) {
        throw new SupermemoryProviderError(
          "provider_response_malformed",
          "failed",
          { cause: error }
        )
      }
    } finally {
      clearTimeout(timeout)
    }
  }
}

export function createSupermemoryRetrievalProvider(
  options: SupermemoryContextProviderOptions
): ContextRetrievalProvider {
  const provider = new SupermemoryContextProvider(options)
  return Object.freeze({
    provider: provider.provider,
    retrieve: provider.retrieve.bind(provider),
    health: provider.health.bind(provider),
  })
}

export function createSupermemoryIndexProvider(
  options: SupermemoryContextProviderOptions
): ContextIndexProvider {
  const provider = new SupermemoryContextProvider(options)
  return Object.freeze({
    provider: provider.provider,
    add: provider.add.bind(provider),
    replace: provider.replace.bind(provider),
    delete: provider.delete.bind(provider),
    list: provider.list.bind(provider),
    processingStatus: provider.processingStatus.bind(provider),
    health: provider.health.bind(provider),
  })
}

export function createSupermemoryRetrievalProviderFromEnvironment(input?: {
  readonly testTransport?: SupermemoryTransport
  readonly now?: () => Date
}): ContextRetrievalProvider {
  return createSupermemoryRetrievalProvider({
    apiKey: process.env.SUPERMEMORY_API_KEY ?? "",
    ...(input?.testTransport ? { testTransport: input.testTransport } : {}),
    ...(input?.now ? { now: input.now } : {}),
  })
}

export function createSupermemoryIndexProviderFromEnvironment(input?: {
  readonly testTransport?: SupermemoryTransport
  readonly now?: () => Date
}): ContextIndexProvider {
  return createSupermemoryIndexProvider({
    apiKey: process.env.SUPERMEMORY_API_KEY ?? "",
    ...(input?.testTransport ? { testTransport: input.testTransport } : {}),
    ...(input?.now ? { now: input.now } : {}),
  })
}

function buildSearchBody(
  request: z.output<typeof contextRetrievalRequestSchema>
) {
  const conditions: unknown[] = [
    { key: "company_id", value: request.scope.companyId },
    { key: "workspace_scope_id", value: request.scope.workspaceScopeId },
    { key: "container_tag", value: containerTagFor(request.scope) },
    anyOf("source_key", request.filters.sourceKeys),
    anyOf("record_type", request.filters.recordTypes),
    anyOf("canonical_record_id", request.filters.canonicalRecordIds),
    {
      filterType: "numeric",
      key: "policy_version",
      value: String(request.policyVersion),
      numericOperator: "=",
    },
  ]
  return {
    q: request.query,
    containerTag: containerTagFor(request.scope),
    searchMode: "hybrid",
    limit: request.bounds.maximumResults,
    threshold: request.bounds.minimumConfidence,
    rerank: false,
    filters: { AND: conditions },
  }
}

function anyOf(key: string, values: readonly string[]) {
  return values.length === 1
    ? { key, value: values[0] }
    : { OR: values.map((value) => ({ key, value })) }
}

function documentWriteBody(
  document: z.output<typeof contextIndexDocumentSchema>
) {
  return {
    content: document.content,
    containerTag: document.containerTag,
    customId: document.stableCustomId,
    taskType: "superrag",
    metadata: {
      company_id: document.scope.companyId,
      workspace_scope_id: document.scope.workspaceScopeId,
      container_tag: document.containerTag,
      stable_custom_id: document.stableCustomId,
      canonical_record_id: document.canonicalRecordId,
      canonical_record_version: document.canonicalRecordVersion,
      source_id: document.sourceId,
      source_key: document.sourceKey,
      record_type: document.recordType,
      policy_version: document.policyVersion,
      policy_hash: document.policyHash,
      content_hash: document.contentHash,
      observed_at: document.observedAt,
    },
  }
}

function buildRetrievalResult(input: {
  request: z.output<typeof contextRetrievalRequestSchema>
  response: z.output<typeof searchResponseSchema>
  now: Date
  latencyMs: number
}): ContextRetrievalResult {
  const expectedContainer = containerTagFor(input.request.scope)
  let policyRejected = false
  let boundsExceeded =
    input.response.results.length > input.request.bounds.maximumResults
  const candidates = input.response.results
    .map((result) => {
      const metadata = searchMetadataSchema.safeParse(result.metadata)
      if (!metadata.success) {
        throw new SupermemoryProviderError(
          "provider_response_malformed",
          "failed",
          { cause: metadata.error }
        )
      }
      const identity = metadata.data
      const allowed =
        identity.company_id === input.request.scope.companyId &&
        identity.workspace_scope_id === input.request.scope.workspaceScopeId &&
        identity.container_tag === expectedContainer &&
        identity.policy_version === input.request.policyVersion &&
        input.request.filters.sourceKeys.includes(identity.source_key) &&
        input.request.filters.recordTypes.includes(identity.record_type) &&
        input.request.filters.canonicalRecordIds.includes(
          identity.canonical_record_id
        ) &&
        result.similarity >= input.request.bounds.minimumConfidence &&
        ageHours(input.now, identity.observed_at) <=
          input.request.bounds.maximumAgeHours
      if (!allowed) {
        policyRejected = true
        return null
      }
      return { result, identity, excerpt: result.memory ?? result.chunk! }
    })
    .filter(
      (candidate): candidate is NonNullable<typeof candidate> =>
        candidate !== null
    )
    .sort(
      (left, right) =>
        right.result.similarity - left.result.similarity ||
        left.result.id.localeCompare(right.result.id)
    )

  const items: Array<{
    citation: {
      providerReference: string
      providerDocumentId: null
      stableCustomId: string
      canonicalRecordId: string
      canonicalRecordVersion: string
      sourceId: string
      sourceKey: string
      recordType: string
      rank: number
      score: number
      providerUpdatedAt: string
      sourceObservedAt: string
      freshness: "fresh"
      contentHash: string
      policyHash: string
    }
    excerpt: string
    untrustedEvidence: true
  }> = []
  let characterCount = 0
  let tokenEstimate = 0
  const seenProviderReferences = new Set<string>()
  const seenCanonicalRecords = new Set<string>()
  for (const candidate of candidates) {
    if (
      seenProviderReferences.has(candidate.result.id) ||
      seenCanonicalRecords.has(candidate.identity.canonical_record_id)
    ) {
      policyRejected = true
      continue
    }
    const nextCharacters = characterCount + candidate.excerpt.length
    const nextTokens = tokenEstimate + estimateTokens(candidate.excerpt)
    if (
      items.length >= input.request.bounds.maximumResults ||
      nextCharacters > input.request.bounds.maximumCharacters ||
      nextTokens > input.request.bounds.maximumTokens
    ) {
      boundsExceeded = true
      continue
    }
    seenProviderReferences.add(candidate.result.id)
    seenCanonicalRecords.add(candidate.identity.canonical_record_id)
    characterCount = nextCharacters
    tokenEstimate = nextTokens
    items.push({
      citation: {
        providerReference: candidate.result.id,
        providerDocumentId: null,
        stableCustomId: candidate.identity.stable_custom_id,
        canonicalRecordId: candidate.identity.canonical_record_id,
        canonicalRecordVersion: candidate.identity.canonical_record_version,
        sourceId: candidate.identity.source_id,
        sourceKey: candidate.identity.source_key,
        recordType: candidate.identity.record_type,
        rank: items.length + 1,
        score: candidate.result.similarity,
        providerUpdatedAt: candidate.result.updatedAt,
        sourceObservedAt: candidate.identity.observed_at,
        freshness: "fresh",
        contentHash: candidate.identity.content_hash,
        policyHash: candidate.identity.policy_hash,
      },
      excerpt: candidate.excerpt,
      untrustedEvidence: true,
    })
  }

  const fallbackReason = boundsExceeded
    ? "bounds_exceeded"
    : policyRejected
      ? "policy_rejected"
      : null
  const status =
    items.length === 0
      ? "empty"
      : fallbackReason === null
        ? "complete"
        : "partial"
  return contextRetrievalResultSchema.parse({
    provenance: {
      provider: "supermemory",
      status,
      requestId: input.request.requestId,
      scope: input.request.scope,
      queryHash: input.request.queryHash,
      filterHash: input.request.filterHash,
      policyVersion: input.request.policyVersion,
      bounds: input.request.bounds,
      resultCount: items.length,
      characterCount,
      tokenEstimate,
      latencyMs: input.latencyMs,
      fallbackReason,
      indexSnapshotMarker:
        items.length === 0
          ? null
          : `sm_${sha256(
              items
                .map(
                  (item) =>
                    `${item.citation.providerReference}:${item.citation.providerUpdatedAt}:${item.citation.contentHash}`
                )
                .join("|")
            )}`,
      citations: items.map((item) => item.citation),
    },
    items,
  })
}

function emptyRetrievalResult(
  request: z.output<typeof contextRetrievalRequestSchema>,
  status: "timeout" | "unavailable" | "failed",
  fallbackReason: "timeout" | "provider_unavailable" | "provider_error",
  latencyMs: number
): ContextRetrievalResult {
  return contextRetrievalResultSchema.parse({
    provenance: {
      provider: "supermemory",
      status,
      requestId: request.requestId,
      scope: request.scope,
      queryHash: request.queryHash,
      filterHash: request.filterHash,
      policyVersion: request.policyVersion,
      bounds: request.bounds,
      resultCount: 0,
      characterCount: 0,
      tokenEstimate: 0,
      latencyMs,
      fallbackReason,
      indexSnapshotMarker: null,
      citations: [],
    },
    items: [],
  })
}

function indexOperationResult(
  document: z.output<typeof contextIndexDocumentSchema>,
  operation: "add" | "replace",
  providerResult: z.output<typeof addOrUpdateResponseSchema>,
  now: Date
): ContextIndexOperationResult {
  const normalizedStatus = providerResult.status.toLowerCase()
  return contextIndexOperationResultSchema.parse({
    requestId: document.requestId,
    provider: "supermemory",
    operation,
    status:
      normalizedStatus === "done" || normalizedStatus === "complete"
        ? "complete"
        : normalizedStatus === "failed"
          ? "failed"
          : "accepted",
    providerDocumentId: providerResult.id,
    receipt: null,
    estimatedCostMicrounits: 0,
    completedAt: now.toISOString(),
  })
}

function parseWriteResponse(data: unknown) {
  const parsed = addOrUpdateResponseSchema.safeParse(data)
  if (!parsed.success) {
    throw new SupermemoryProviderError(
      "provider_response_malformed",
      "failed",
      { cause: parsed.error }
    )
  }
  return parsed.data
}

function mapProcessingStatus(
  status: string
): "pending" | "processing" | "complete" | "failed" {
  switch (status.toLowerCase()) {
    case "queued":
      return "pending"
    case "extracting":
    case "chunking":
    case "embedding":
    case "processing":
      return "processing"
    case "done":
    case "complete":
      return "complete"
    default:
      return "failed"
  }
}

function parseCursor(cursor: string | null): number {
  if (cursor === null) return 1
  if (!/^[1-9]\d{0,8}$/.test(cursor)) {
    throw new SupermemoryProviderError("provider_cursor_invalid", "failed")
  }
  return Number(cursor)
}

function assertIndexDocumentScope(
  document: z.output<typeof contextIndexDocumentSchema>
): void {
  assertSupermemoryProvider(document.provider)
  STABLE_CUSTOM_ID.parse(document.stableCustomId)
  if (document.containerTag !== containerTagFor(document.scope)) {
    throw new SupermemoryProviderError("provider_scope_mismatch", "failed")
  }
}

function assertSupermemoryProvider(provider: "off" | "supermemory"): void {
  if (provider !== "supermemory") {
    throw new SupermemoryProviderError("provider_mismatch", "failed")
  }
}

function containerTagFor(scope: ContextTenantScope): string {
  return `company:${scope.companyId}`
}

function validateApiKey(value: string): string {
  const parsed = z.string().trim().min(16).max(1_000).safeParse(value)
  if (!parsed.success || /\s/.test(parsed.data)) {
    throw new SupermemoryProviderError(
      "provider_configuration_invalid",
      "configuration"
    )
  }
  return parsed.data
}

function errorForHttpStatus(status: number): SupermemoryProviderError {
  if (status === 408 || status === 504) {
    return new SupermemoryProviderError("provider_timeout", "timeout")
  }
  if (status === 429) {
    return new SupermemoryProviderError("provider_rate_limited", "unavailable")
  }
  if (status >= 500) {
    return new SupermemoryProviderError("provider_unavailable", "unavailable")
  }
  if (status === 401 || status === 403) {
    return new SupermemoryProviderError(
      "provider_authentication_failed",
      "failed"
    )
  }
  return new SupermemoryProviderError("provider_request_failed", "failed")
}

function normalizeProviderError(error: unknown): SupermemoryProviderError {
  return error instanceof SupermemoryProviderError
    ? error
    : new SupermemoryProviderError("provider_request_failed", "failed", {
        cause: error,
      })
}

function ageHours(now: Date, observedAt: string): number {
  return Math.max(0, (now.getTime() - Date.parse(observedAt)) / 3_600_000)
}

function estimateTokens(value: string): number {
  return Math.ceil(value.length / 4)
}

function boundedLatency(startedAt: number, completedAt: number): number {
  return Math.max(0, Math.min(120_000, Math.round(completedAt - startedAt)))
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex")
}

function deepFreeze<Value>(value: Value): Value {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const nested of Object.values(value)) deepFreeze(nested)
  }
  return value
}

const defaultTransport: SupermemoryTransport = (input, init) =>
  fetch(input, init)
