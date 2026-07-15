import type { FeedbackCaptureRequest, FeedbackRecord } from "./schema"

export interface FeedbackRepository {
  capture(input: {
    request: Omit<FeedbackCaptureRequest, "memorySuggestion">
    actorId: string
  }): Promise<FeedbackRecord>
}

export class FeedbackRepositoryError extends Error {
  constructor(
    readonly code:
      | "recommendation_not_found"
      | "recommendation_version_mismatch"
      | "source_item_mismatch"
      | "feedback_conflict"
      | "repository_unavailable"
      | "repository_invalid_response",
    options?: { cause?: unknown }
  ) {
    super(code, options)
    this.name = "FeedbackRepositoryError"
  }
}
