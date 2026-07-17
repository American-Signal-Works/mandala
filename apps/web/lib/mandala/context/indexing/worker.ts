import { z } from "zod"
import {
  CONTEXT_INDEX_MAX_BATCH_SIZE,
  CONTEXT_INDEX_MAX_CONCURRENCY,
  contextIndexCompletionOutcomeSchema,
  contextIndexOperationResultSchema,
  contextIndexWorkerSummarySchema,
  type ContextIndexLease,
  type ContextIndexProvider,
  type ContextIndexWorkResult,
  type ContextProvider,
} from "@workspace/control-plane"
import {
  ContextIndexRepositoryError,
  type ContextIndexRepository,
  type ContextIndexLeaseReference,
  type ContextIndexProcessingLease,
} from "./repository"
import {
  ContextProjectionError,
  projectContextIndexDocument,
} from "./projector"

const workerOptionsSchema = z
  .object({
    workerId: z.string().trim().min(1).max(128),
    limit: z.number().int().min(1).max(CONTEXT_INDEX_MAX_BATCH_SIZE),
    leaseSeconds: z.number().int().min(15).max(900),
    concurrency: z.number().int().min(1).max(CONTEXT_INDEX_MAX_CONCURRENCY),
    now: z.string().datetime({ offset: true }),
  })
  .strict()

export type ContextIndexFailureClass = "transient" | "terminal" | "unknown"

export class ContextIndexProviderExecutionError extends Error {
  constructor(
    readonly code: string,
    readonly failureClass: ContextIndexFailureClass,
    options?: { cause?: unknown }
  ) {
    if (!/^[a-z0-9_]{1,64}$/.test(code)) {
      throw new Error("Context provider error codes must be safe identifiers.")
    }
    super(code, options)
    this.name = "ContextIndexProviderExecutionError"
  }
}

export class MissingContextIndexProviderError extends ContextIndexProviderExecutionError {
  constructor(provider: ContextProvider) {
    super("provider_adapter_missing", "terminal")
    this.name = "MissingContextIndexProviderError"
    if (provider === "off") {
      throw new Error("Context Off cannot be composed as an indexing provider.")
    }
  }
}

export type ContextIndexProviderResolver = (
  provider: ContextProvider
) => ContextIndexProvider | undefined

export function createContextIndexProviderResolver(
  providers: readonly ContextIndexProvider[]
): ContextIndexProviderResolver {
  const byName = new Map<ContextProvider, ContextIndexProvider>()
  for (const provider of providers) {
    if (provider.provider === "off" || byName.has(provider.provider)) {
      throw new Error(
        "Context indexing providers must be unique and operational."
      )
    }
    byName.set(provider.provider, provider)
  }
  return (provider) => byName.get(provider)
}

export function createMissingContextIndexProviderResolver(): ContextIndexProviderResolver {
  return () => undefined
}

export async function runContextIndexBatch(input: {
  repository: ContextIndexRepository
  resolveProvider: ContextIndexProviderResolver
  workerId: string
  limit?: number
  leaseSeconds?: number
  concurrency?: number
  now?: Date
}) {
  const options = workerOptionsSchema.parse({
    workerId: input.workerId,
    limit: input.limit ?? 25,
    leaseSeconds: input.leaseSeconds ?? 120,
    concurrency: input.concurrency ?? 4,
    now: (input.now ?? new Date()).toISOString(),
  })
  const claimInput = {
    workerId: options.workerId,
    limit: options.limit,
    leaseSeconds: options.leaseSeconds,
    now: options.now,
  }
  // Cleanup always wins so provider data cannot be stranded behind a long
  // processing backlog or a repeatedly deferred provider job.
  const cleanupLeases = await input.repository.claimCleanup(claimInput)
  if (cleanupLeases.length > 0) {
    const results = await mapWithConcurrency(
      cleanupLeases,
      options.concurrency,
      (lease) =>
        executeLease({
          repository: input.repository,
          resolveProvider: input.resolveProvider,
          workerId: options.workerId,
          lease,
          now: options.now,
        })
    )
    return contextIndexWorkerSummarySchema.parse(summarize(results))
  }
  const processingLeases = await input.repository.claimProcessing(claimInput)
  if (processingLeases.length > 0) {
    const results = await mapWithConcurrency(
      processingLeases,
      options.concurrency,
      (lease) =>
        executeProcessingLease({
          repository: input.repository,
          resolveProvider: input.resolveProvider,
          workerId: options.workerId,
          lease,
          now: options.now,
        })
    )
    return contextIndexWorkerSummarySchema.parse(summarize(results))
  }
  const leases = await input.repository.claim(claimInput)
  const results = await mapWithConcurrency(
    leases,
    options.concurrency,
    (lease) =>
      executeLease({
        repository: input.repository,
        resolveProvider: input.resolveProvider,
        workerId: options.workerId,
        lease,
        now: options.now,
      })
  )
  return contextIndexWorkerSummarySchema.parse(summarize(results))
}

async function executeProcessingLease(input: {
  repository: ContextIndexRepository
  resolveProvider: ContextIndexProviderResolver
  workerId: string
  lease: ContextIndexProcessingLease
  now: string
}): Promise<ContextIndexWorkResult> {
  const provider = input.resolveProvider(input.lease.provider)
  if (!provider || provider.provider !== input.lease.provider) {
    return failProcessing(input, "provider_adapter_missing", "terminal")
  }
  let processing
  try {
    processing = await provider.processingStatus({
      requestId: input.lease.event.id,
      scope: {
        companyId: input.lease.companyId,
        workspaceScopeId: input.lease.companyId,
      },
      stableCustomId: input.lease.stableCustomId,
      providerDocumentId: input.lease.providerDocumentId,
    })
  } catch {
    return deferProcessing(input, "unavailable")
  }
  if (
    processing.requestId !== input.lease.event.id ||
    processing.provider !== input.lease.provider ||
    processing.scope.companyId !== input.lease.companyId ||
    processing.scope.workspaceScopeId !== input.lease.companyId ||
    processing.stableCustomId !== input.lease.stableCustomId
  ) {
    return failProcessing(input, "invalid_provider_result", "terminal")
  }
  if (processing.status === "pending" || processing.status === "processing") {
    return deferProcessing(input, processing.status)
  }
  if (processing.status !== "complete") {
    return failProcessing(input, "provider_processing_failed", "terminal")
  }
  try {
    await input.repository.complete({
      workerId: input.workerId,
      lease: input.lease,
      outcome: contextIndexCompletionOutcomeSchema.parse({
        eventId: input.lease.event.id,
        provider: input.lease.provider,
        operation: input.lease.event.operation,
        providerDocumentId: input.lease.providerDocumentId,
        receipt: null,
        contentHash: input.lease.expectedContentHash,
        estimatedCostMicrounits: 0,
        completedAt: input.now,
      }),
    })
    return resultFor(input.lease, "completed")
  } catch {
    return resultFor(input.lease, "lease_unresolved")
  }
}

async function deferProcessing(
  input: Parameters<typeof executeProcessingLease>[0],
  status: "pending" | "processing" | "unavailable"
): Promise<ContextIndexWorkResult> {
  try {
    const state = await input.repository.deferProcessing({
      workerId: input.workerId,
      lease: input.lease,
      status,
      now: input.now,
    })
    return resultFor(
      input.lease,
      state === "awaiting_provider"
        ? "provider_processing"
        : "reconciliation_required",
      state === "awaiting_provider" ? undefined : "provider_processing_timeout"
    )
  } catch {
    return resultFor(input.lease, "lease_unresolved")
  }
}

async function failProcessing(
  input: Parameters<typeof executeProcessingLease>[0],
  code: string,
  failureClass: ContextIndexFailureClass
): Promise<ContextIndexWorkResult> {
  try {
    const state = await input.repository.fail({
      workerId: input.workerId,
      lease: input.lease,
      disposition:
        failureClass === "terminal" ? "terminal" : "reconciliation_required",
      errorCode: code,
      now: input.now,
    })
    return resultFor(
      input.lease,
      state === "dead_letter" ? "dead_letter" : "reconciliation_required",
      code
    )
  } catch {
    return resultFor(input.lease, "lease_unresolved", code)
  }
}

async function executeLease(input: {
  repository: ContextIndexRepository
  resolveProvider: ContextIndexProviderResolver
  workerId: string
  lease: ContextIndexLease
  now: string
}): Promise<ContextIndexWorkResult> {
  const event = input.lease.event
  let completion
  try {
    const provider = input.resolveProvider(event.provider)
    if (!provider || provider.provider !== event.provider) {
      throw new MissingContextIndexProviderError(event.provider)
    }

    let providerResult
    let contentHash: string | null = null
    if (event.operation === "delete") {
      providerResult = await provider.delete({
        requestId: event.id,
        provider: event.provider,
        scope: {
          companyId: event.companyId,
          workspaceScopeId: event.companyId,
        },
        stableCustomId: event.stableCustomId,
        providerDocumentId: event.providerDocumentId!,
        canonicalRecordId: event.canonicalRecordId,
      })
    } else {
      const source = await input.repository.loadProjection({
        workerId: input.workerId,
        lease: input.lease,
      })
      const projection = projectContextIndexDocument({ event, source })
      contentHash = projection.document.contentHash
      providerResult =
        event.operation === "add"
          ? await provider.add(projection.document)
          : await provider.replace(
              event.providerDocumentId!,
              projection.document
            )
    }
    const parsedResult = parseProviderResult(providerResult, input.lease)
    if (parsedResult.status === "accepted") {
      try {
        await input.repository.accept({
          workerId: input.workerId,
          lease: input.lease,
          providerDocumentId: parsedResult.providerDocumentId!,
          now: input.now,
        })
        return resultFor(input.lease, "provider_processing")
      } catch {
        // The provider already accepted the write. Lease expiry must move the
        // durable dispatch marker to reconciliation; never replay it here.
        return resultFor(input.lease, "lease_unresolved")
      }
    }
    completion = contextIndexCompletionOutcomeSchema.parse({
      eventId: event.id,
      provider: event.provider,
      operation: event.operation,
      providerDocumentId:
        event.operation === "delete"
          ? event.providerDocumentId
          : parsedResult.providerDocumentId,
      receipt: parsedResult.receipt,
      contentHash,
      estimatedCostMicrounits: parsedResult.estimatedCostMicrounits,
      completedAt: input.now,
    })
  } catch (error) {
    if (
      error instanceof ContextIndexRepositoryError &&
      error.code === "lease_lost"
    ) {
      return resultFor(input.lease, "lease_unresolved", "lease_lost")
    }
    const failure = classifyFailure(error)
    try {
      const state = await input.repository.fail({
        workerId: input.workerId,
        lease: input.lease,
        disposition:
          failure.failureClass === "transient"
            ? "retry"
            : failure.failureClass === "terminal"
              ? "terminal"
              : "reconciliation_required",
        errorCode: failure.code,
        now: input.now,
      })
      return resultFor(
        input.lease,
        state === "pending"
          ? "retry_scheduled"
          : state === "dead_letter"
            ? "dead_letter"
            : "reconciliation_required",
        failure.code
      )
    } catch {
      return resultFor(input.lease, "lease_unresolved", failure.code)
    }
  }

  try {
    await input.repository.complete({
      workerId: input.workerId,
      lease: input.lease,
      outcome: completion,
    })
  } catch {
    // The provider may already have accepted the operation. Never issue a
    // contradictory retry/failure; lease expiry and reconciliation own it.
    return resultFor(input.lease, "lease_unresolved")
  }
  return resultFor(input.lease, "completed")
}

function parseProviderResult(result: unknown, lease: ContextIndexLease) {
  const parsed = contextIndexOperationResultSchema.safeParse(result)
  if (!parsed.success) {
    throw new ContextIndexProviderExecutionError(
      "invalid_provider_result",
      "terminal",
      { cause: parsed.error }
    )
  }
  const value = parsed.data
  if (
    value.requestId !== lease.event.id ||
    value.provider !== lease.event.provider ||
    value.operation !== lease.event.operation
  ) {
    throw new ContextIndexProviderExecutionError(
      "invalid_provider_result",
      "terminal"
    )
  }
  if (value.status === "accepted" && value.providerDocumentId === null) {
    throw new ContextIndexProviderExecutionError(
      "invalid_provider_result",
      "terminal"
    )
  }
  if (value.status === "accepted") {
    return value
  }
  if (value.status !== "complete") {
    throw new ContextIndexProviderExecutionError(
      "provider_operation_failed",
      "terminal"
    )
  }
  if (lease.event.operation !== "delete" && value.providerDocumentId === null) {
    throw new ContextIndexProviderExecutionError(
      "invalid_provider_result",
      "terminal"
    )
  }
  return value
}

function classifyFailure(error: unknown): {
  code: string
  failureClass: ContextIndexFailureClass
} {
  if (error instanceof ContextIndexProviderExecutionError) {
    return { code: error.code, failureClass: error.failureClass }
  }
  if (error instanceof ContextProjectionError) {
    return { code: error.code, failureClass: "terminal" }
  }
  if (error instanceof ContextIndexRepositoryError) {
    if (error.code === "repository_unavailable") {
      return { code: error.code, failureClass: "transient" }
    }
    return { code: error.code, failureClass: "terminal" }
  }
  if (
    error instanceof Error &&
    error.name === "SupermemoryProviderError" &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    if (error.code === "provider_rate_limited") {
      return { code: error.code, failureClass: "transient" }
    }
    if (
      [
        "provider_authentication_failed",
        "provider_configuration_invalid",
        "provider_document_not_found",
        "provider_request_failed",
        "provider_scope_mismatch",
      ].includes(error.code)
    ) {
      return { code: error.code, failureClass: "terminal" }
    }
  }
  // A provider may have accepted the request before throwing. Blind replay is
  // unsafe, so genuinely unknown exceptions always require reconciliation.
  return { code: "provider_outcome_unknown", failureClass: "unknown" }
}

function resultFor(
  lease: ContextIndexLeaseReference,
  status: ContextIndexWorkResult["status"],
  errorCode?: string
): ContextIndexWorkResult {
  return {
    eventId: lease.event.id,
    operation: lease.event.operation,
    status,
    ...(errorCode ? { errorCode } : {}),
  }
}

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(values.length)
  let nextIndex = 0
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, async () => {
      while (nextIndex < values.length) {
        const index = nextIndex
        nextIndex += 1
        results[index] = await mapper(values[index]!)
      }
    })
  )
  return results
}

function summarize(results: ContextIndexWorkResult[]) {
  return {
    claimed: results.length,
    completed: count(results, "completed"),
    retryScheduled: count(results, "retry_scheduled"),
    deadLettered: count(results, "dead_letter"),
    providerProcessing: count(results, "provider_processing"),
    reconciliationRequired: count(results, "reconciliation_required"),
    leaseUnresolved: count(results, "lease_unresolved"),
    results,
  }
}

function count(
  results: readonly ContextIndexWorkResult[],
  status: ContextIndexWorkResult["status"]
) {
  return results.filter((result) => result.status === status).length
}
