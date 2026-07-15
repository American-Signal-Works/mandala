import type {
  CreateMemoryCandidate,
  MemoryCandidate,
  MemoryRetrievalRequest,
  MemoryReviewRequest,
  MemoryForgetReceipt,
} from "./schema"

export type MemoryProviderContext = {
  actorId: string
}

export interface GovernedMemoryProvider {
  readonly name: string
  createCandidate(
    candidate: CreateMemoryCandidate,
    context: MemoryProviderContext
  ): Promise<MemoryCandidate>
  reviewCandidate(
    request: MemoryReviewRequest,
    context: MemoryProviderContext
  ): Promise<MemoryCandidate>
  retrieve(request: MemoryRetrievalRequest): Promise<MemoryCandidate[]>
  forgetCandidate(input: {
    companyId: string
    candidateId: string
    reason: string
    expectedUpdatedAt: string
    actorId: string
  }): Promise<MemoryForgetReceipt>
  exportCompany(input: { companyId: string }): Promise<MemoryCandidate[]>
}

export class MemoryProviderError extends Error {
  constructor(
    readonly code:
      | "candidate_not_found"
      | "invalid_state"
      | "stale_version"
      | "provider_unavailable"
      | "provider_invalid_response",
    options?: { cause?: unknown }
  ) {
    super(code, options)
    this.name = "MemoryProviderError"
  }
}
