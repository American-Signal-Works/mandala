import type { SignalExecutionOutcome, SignalLease } from "./schema"

export type SignalPreparationSummary = {
  changeWindowsProcessed: number
  changeDispatchesEnqueued: number
  scheduleDispatchesEnqueued: number
  reconciliationDispatchesEnqueued: number
  preparedAt: string
}

export interface SignalDispatchRepository {
  prepare(input: {
    now: string
    changeLimit: number
    scheduleLimit: number
  }): Promise<SignalPreparationSummary>
  claim(input: {
    workerId: string
    limit: number
    leaseSeconds: number
    now: string
  }): Promise<SignalLease[]>
  complete(input: {
    workerId: string
    lease: SignalLease
    outcome: SignalExecutionOutcome
  }): Promise<void>
  fail(input: {
    workerId: string
    lease: SignalLease
    retryable: boolean
    errorCode: string
  }): Promise<"pending" | "dead_letter">
}

export class SignalRepositoryError extends Error {
  constructor(
    readonly code:
      | "dispatch_not_found"
      | "lease_lost"
      | "repository_unavailable"
      | "repository_invalid_response",
    options?: { cause?: unknown }
  ) {
    super(code, options)
    this.name = "SignalRepositoryError"
  }
}
