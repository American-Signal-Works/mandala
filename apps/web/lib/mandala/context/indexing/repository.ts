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
  loadProjection(input: {
    workerId: string
    lease: ContextIndexLease
  }): Promise<ContextIndexProjectionSource>
  complete(input: {
    workerId: string
    lease: ContextIndexLease
    outcome: ContextIndexCompletionOutcome
  }): Promise<void>
  fail(input: {
    workerId: string
    lease: ContextIndexLease
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
