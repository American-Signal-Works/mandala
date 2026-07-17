import {
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

export class OffContextProvider
  implements ContextRetrievalProvider, ContextIndexProvider
{
  readonly provider = "off" as const

  constructor(private readonly now: () => Date = () => new Date()) {}

  async retrieve(
    request: ContextRetrievalRequest
  ): Promise<ContextRetrievalResult> {
    const parsed = contextRetrievalRequestSchema.parse(request)
    assertOffProvider(parsed.provider)

    return deepFreeze(
      contextRetrievalResultSchema.parse({
        provenance: {
          provider: "off",
          status: "disabled",
          requestId: parsed.requestId,
          scope: parsed.scope,
          queryHash: parsed.queryHash,
          filterHash: parsed.filterHash,
          policyVersion: parsed.policyVersion,
          bounds: parsed.bounds,
          resultCount: 0,
          characterCount: 0,
          tokenEstimate: 0,
          latencyMs: 0,
          fallbackReason: "context_off",
          indexSnapshotMarker: null,
          citations: [],
        },
        items: [],
      })
    )
  }

  async health(scope: ContextTenantScope): Promise<ContextProviderHealth> {
    const parsedScope = contextTenantScopeSchema.parse(scope)
    return deepFreeze(
      contextProviderHealthSchema.parse({
        provider: "off",
        scope: parsedScope,
        status: "disabled",
        checkedAt: this.now().toISOString(),
        detailCode: "context_off",
      })
    )
  }

  async add(
    document: ContextIndexDocument
  ): Promise<ContextIndexOperationResult> {
    const parsed = contextIndexDocumentSchema.parse(document)
    assertOffProvider(parsed.provider)
    return this.disabledOperation(parsed.requestId, "add")
  }

  async addBatch(
    documents: readonly ContextIndexDocument[]
  ): Promise<readonly ContextIndexOperationResult[]> {
    return Promise.all(documents.map((document) => this.add(document)))
  }

  async replace(
    providerDocumentId: string,
    document: ContextIndexDocument
  ): Promise<ContextIndexOperationResult> {
    if (!providerDocumentId.trim() || providerDocumentId.length > 500) {
      throw new Error("A bounded provider document ID is required.")
    }
    const parsed = contextIndexDocumentSchema.parse(document)
    assertOffProvider(parsed.provider)
    return this.disabledOperation(parsed.requestId, "replace")
  }

  async delete(
    request: ContextIndexDeleteRequest
  ): Promise<ContextIndexOperationResult> {
    const parsed = contextIndexDeleteRequestSchema.parse(request)
    assertOffProvider(parsed.provider)
    return this.disabledOperation(parsed.requestId, "delete")
  }

  async list(
    request: ContextIndexListRequest
  ): Promise<ContextIndexListResult> {
    const parsed = contextIndexListRequestSchema.parse(request)
    assertOffProvider(parsed.provider)
    return deepFreeze(
      contextIndexListResultSchema.parse({
        requestId: parsed.requestId,
        provider: "off",
        status: "disabled",
        documents: [],
        nextCursor: null,
      })
    )
  }

  async processingStatus(input: {
    readonly requestId: string
    readonly scope: ContextTenantScope
    readonly stableCustomId: string
  }): Promise<ContextIndexProcessingStatus> {
    const scope = contextTenantScopeSchema.parse(input.scope)
    return deepFreeze(
      contextIndexProcessingStatusSchema.parse({
        requestId: input.requestId,
        provider: "off",
        scope,
        stableCustomId: input.stableCustomId,
        status: "disabled",
        checkedAt: this.now().toISOString(),
      })
    )
  }

  private disabledOperation(
    requestId: string,
    operation: "add" | "replace" | "delete"
  ): ContextIndexOperationResult {
    return deepFreeze(
      contextIndexOperationResultSchema.parse({
        requestId,
        provider: "off",
        operation,
        status: "disabled",
        providerDocumentId: null,
        receipt: null,
        completedAt: this.now().toISOString(),
      })
    )
  }
}

export class ContextProviderNotOperationalError extends Error {
  constructor(provider: "supermemory") {
    super(`Context provider ${provider} is configured but not operational.`)
    this.name = "ContextProviderNotOperationalError"
  }
}

const offContextProvider = new OffContextProvider()

export function resolveContextProvider(
  provider: "off" | "supermemory"
): OffContextProvider {
  if (provider === "off") return offContextProvider
  throw new ContextProviderNotOperationalError(provider)
}

function assertOffProvider(provider: "off" | "supermemory"): void {
  if (provider !== "off") {
    throw new Error("The Off Context provider cannot serve another provider.")
  }
}

function deepFreeze<Value>(value: Value): Value {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const nested of Object.values(value)) deepFreeze(nested)
  }
  return value
}
