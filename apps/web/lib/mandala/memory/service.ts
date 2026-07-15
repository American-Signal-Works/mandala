import { z } from "zod"
import type { GovernedMemoryProvider } from "./provider"
import {
  memoryCandidateSchema,
  memoryExportResponseSchema,
  memoryForgetReceiptSchema,
  memoryForgetRequestSchema,
  memoryRetrievalItemSchema,
  memoryRetrievalRequestSchema,
  memoryRetrievalResponseSchema,
  memoryReviewRequestSchema,
  type MemoryCandidate,
  type MemoryRetrievalItem,
} from "./schema"

export async function retrieveGovernedMemory(input: {
  provider: GovernedMemoryProvider
  request: unknown
  now?: Date
}) {
  const request = memoryRetrievalRequestSchema.parse(input.request)
  const currentTime = input.now ?? new Date()
  const requestedTime = request.asOf ? new Date(request.asOf) : currentTime
  const asOf = requestedTime > currentTime ? requestedTime : currentTime
  const candidates = z
    .array(memoryCandidateSchema)
    .parse(await input.provider.retrieve(request))

  const items = candidates
    .filter((candidate) => isCurrentApprovedCandidate(candidate, request, asOf))
    .sort(compareCandidates)
    .slice(0, request.maxResults)
    .map(toSafeRetrievalItem)

  return memoryRetrievalResponseSchema.parse({
    items,
    provider: input.provider.name,
  })
}

export async function reviewMemoryCandidate(input: {
  provider: GovernedMemoryProvider
  actorId: string
  request: unknown
}) {
  const request = memoryReviewRequestSchema.parse(input.request)
  return memoryCandidateSchema.parse(
    await input.provider.reviewCandidate(request, { actorId: input.actorId })
  )
}

export async function forgetGovernedMemory(input: {
  provider: GovernedMemoryProvider
  actorId: string
  request: unknown
}) {
  const request = memoryForgetRequestSchema.parse(input.request)
  return memoryForgetReceiptSchema.parse(
    await input.provider.forgetCandidate({
      ...request,
      actorId: input.actorId,
    })
  )
}

export async function exportGovernedMemory(input: {
  provider: GovernedMemoryProvider
  companyId: string
  exportedAt?: Date
}) {
  const companyId = z.string().uuid().parse(input.companyId)
  const items = z
    .array(memoryCandidateSchema)
    .max(10_000)
    .parse(await input.provider.exportCompany({ companyId }))
  return memoryExportResponseSchema.parse({
    items,
    exportedAt: (input.exportedAt ?? new Date()).toISOString(),
  })
}

export function isCurrentApprovedCandidate(
  candidate: MemoryCandidate,
  request: z.infer<typeof memoryRetrievalRequestSchema>,
  asOf: Date
): boolean {
  if (candidate.companyId !== request.companyId) return false
  if (candidate.status !== "approved" || !candidate.approvedAt) return false
  if (!candidate.content) return false
  if (candidate.supersededById || candidate.forgottenAt || candidate.revokedAt)
    return false
  if (candidate.expiresAt && new Date(candidate.expiresAt) <= asOf) return false
  if (
    candidate.retentionUntil &&
    new Date(candidate.retentionUntil) <= asOf
  )
    return false

  return (
    scopeMatches(candidate.applicability.workspaceId, request.workspaceId) &&
    scopeMatches(candidate.applicability.agentId, request.agentId) &&
    scopeMatches(candidate.applicability.itemId, request.itemId) &&
    scopeMatches(candidate.applicability.vendorId, request.vendorId) &&
    scopeMatches(candidate.applicability.productId, request.productId) &&
    scopeMatches(candidate.applicability.userId, request.userId)
  )
}

function scopeMatches(
  candidateValue: string | null,
  requestValue: string | undefined
): boolean {
  return candidateValue === null || candidateValue === requestValue
}

function compareCandidates(left: MemoryCandidate, right: MemoryCandidate) {
  const confidence = right.confidence - left.confidence
  if (confidence !== 0) return confidence
  return right.updatedAt.localeCompare(left.updatedAt)
}

function toSafeRetrievalItem(candidate: MemoryCandidate): MemoryRetrievalItem {
  return memoryRetrievalItemSchema.parse({
    id: candidate.id,
    companyId: candidate.companyId,
    type: candidate.type,
    content: candidate.content,
    applicability: candidate.applicability,
    provenance: candidate.provenance,
    confidence: candidate.confidence,
    status: "approved",
    expiresAt: candidate.expiresAt,
  })
}
