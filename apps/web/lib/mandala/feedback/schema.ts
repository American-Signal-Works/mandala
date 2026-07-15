import { z } from "zod"
import { credentialOrPiiTextViolation } from "../control-plane/model-text-safety"
import {
  memoryApplicabilitySchema,
  memoryCandidateTypeSchema,
  memoryContentSchema,
} from "../memory"

const versionSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/)

export const feedbackDecisionSchema = z.enum([
  "accepted",
  "edited",
  "rejected",
  "rework",
  "failed",
  "stale",
  "unsafe",
])

export const feedbackOutcomeSchema = z
  .object({
    id: z.string().uuid(),
    status: z.enum([
      "successful",
      "failed",
      "partially_successful",
      "cancelled",
      "unknown",
    ]),
    occurredAt: z.string().datetime(),
    label: z.string().trim().min(1).max(120),
  })
  .strict()

const feedbackCaptureRequestBaseSchema = z
  .object({
    companyId: z.string().uuid(),
    sourceItemId: z.string().uuid(),
    recommendationId: z.string().uuid(),
    recommendationVersion: versionSchema,
    decision: feedbackDecisionSchema,
    correction: z.string().trim().min(1).max(2_000).nullable().default(null),
    reason: z.string().trim().min(1).max(2_000),
    outcome: feedbackOutcomeSchema.nullable().default(null),
    memorySuggestion: z
      .object({
        type: memoryCandidateTypeSchema,
        content: memoryContentSchema,
        applicability: memoryApplicabilitySchema,
        confidence: z.number().min(0).max(1),
        expiresAt: z.string().datetime().nullable().default(null),
        retentionUntil: z.string().datetime().nullable().default(null),
      })
      .strict()
      .nullable()
      .default(null),
    clientSurface: z.enum(["cli", "web", "api", "automation"]),
  })
  .strict()

export const feedbackCaptureRequestSchema =
  feedbackCaptureRequestBaseSchema.superRefine((value, context) => {
    if (
      ["edited", "rejected", "rework", "unsafe"].includes(value.decision) &&
      value.correction === null
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["correction"],
        message: "correction is required for this decision",
      })
    }
    for (const field of ["reason", "correction"] as const) {
      const text = value[field]
      if (text && credentialOrPiiTextViolation(text)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [field],
          message: "sensitive content is not allowed",
        })
      }
    }
  })

export const feedbackRecordSchema = feedbackCaptureRequestBaseSchema
  .omit({ memorySuggestion: true })
  .extend({
    id: z.string().uuid(),
    actorId: z.string().uuid(),
    createdAt: z.string().datetime(),
  })
  .strict()

export const feedbackCaptureResponseSchema = z
  .object({
    feedback: feedbackRecordSchema,
    memoryCandidateId: z.string().uuid().nullable(),
    memoryCandidateStatus: z.enum([
      "not_requested",
      "pending_review",
      "provider_deferred",
    ]),
  })
  .strict()

export type FeedbackCaptureRequest = z.infer<
  typeof feedbackCaptureRequestSchema
>
export type FeedbackRecord = z.infer<typeof feedbackRecordSchema>
