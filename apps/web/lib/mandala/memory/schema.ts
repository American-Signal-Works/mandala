import { z } from "zod"
import {
  credentialOrPiiTextViolation,
  promptOrReasoningTextViolation,
} from "../control-plane/model-text-safety"

const identifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/)

const safeFactValueSchema = z.union([
  z.string().trim().min(1).max(240),
  z.number().finite(),
  z.boolean(),
])

export const memoryCandidateTypeSchema = z.enum([
  "correction_pattern",
  "outcome_signal",
  "preference",
  "operating_constraint",
])

export const memoryCandidateStatusSchema = z.enum([
  "pending_review",
  "approved",
  "rejected",
  "superseded",
  "expired",
  "forgotten",
  "revoked",
])

const prohibitedMemoryKey =
  /(password|passcode|secret|token|credential|api_?key|private_?key|authorization|cookie|session|github_?pat|slack_?(token|key)|aws_?(access_?)?key|google_?api_?key|prompt|chain_?of_?thought|hidden_?reasoning|social_?security|ssn|card_?number|cvv)/i

const memoryContentBaseSchema = z
  .object({
    summary: z.string().trim().min(1).max(500),
    facts: z
      .array(
        z
          .object({
            key: z
              .string()
              .trim()
              .min(1)
              .max(64)
              .regex(/^[a-z][a-z0-9_]*$/),
            value: safeFactValueSchema,
          })
          .strict()
      )
      .max(12)
      .default([]),
  })
  .strict()

export const memoryContentSchema = memoryContentBaseSchema.superRefine(
  (content, context) => {
    const prohibited =
      prohibitedMemoryValue(content.summary) ||
      content.facts.some(
        (fact) =>
          prohibitedMemoryKey.test(fact.key) ||
          (typeof fact.value === "string" && prohibitedMemoryValue(fact.value))
      )
    if (prohibited)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "content is not allowed",
      })
  }
)

function prohibitedMemoryValue(value: string): boolean {
  return (
    credentialOrPiiTextViolation(value) || promptOrReasoningTextViolation(value)
  )
}

export const memoryApplicabilitySchema = z
  .object({
    workspaceId: z.string().uuid().nullable().default(null),
    agentId: z.string().uuid().nullable().default(null),
    itemId: z.string().uuid().nullable().default(null),
    vendorId: z.string().uuid().nullable().default(null),
    productId: z.string().uuid().nullable().default(null),
    userId: z.string().uuid().nullable().default(null),
  })
  .strict()

export const memoryProvenanceSchema = z
  .object({
    sourceFeedbackId: z.string().uuid(),
    sourceOutcomeId: z.string().uuid().nullable().default(null),
    sourceItemId: z.string().uuid(),
    recommendationId: z.string().uuid(),
    recommendationVersion: identifierSchema,
  })
  .strict()

export const memoryCandidateSchema = z
  .object({
    id: z.string().uuid(),
    companyId: z.string().uuid(),
    type: memoryCandidateTypeSchema,
    content: memoryContentSchema.nullable(),
    applicability: memoryApplicabilitySchema,
    provenance: memoryProvenanceSchema,
    confidence: z.number().min(0).max(1),
    status: memoryCandidateStatusSchema,
    reviewerId: z.string().uuid().nullable(),
    reviewedAt: z.string().datetime().nullable(),
    approvedAt: z.string().datetime().nullable(),
    expiresAt: z.string().datetime().nullable(),
    retentionUntil: z.string().datetime().nullable(),
    supersededById: z.string().uuid().nullable(),
    forgottenAt: z.string().datetime().nullable(),
    revokedAt: z.string().datetime().nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict()

export const createMemoryCandidateSchema = memoryCandidateSchema
  .pick({
    companyId: true,
    type: true,
    content: true,
    applicability: true,
    provenance: true,
    confidence: true,
    expiresAt: true,
    retentionUntil: true,
  })
  .extend({ content: memoryContentSchema })

export const memoryRetrievalRequestSchema = z
  .object({
    companyId: z.string().uuid(),
    workspaceId: z.string().uuid().optional(),
    agentId: z.string().uuid().optional(),
    itemId: z.string().uuid().optional(),
    vendorId: z.string().uuid().optional(),
    productId: z.string().uuid().optional(),
    userId: z.string().uuid().optional(),
    maxResults: z.coerce.number().int().min(1).max(20).default(10),
    asOf: z.string().datetime().optional(),
  })
  .strict()

export const memoryRetrievalItemSchema = memoryCandidateSchema
  .pick({
    id: true,
    companyId: true,
    type: true,
    content: true,
    applicability: true,
    provenance: true,
    confidence: true,
    expiresAt: true,
  })
  .extend({ status: z.literal("approved"), content: memoryContentSchema })
  .strict()

export const memoryRetrievalResponseSchema = z
  .object({
    items: z.array(memoryRetrievalItemSchema).max(20),
    provider: z.string().trim().min(1).max(64),
  })
  .strict()

export const memoryReviewRequestSchema = z
  .object({
    companyId: z.string().uuid(),
    candidateId: z.string().uuid(),
    decision: z.enum(["approve", "reject", "revoke"]),
    reason: z.string().trim().min(1).max(1_000),
    expiresAt: z.string().datetime().nullable().optional(),
    expectedUpdatedAt: z.string().datetime(),
  })
  .strict()

export const memoryForgetRequestSchema = z
  .object({
    companyId: z.string().uuid(),
    candidateId: z.string().uuid(),
    reason: z.string().trim().min(1).max(1_000),
    expectedUpdatedAt: z.string().datetime(),
  })
  .strict()

export const memoryForgetReceiptSchema = z
  .object({
    id: z.string().uuid(),
    companyId: z.string().uuid(),
    status: z.literal("forgotten"),
    forgottenAt: z.string().datetime(),
  })
  .strict()

export const memoryExportResponseSchema = z
  .object({
    items: z.array(memoryCandidateSchema).max(10_000),
    exportedAt: z.string().datetime(),
  })
  .strict()

export type MemoryCandidate = z.infer<typeof memoryCandidateSchema>
export type CreateMemoryCandidate = z.infer<typeof createMemoryCandidateSchema>
export type MemoryRetrievalRequest = z.infer<
  typeof memoryRetrievalRequestSchema
>
export type MemoryRetrievalItem = z.infer<typeof memoryRetrievalItemSchema>
export type MemoryReviewRequest = z.infer<typeof memoryReviewRequestSchema>
export type MemoryForgetRequest = z.infer<typeof memoryForgetRequestSchema>
export type MemoryForgetReceipt = z.infer<typeof memoryForgetReceiptSchema>
