import { createHash } from "node:crypto"
import { normalizeProviderUsage } from "./normalization"
import {
  companyUsageSummarySchema,
  providerUsageRecordResultSchema,
  usageSummaryRequestSchema,
  type CompanyUsageSummary,
} from "./schema"

type UsageRpcResponse = PromiseLike<{
  data: unknown
  error: { code?: string; message: string } | null
}>

type UsageRpcClient = {
  rpc(name: string, parameters: Record<string, unknown>): UsageRpcResponse
}

export type ModelUsageRecorder = (input: {
  invocationId: string
  providerModel: string
  response?: unknown
  measuredAt?: Date
  traceId?: string | null
  runId?: string | null
}) => Promise<void>

type ModelUsageContext = Omit<Parameters<ModelUsageRecorder>[0], "response">

export class UsageServiceError extends Error {
  constructor(
    readonly code:
      | "usage_record_failed"
      | "usage_idempotency_conflict"
      | "usage_summary_failed",
    readonly databaseCode?: string
  ) {
    super(code)
    this.name = "UsageServiceError"
  }
}

export function createModelUsageRecorder(input: {
  supabase: unknown | (() => unknown)
  companyId: string
  actorUserId: string
  sourceOperation: string
  workflowRunId?: string | null
}): ModelUsageRecorder {
  return async (invocation) => {
    const measurement = normalizeProviderUsage({
      providerModel: invocation.providerModel,
      response: invocation.response,
      measuredAt: invocation.measuredAt,
    })
    const idempotencyKey = digest(
      [
        "usage-v1",
        input.companyId,
        input.sourceOperation,
        invocation.invocationId,
      ].join("\u0000")
    )
    const supabase =
      typeof input.supabase === "function" ? input.supabase() : input.supabase
    const { data, error } = await (supabase as UsageRpcClient).rpc(
      "record_provider_usage_v1",
      {
        p_company_id: input.companyId,
        p_recorded_by: input.actorUserId,
        p_source_operation: input.sourceOperation,
        p_provider: measurement.provider,
        p_model: measurement.model,
        p_measured_at: measurement.measuredAt,
        p_completeness: measurement.completeness,
        p_metrics: measurement.metrics,
        p_idempotency_key: idempotencyKey,
        p_workflow_run_id: input.workflowRunId ?? null,
        p_trace_id: invocation.traceId ?? null,
        p_run_id: invocation.runId ?? null,
      }
    )
    if (error) {
      throw new UsageServiceError(
        error.message.includes("usage_idempotency_conflict")
          ? "usage_idempotency_conflict"
          : "usage_record_failed",
        error.code
      )
    }
    providerUsageRecordResultSchema.parse(data)
  }
}

export async function invokeModelWithUsage<T>(input: {
  invoke: () => Promise<T>
  recordUsage?: ModelUsageRecorder
  usage: ModelUsageContext
  usageResponse?: (response: T) => unknown
}): Promise<T> {
  let responseReceived = false

  try {
    const response = await input.invoke()
    responseReceived = true
    await input.recordUsage?.({
      ...input.usage,
      response: input.usageResponse ? input.usageResponse(response) : response,
    })
    return response
  } catch (error) {
    if (!responseReceived) {
      await input.recordUsage?.({ ...input.usage, response: null })
    }
    throw error
  }
}

export async function getCompanyUsageSummary(input: {
  supabase: unknown
  companyId: string
  periodStart: string
  periodEnd: string
}): Promise<CompanyUsageSummary> {
  const parsed = usageSummaryRequestSchema.parse({
    companyId: input.companyId,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
  })
  const { data, error } = await (input.supabase as UsageRpcClient).rpc(
    "get_company_usage_summary_v1",
    {
      p_company_id: parsed.companyId,
      p_period_start: parsed.periodStart,
      p_period_end: parsed.periodEnd,
    }
  )
  if (error) {
    throw new UsageServiceError("usage_summary_failed", error.code)
  }
  return companyUsageSummarySchema.parse(data)
}

function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex")
}
