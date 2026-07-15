import { AIMessage } from "@langchain/core/messages"
import { describe, expect, it, vi } from "vitest"
import {
  createModelUsageRecorder,
  getCompanyUsageSummary,
  invokeModelWithUsage,
  UsageServiceError,
} from "./service"

const companyId = "10000000-0000-4000-8000-000000000001"
const workflowRunId = "20000000-0000-4000-8000-000000000001"

describe("usage service", () => {
  it("records successful and unavailable model invocations once", async () => {
    const recordUsage = vi.fn(async () => undefined)
    const response = { raw: new AIMessage("ok") }

    await expect(
      invokeModelWithUsage({
        invoke: async () => response,
        recordUsage,
        usage: {
          invocationId: "success",
          providerModel: "openai/gpt-5.4-mini",
        },
        usageResponse: (result) => result.raw,
      })
    ).resolves.toBe(response)

    const providerError = new Error("provider failed")
    await expect(
      invokeModelWithUsage({
        invoke: async () => {
          throw providerError
        },
        recordUsage,
        usage: {
          invocationId: "failure",
          providerModel: "openai/gpt-5.4-mini",
        },
      })
    ).rejects.toBe(providerError)

    expect(recordUsage).toHaveBeenNthCalledWith(1, {
      invocationId: "success",
      providerModel: "openai/gpt-5.4-mini",
      response: response.raw,
    })
    expect(recordUsage).toHaveBeenNthCalledWith(2, {
      invocationId: "failure",
      providerModel: "openai/gpt-5.4-mini",
      response: null,
    })
  })

  it("does not misreport a usage recorder failure as a provider failure", async () => {
    const recorderError = new Error("usage recorder failed")
    const recordUsage = vi.fn(async () => {
      throw recorderError
    })

    await expect(
      invokeModelWithUsage({
        invoke: async () => new AIMessage("ok"),
        recordUsage,
        usage: {
          invocationId: "success",
          providerModel: "openai/gpt-5.4-mini",
        },
      })
    ).rejects.toBe(recorderError)
    expect(recordUsage).toHaveBeenCalledTimes(1)
  })

  it("writes one redacted, digest-bound RPC payload", async () => {
    const rpc = vi.fn(async () => ({
      data: {
        id: "30000000-0000-4000-8000-000000000001",
        duplicate: false,
        completeness: "complete",
      },
      error: null,
    }))
    const record = createModelUsageRecorder({
      supabase: { rpc },
      companyId,
      actorUserId: "50000000-0000-4000-8000-000000000001",
      workflowRunId,
      sourceOperation: "mandala.work_item.question",
    })
    const response = new AIMessage({
      content: "model-output-canary",
      usage_metadata: {
        input_tokens: 5,
        output_tokens: 7,
        total_tokens: 12,
      },
    })

    await record({
      invocationId: "trace-1",
      providerModel: "openai/gpt-5.4-mini",
      response,
      traceId: "trace-1",
      runId: "run-1",
      measuredAt: new Date("2026-07-15T12:00:00.000Z"),
    })

    expect(rpc).toHaveBeenCalledWith(
      "record_provider_usage_v1",
      expect.objectContaining({
        p_company_id: companyId,
        p_recorded_by: "50000000-0000-4000-8000-000000000001",
        p_workflow_run_id: workflowRunId,
        p_provider: "openai",
        p_model: "gpt-5.4-mini",
        p_completeness: "complete",
        p_metrics: {
          input_tokens: 5,
          output_tokens: 7,
          total_tokens: 12,
          requests: 1,
        },
        p_idempotency_key: expect.stringMatching(/^[a-f0-9]{64}$/),
      })
    )
    expect(JSON.stringify(rpc.mock.calls)).not.toContain("model-output-canary")
  })

  it("uses a stable idempotency key and fails closed on conflicting reuse", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({
        data: {
          id: "30000000-0000-4000-8000-000000000001",
          duplicate: false,
          completeness: "unavailable",
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: null,
        error: { code: "23505", message: "usage_idempotency_conflict" },
      })
    const record = createModelUsageRecorder({
      supabase: { rpc },
      companyId,
      actorUserId: "50000000-0000-4000-8000-000000000001",
      sourceOperation: "mandala.control.intent.parse",
    })
    const invocation = {
      invocationId: "logical-invocation",
      providerModel: "openai/gpt-5.4-mini",
      response: null,
      measuredAt: new Date("2026-07-15T12:00:00.000Z"),
    }

    await record(invocation)
    await expect(record(invocation)).rejects.toEqual(
      expect.objectContaining<Partial<UsageServiceError>>({
        code: "usage_idempotency_conflict",
      })
    )
    expect(rpc.mock.calls[0]?.[1].p_idempotency_key).toBe(
      rpc.mock.calls[1]?.[1].p_idempotency_key
    )
  })

  it("returns a validated company summary", async () => {
    const rpc = vi.fn(async () => ({
      data: {
        companyId,
        periodStart: "2026-07-01T00:00:00+00:00",
        periodEnd: "2026-08-01T00:00:00+00:00",
        completeness: "current",
        eventCount: 1,
        completeEventCount: 1,
        partialEventCount: 0,
        unavailableEventCount: 0,
        unpricedMetricCount: 0,
        metrics: {
          inputTokens: 5,
          outputTokens: 7,
          totalTokens: 12,
          cachedInputTokens: 0,
          reasoningOutputTokens: 0,
          requests: 1,
        },
        costs: [
          {
            currency: "USD",
            amount: 0.000012,
            rateVersionIds: ["40000000-0000-4000-8000-000000000001"],
          },
        ],
      },
      error: null,
    }))

    await expect(
      getCompanyUsageSummary({
        supabase: { rpc },
        companyId,
        periodStart: "2026-07-01T00:00:00.000Z",
        periodEnd: "2026-08-01T00:00:00.000Z",
      })
    ).resolves.toMatchObject({ completeness: "current", eventCount: 1 })
  })
})
