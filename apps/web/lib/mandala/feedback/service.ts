import { MemoryProviderError, type GovernedMemoryProvider } from "../memory"
import { createMemoryCandidateSchema } from "../memory"
import type { FeedbackRepository } from "./repository"
import {
  feedbackCaptureRequestSchema,
  feedbackCaptureResponseSchema,
  feedbackRecordSchema,
} from "./schema"

export async function captureRecommendationFeedback(input: {
  repository: FeedbackRepository
  memoryProvider: GovernedMemoryProvider
  actorId: string
  request: unknown
}) {
  const request = feedbackCaptureRequestSchema.parse(input.request)
  const { memorySuggestion, ...feedbackInput } = request
  const feedback = feedbackRecordSchema.parse(
    await input.repository.capture({
      request: feedbackInput,
      actorId: input.actorId,
    })
  )

  let memoryCandidateId: string | null = null
  let memoryCandidateStatus:
    | "not_requested"
    | "pending_review"
    | "provider_deferred" = "not_requested"
  if (memorySuggestion) {
    try {
      const candidate = await input.memoryProvider.createCandidate(
        createMemoryCandidateSchema.parse({
          companyId: request.companyId,
          ...memorySuggestion,
          provenance: {
            sourceFeedbackId: feedback.id,
            sourceOutcomeId: request.outcome?.id ?? null,
            sourceItemId: request.sourceItemId,
            recommendationId: request.recommendationId,
            recommendationVersion: request.recommendationVersion,
          },
        }),
        { actorId: input.actorId }
      )
      memoryCandidateId = candidate.id
      memoryCandidateStatus = "pending_review"
    } catch (error) {
      if (
        !(error instanceof MemoryProviderError) ||
        error.code !== "provider_unavailable"
      )
        throw error
      memoryCandidateStatus = "provider_deferred"
    }
  }

  return feedbackCaptureResponseSchema.parse({
    feedback,
    memoryCandidateId,
    memoryCandidateStatus,
  })
}
