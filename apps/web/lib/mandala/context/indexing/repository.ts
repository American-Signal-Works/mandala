import type {
  ContextIndexCompletionOutcome,
  ContextIndexFailureDisposition,
  ContextIndexFailureState,
  ContextIndexLease,
  ContextIndexPreparationSummary,
  ContextIndexProjectionSource,
  ContextIndexReconciliationMode,
  ContextIndexReconciliationSummary,
} from "@workspace/control-plane"

export type ContextIndexLeaseReference = Pick<ContextIndexLease, "leaseId"> & {
  readonly event: Pick<ContextIndexLease["event"], "id" | "operation">
}

export type ContextIndexProcessingLease = ContextIndexLeaseReference & {
  readonly leasedUntil: string
  readonly companyId: string
  readonly provider: "supermemory"
  readonly stableCustomId: string
  readonly providerDocumentId: string
  readonly expectedContentHash: string
  readonly pollAttempt: number
  readonly maximumPollAttempts: number
}

export interface ContextIndexRepository {
  prepare(input: {
    now: string
    limit: number
  }): Promise<ContextIndexPreparationSummary>
  reconcile(input: {
    companyId: string
    mode: ContextIndexReconciliationMode
    requestedLimit: number
    now: string
  }): Promise<ContextIndexReconciliationSummary>
  claim(input: {
    workerId: string
    limit: number
    leaseSeconds: number
    now: string
  }): Promise<ContextIndexLease[]>
  claimAddBatch(input: {
    workerId: string
    limit: number
    leaseSeconds: number
    now: string
  }): Promise<ContextIndexLease[]>
  claimCleanup(input: {
    workerId: string
    limit: number
    leaseSeconds: number
    now: string
  }): Promise<ContextIndexLease[]>
  claimProcessing(input: {
    workerId: string
    limit: number
    leaseSeconds: number
    now: string
  }): Promise<ContextIndexProcessingLease[]>
  accept(input: {
    workerId: string
    lease: ContextIndexLeaseReference
    providerDocumentId: string
    now: string
  }): Promise<void>
  deferProcessing(input: {
    workerId: string
    lease: ContextIndexProcessingLease
    status: "pending" | "processing" | "unavailable"
    now: string
  }): Promise<"awaiting_provider" | "reconciliation_required">
  loadProjection(input: {
    workerId: string
    lease: ContextIndexLease
  }): Promise<ContextIndexProjectionSource>
  complete(input: {
    workerId: string
    lease: ContextIndexLeaseReference
    outcome: ContextIndexCompletionOutcome
  }): Promise<void>
  fail(input: {
    workerId: string
    lease: ContextIndexLeaseReference
    disposition: ContextIndexFailureDisposition
    errorCode: string
    now: string
  }): Promise<ContextIndexFailureState>
}

export class ContextIndexRepositoryError extends Error {
  constructor(
    readonly code:
      | "event_not_found"
      | "projection_not_found"
      | "lease_lost"
      | "repository_unavailable"
      | "repository_invalid_response",
    options?: { cause?: unknown }
  ) {
    super(code, options)
    this.name = "ContextIndexRepositoryError"
  }
}
