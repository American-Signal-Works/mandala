import {
  providerUsageMeasurementSchema,
  type ProviderUsageMeasurement,
  type UsageMetricSet,
} from "./schema"

export function normalizeProviderUsage(input: {
  providerModel: string
  response?: unknown
  measuredAt?: Date
}): ProviderUsageMeasurement {
  const { provider, model } = splitProviderModel(input.providerModel)
  const response = asRecord(input.response)
  const metadata = asRecord(response?.usage_metadata)
  const inputDetails = asRecord(metadata?.input_token_details)
  const outputDetails = asRecord(metadata?.output_token_details)
  const metrics: UsageMetricSet = { requests: 1 }
  let supplied = 0

  supplied += assignMetric(metrics, "input_tokens", metadata?.input_tokens)
  supplied += assignMetric(metrics, "output_tokens", metadata?.output_tokens)
  supplied += assignMetric(metrics, "total_tokens", metadata?.total_tokens)
  assignMetric(metrics, "cached_input_tokens", inputDetails?.cache_read)
  assignMetric(metrics, "reasoning_output_tokens", outputDetails?.reasoning)

  const completeness =
    supplied === 3 ? "complete" : supplied === 0 ? "unavailable" : "partial"

  return providerUsageMeasurementSchema.parse({
    provider,
    model,
    measuredAt: (input.measuredAt ?? new Date()).toISOString(),
    completeness,
    metrics,
  })
}

export function splitProviderModel(providerModel: string): {
  provider: string
  model: string
} {
  const separator = providerModel.indexOf("/")
  if (separator <= 0 || separator === providerModel.length - 1) {
    throw new Error("Provider model must use provider/model format.")
  }
  return {
    provider: providerModel.slice(0, separator).toLowerCase(),
    model: providerModel.slice(separator + 1),
  }
}

function assignMetric(
  metrics: UsageMetricSet,
  key: Exclude<keyof UsageMetricSet, "requests">,
  value: unknown
): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    return 0
  }
  metrics[key] = value
  return key === "input_tokens" ||
    key === "output_tokens" ||
    key === "total_tokens"
    ? 1
    : 0
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null
}
