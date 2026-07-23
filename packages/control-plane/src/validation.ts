import { z } from "zod"
import { identifierSchema } from "./schemas.js"

export const validationStatusSchema = z.enum(["pass", "warn", "blocked"])
export const validationIssueKindSchema = z.enum(["reason", "warning"])

export const validationIssueSchema = z
  .object({
    code: identifierSchema,
    message: z.string().min(1).max(2_000),
    kind: validationIssueKindSchema,
  })
  .strict()

export const validationIssuesSchema = z
  .array(validationIssueSchema)
  .max(100)
  .superRefine((issues, context) => {
    const identities = new Set<string>()
    for (const [index, issue] of issues.entries()) {
      const identity = `${issue.kind}:${issue.code}:${issue.message}`
      if (identities.has(identity)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate validation issue at index ${index} for ${issue.kind}:${issue.code}.`,
        })
        return
      }
      identities.add(identity)
    }
  })

export const validationResultSchema = z
  .object({
    status: validationStatusSchema,
    issues: validationIssuesSchema,
    reasons: z.array(z.string().min(1).max(2_000)).max(100),
    warnings: z.array(z.string().min(1).max(2_000)).max(100),
    suppressRecommendation: z.boolean(),
  })
  .strict()
  .superRefine((result, context) => {
    const reasons = result.issues
      .filter((issue) => issue.kind === "reason")
      .map((issue) => issue.message)
    const warnings = result.issues
      .filter((issue) => issue.kind === "warning")
      .map((issue) => issue.message)
    if (!sameStrings(reasons, result.reasons)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["reasons"],
        message: "Validation reasons must be derived from issues.",
      })
    }
    if (!sameStrings(warnings, result.warnings)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["warnings"],
        message: "Validation warnings must be derived from issues.",
      })
    }
  })

const legacyValidationResultSchema = z
  .object({
    status: validationStatusSchema,
    reasons: z.array(z.string().min(1).max(2_000)).max(100),
    warnings: z.array(z.string().min(1).max(2_000)).max(100),
    suppressRecommendation: z.boolean(),
  })
  .strict()

export type ValidationStatus = z.infer<typeof validationStatusSchema>
export type ValidationIssueKind = z.infer<typeof validationIssueKindSchema>
export type ValidationIssue = z.infer<typeof validationIssueSchema>
export type ValidationResult = z.infer<typeof validationResultSchema>

export function createValidationResult(input: {
  status: ValidationStatus
  issues?: readonly ValidationIssue[]
  suppressRecommendation: boolean
}): ValidationResult {
  const issues = validationIssuesSchema.parse(input.issues ?? [])
  return validationResultSchema.parse({
    status: input.status,
    issues,
    reasons: issues
      .filter((issue) => issue.kind === "reason")
      .map((issue) => issue.message),
    warnings: issues
      .filter((issue) => issue.kind === "warning")
      .map((issue) => issue.message),
    suppressRecommendation: input.suppressRecommendation,
  })
}

export function normalizeValidationResult(value: unknown): ValidationResult {
  const current = validationResultSchema.safeParse(value)
  if (current.success) return current.data

  const legacy = legacyValidationResultSchema.parse(value)
  return createValidationResult({
    status: legacy.status,
    issues: [
      ...legacyIssues(legacy.reasons, "reason", "legacy_unclassified_reason"),
      ...legacyIssues(
        legacy.warnings,
        "warning",
        "legacy_unclassified_warning"
      ),
    ],
    suppressRecommendation: legacy.suppressRecommendation,
  })
}

function legacyIssues(
  messages: readonly string[],
  kind: ValidationIssueKind,
  baseCode: string
): ValidationIssue[] {
  const occurrences = new Map<string, number>()
  return messages.map((message) => {
    const occurrence = (occurrences.get(message) ?? 0) + 1
    occurrences.set(message, occurrence)
    return {
      code: occurrence === 1 ? baseCode : `${baseCode}_${occurrence}`,
      message,
      kind,
    }
  })
}

function sameStrings(
  left: readonly string[],
  right: readonly string[]
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  )
}
