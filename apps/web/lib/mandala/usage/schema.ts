import { z } from "zod"

export const usageCompletenessSchema = z.enum([
  "complete",
  "partial",
  "unavailable",
])

export const usageMetricSetSchema = z
  .object({
    input_tokens: z.number().int().nonnegative().optional(),
    output_tokens: z.number().int().nonnegative().optional(),
    total_tokens: z.number().int().nonnegative().optional(),
    cached_input_tokens: z.number().int().nonnegative().optional(),
    reasoning_output_tokens: z.number().int().nonnegative().optional(),
    requests: z.number().int().positive(),
  })
  .strict()

export const providerUsageMeasurementSchema = z
  .object({
    provider: z.string().regex(/^[a-z0-9][a-z0-9_.:-]{0,99}$/),
    model: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/),
    measuredAt: z.string().datetime({ offset: true }),
    completeness: usageCompletenessSchema,
    metrics: usageMetricSetSchema,
  })
  .strict()

export const providerUsageRecordResultSchema = z
  .object({
    id: z.string().uuid(),
    duplicate: z.boolean(),
    completeness: usageCompletenessSchema,
  })
  .strict()

export const usageSummaryRequestSchema = z
  .object({
    companyId: z.string().uuid(),
    periodStart: z.string().datetime({ offset: true }),
    periodEnd: z.string().datetime({ offset: true }),
  })
  .strict()
  .superRefine((value, context) => {
    const start = Date.parse(value.periodStart)
    const end = Date.parse(value.periodEnd)
    if (end <= start) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["periodEnd"],
        message: "Period end must be after period start.",
      })
    }
    if (end - start > 366 * 24 * 60 * 60 * 1_000) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["periodEnd"],
        message: "Usage periods cannot exceed 366 days.",
      })
    }
  })

const currencyCostSchema = z
  .object({
    currency: z.string().regex(/^[A-Z]{3}$/),
    amount: z.number().nonnegative(),
    rateVersionIds: z.array(z.string().uuid()),
  })
  .strict()

export const companyUsageSummarySchema = z
  .object({
    companyId: z.string().uuid(),
    periodStart: z.string(),
    periodEnd: z.string(),
    completeness: z.enum(["current", "delayed", "partial", "unavailable"]),
    eventCount: z.number().int().nonnegative(),
    completeEventCount: z.number().int().nonnegative(),
    partialEventCount: z.number().int().nonnegative(),
    unavailableEventCount: z.number().int().nonnegative(),
    unpricedMetricCount: z.number().int().nonnegative(),
    metrics: z
      .object({
        inputTokens: z.number().int().nonnegative(),
        outputTokens: z.number().int().nonnegative(),
        totalTokens: z.number().int().nonnegative(),
        cachedInputTokens: z.number().int().nonnegative(),
        reasoningOutputTokens: z.number().int().nonnegative(),
        requests: z.number().int().nonnegative(),
      })
      .strict(),
    costs: z.array(currencyCostSchema),
  })
  .strict()

export type UsageMetricSet = z.infer<typeof usageMetricSetSchema>
export type ProviderUsageMeasurement = z.infer<
  typeof providerUsageMeasurementSchema
>
export type CompanyUsageSummary = z.infer<typeof companyUsageSummarySchema>
