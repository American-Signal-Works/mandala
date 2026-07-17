import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  prepare: vi.fn(),
  runBatch: vi.fn(),
  health: vi.fn(),
  rpc: vi.fn(),
}))

vi.mock("server-only", () => ({}))
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ rpc: mocks.rpc }),
}))
vi.mock("@/lib/mandala/context/supermemory-provider", () => ({
  createSupermemoryIndexProviderFromEnvironment: () => ({
    provider: "supermemory",
    health: mocks.health,
  }),
}))
vi.mock("@/lib/mandala/context/indexing", () => ({
  SupabaseContextIndexRepository: class {
    prepare = mocks.prepare
  },
  createContextIndexProviderResolver: () => vi.fn(),
  runContextIndexBatch: mocks.runBatch,
}))

import { runContextIndexMaintenance } from "./context-index-maintenance"

const checkedAt = "2026-07-17T07:30:00.000Z"

describe("Context index maintenance composition", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.prepare.mockResolvedValue({ recoveredCount: 0 })
    mocks.runBatch.mockResolvedValue({ claimed: 0 })
    mocks.rpc
      .mockResolvedValueOnce({ data: { reserved: true }, error: null })
      .mockResolvedValueOnce({ data: {}, error: null })
    mocks.health.mockResolvedValue({
      provider: "supermemory",
      scope: {
        companyId: "00000000-0000-4000-8000-000000000000",
        workspaceScopeId: "00000000-0000-4000-8000-000000000000",
      },
      status: "healthy",
      checkedAt,
      detailCode: "provider_ready",
    })
  })

  it("records a live health probe before claiming bounded work", async () => {
    await expect(runContextIndexMaintenance()).resolves.toMatchObject({
      providerOperational: true,
      batch: { claimed: 0 },
    })
    expect(mocks.rpc).toHaveBeenNthCalledWith(
      1,
      "reserve_context_provider_health_v1",
      expect.objectContaining({ p_now: expect.any(String) })
    )
    expect(mocks.rpc).toHaveBeenNthCalledWith(
      2,
      "record_context_provider_health_v1",
      expect.objectContaining({
        p_status: "healthy",
        p_detail_code: "provider_ready",
      })
    )
    expect(mocks.rpc.mock.invocationCallOrder[1]).toBeLessThan(
      mocks.prepare.mock.invocationCallOrder[0]!
    )
    expect(mocks.runBatch).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 200, concurrency: 20 })
    )
  })

  it("records unhealthy credentials and refuses to claim provider work", async () => {
    mocks.health.mockResolvedValueOnce({
      provider: "supermemory",
      scope: {
        companyId: "00000000-0000-4000-8000-000000000000",
        workspaceScopeId: "00000000-0000-4000-8000-000000000000",
      },
      status: "unavailable",
      checkedAt,
      detailCode: "provider_unauthorized",
    })

    await expect(runContextIndexMaintenance()).rejects.toThrow(
      "context_provider_not_operational"
    )
    expect(mocks.rpc).toHaveBeenCalledTimes(2)
    expect(mocks.prepare).not.toHaveBeenCalled()
    expect(mocks.runBatch).not.toHaveBeenCalled()
  })

  it("does not call the provider without a reserved request slot", async () => {
    mocks.rpc.mockReset()
    mocks.rpc.mockResolvedValueOnce({
      data: { reserved: false },
      error: null,
    })

    await expect(runContextIndexMaintenance()).rejects.toThrow(
      "context_provider_rate_limited"
    )
    expect(mocks.health).not.toHaveBeenCalled()
    expect(mocks.prepare).not.toHaveBeenCalled()
    expect(mocks.runBatch).not.toHaveBeenCalled()
  })
})
