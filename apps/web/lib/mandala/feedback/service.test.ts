import { describe, expect, it, vi } from "vitest"
import {
  MemoryProviderError,
  type GovernedMemoryProvider,
  type MemoryCandidate,
} from "../memory"
import type { FeedbackRepository } from "./repository"
import { captureRecommendationFeedback } from "./service"

const companyId = "20000000-0000-4000-8000-000000000001"
const actorId = "10000000-0000-4000-8000-000000000001"
const itemId = "30000000-0000-4000-8000-000000000001"
const feedbackId = "50000000-0000-4000-8000-000000000001"
const recommendationId = "60000000-0000-4000-8000-000000000001"
const outcomeId = "70000000-0000-4000-8000-000000000001"

describe("recommendation feedback capture", () => {
  it("retains recommendation version, outcome, and candidate provenance", async () => {
    const request = validRequest()
    const storedRequest = withoutMemorySuggestion(request)
    const repository: FeedbackRepository = {
      capture: vi.fn().mockResolvedValue({
        ...storedRequest,
        id: feedbackId,
        actorId,
        createdAt: "2026-07-14T01:00:00.000Z",
      }),
    }
    const memoryProvider = provider()
    vi.mocked(memoryProvider.createCandidate).mockResolvedValue(
      candidateRecord()
    )

    const result = await captureRecommendationFeedback({
      repository,
      memoryProvider,
      actorId,
      request,
    })

    expect(repository.capture).toHaveBeenCalledWith({
      actorId,
      request: expect.objectContaining({
        recommendationId,
        recommendationVersion: "rec-v7",
        outcome: expect.objectContaining({ id: outcomeId }),
      }),
    })
    expect(memoryProvider.createCandidate).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId,
        provenance: {
          sourceFeedbackId: feedbackId,
          sourceOutcomeId: outcomeId,
          sourceItemId: itemId,
          recommendationId,
          recommendationVersion: "rec-v7",
        },
      }),
      { actorId }
    )
    expect(result).toMatchObject({
      memoryCandidateId: candidateRecord().id,
      memoryCandidateStatus: "pending_review",
    })
  })

  it("does not create memory when feedback has no reviewed suggestion", async () => {
    const request = { ...validRequest(), memorySuggestion: null }
    const storedRequest = withoutMemorySuggestion(request)
    const repository: FeedbackRepository = {
      capture: vi.fn().mockResolvedValue({
        ...storedRequest,
        id: feedbackId,
        actorId,
        createdAt: "2026-07-14T01:00:00.000Z",
      }),
    }
    const memoryProvider = provider()
    const result = await captureRecommendationFeedback({
      repository,
      memoryProvider,
      actorId,
      request,
    })
    expect(memoryProvider.createCandidate).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      memoryCandidateId: null,
      memoryCandidateStatus: "not_requested",
    })
  })

  it("requires a correction for reject, edit, rework, and unsafe feedback", async () => {
    await expect(
      captureRecommendationFeedback({
        repository: { capture: vi.fn() },
        memoryProvider: provider(),
        actorId,
        request: { ...validRequest(), decision: "rejected", correction: null },
      })
    ).rejects.toThrow()
  })

  it.each([
    ["reason", "ghp_abcdefghijklmnopqrstuvwxyz1234567890"],
    ["correction", "xox" + "b-1234567890-abcdefghijklmnopqrstuv"],
    ["reason", "AKIA1234567890ABCDEF"],
    ["correction", `AIza${"A".repeat(35)}`],
  ] as const)("rejects sensitive feedback in %s", async (field, value) => {
    const repository: FeedbackRepository = { capture: vi.fn() }
    await expect(
      captureRecommendationFeedback({
        repository,
        memoryProvider: provider(),
        actorId,
        request: { ...validRequest(), [field]: value },
      })
    ).rejects.toThrow("sensitive content is not allowed")
    expect(repository.capture).not.toHaveBeenCalled()
  })

  it("rejects a sensitive memory suggestion before feedback is stored", async () => {
    const repository: FeedbackRepository = { capture: vi.fn() }
    const request = validRequest()
    await expect(
      captureRecommendationFeedback({
        repository,
        memoryProvider: provider(),
        actorId,
        request: {
          ...request,
          memorySuggestion: {
            ...request.memorySuggestion,
            content: {
              summary: "github_pat_abcdefghijklmnopqrstuvwxyz1234567890",
              facts: [],
            },
          },
        },
      })
    ).rejects.toThrow("content is not allowed")
    expect(repository.capture).not.toHaveBeenCalled()
  })

  it("retains feedback and reports deferred memory when its provider is down", async () => {
    const request = validRequest()
    const repository: FeedbackRepository = {
      capture: vi.fn().mockResolvedValue({
        ...withoutMemorySuggestion(request),
        id: feedbackId,
        actorId,
        createdAt: "2026-07-14T01:00:00.000Z",
      }),
    }
    const memoryProvider = provider()
    vi.mocked(memoryProvider.createCandidate).mockRejectedValue(
      new MemoryProviderError("provider_unavailable")
    )
    const result = await captureRecommendationFeedback({
      repository,
      memoryProvider,
      actorId,
      request,
    })
    expect(result).toMatchObject({
      memoryCandidateId: null,
      memoryCandidateStatus: "provider_deferred",
    })
  })
})

function validRequest() {
  return {
    companyId,
    sourceItemId: itemId,
    recommendationId,
    recommendationVersion: "rec-v7",
    decision: "edited" as const,
    correction: "Use 12 units per case.",
    reason: "The recommendation used the each quantity.",
    outcome: {
      id: outcomeId,
      status: "successful" as const,
      occurredAt: "2026-07-14T00:30:00.000Z",
      label: "approved_after_edit",
    },
    memorySuggestion: {
      type: "correction_pattern" as const,
      content: {
        summary: "Use the verified case-pack quantity.",
        facts: [{ key: "case_pack", value: 12 }],
      },
      applicability: {
        workspaceId: null,
        agentId: null,
        itemId,
        vendorId: null,
        productId: null,
        userId: null,
      },
      confidence: 0.8,
      expiresAt: null,
      retentionUntil: null,
    },
    clientSurface: "cli" as const,
  }
}

function provider(): GovernedMemoryProvider {
  return {
    name: "test",
    createCandidate: vi.fn(),
    reviewCandidate: vi.fn(),
    retrieve: vi.fn(),
    forgetCandidate: vi.fn(),
    exportCompany: vi.fn(),
  }
}

function withoutMemorySuggestion<T extends { memorySuggestion: unknown }>(
  request: T
): Omit<T, "memorySuggestion"> {
  const { memorySuggestion, ...stored } = request
  void memorySuggestion
  return stored
}

function candidateRecord(): MemoryCandidate {
  return {
    id: "40000000-0000-4000-8000-000000000001",
    companyId,
    type: "correction_pattern",
    content: validRequest().memorySuggestion.content,
    applicability: validRequest().memorySuggestion.applicability,
    provenance: {
      sourceFeedbackId: feedbackId,
      sourceOutcomeId: outcomeId,
      sourceItemId: itemId,
      recommendationId,
      recommendationVersion: "rec-v7",
    },
    confidence: 0.8,
    status: "pending_review",
    reviewerId: null,
    reviewedAt: null,
    approvedAt: null,
    expiresAt: null,
    retentionUntil: null,
    supersededById: null,
    forgottenAt: null,
    revokedAt: null,
    createdAt: "2026-07-14T01:00:00.000Z",
    updatedAt: "2026-07-14T01:00:00.000Z",
  }
}
