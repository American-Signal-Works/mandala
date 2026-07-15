import { beforeEach, describe, expect, it, vi } from "vitest"
import { getCompanyMembership } from "@/lib/mandala/workflows"
import { getCompanyUsageSummary } from "@/lib/mandala/usage"
import { authenticateRequest } from "@/lib/supabase/request"
import { GET } from "./route"

vi.mock("@/lib/supabase/request", () => ({ authenticateRequest: vi.fn() }))
vi.mock("@/lib/mandala/workflows", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/lib/mandala/workflows")>()
  return { ...original, getCompanyMembership: vi.fn() }
})
vi.mock("@/lib/mandala/usage", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/mandala/usage")>()
  return { ...original, getCompanyUsageSummary: vi.fn() }
})

const companyId = "10000000-0000-4000-8000-000000000001"
const auth = {
  authMode: "bearer",
  supabase: {},
  user: { id: "20000000-0000-4000-8000-000000000001" },
}

describe("usage summary route", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateRequest).mockResolvedValue(auth as never)
    vi.mocked(getCompanyMembership).mockResolvedValue({ role: "member" })
    vi.mocked(getCompanyUsageSummary).mockResolvedValue(summary())
  })

  it("requires authentication", async () => {
    vi.mocked(authenticateRequest).mockResolvedValue(null)
    const response = await GET(request())
    expect(response.status).toBe(401)
    expect(getCompanyMembership).not.toHaveBeenCalled()
  })

  it("rejects malformed or oversized periods", async () => {
    const response = await GET(
      request({ periodEnd: "2028-07-01T00:00:00.000Z" })
    )
    expect(response.status).toBe(400)
    expect(getCompanyMembership).not.toHaveBeenCalled()
  })

  it("denies cross-company reads before requesting a summary", async () => {
    vi.mocked(getCompanyMembership).mockResolvedValue(null)
    const response = await GET(request())
    expect(response.status).toBe(403)
    expect(getCompanyUsageSummary).not.toHaveBeenCalled()
  })

  it("returns a private, checked summary", async () => {
    const response = await GET(request())
    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    expect(response.headers.get("vary")).toBe("cookie, authorization")
    await expect(response.json()).resolves.toMatchObject({
      companyId,
      completeness: "current",
    })
    expect(getCompanyMembership).toHaveBeenCalledWith({
      supabase: auth.supabase,
      companyId,
      userId: auth.user.id,
    })
    expect(getCompanyUsageSummary).toHaveBeenCalledWith({
      supabase: auth.supabase,
      companyId,
      periodStart: "2026-07-01T00:00:00.000Z",
      periodEnd: "2026-08-01T00:00:00.000Z",
    })
  })
})

function request(overrides: Partial<{ periodEnd: string }> = {}) {
  const query = new URLSearchParams({
    companyId,
    periodStart: "2026-07-01T00:00:00.000Z",
    periodEnd: overrides.periodEnd ?? "2026-08-01T00:00:00.000Z",
  })
  return new Request(`http://localhost/api/mandala/usage/summary?${query}`)
}

function summary() {
  return {
    companyId,
    periodStart: "2026-07-01T00:00:00+00:00",
    periodEnd: "2026-08-01T00:00:00+00:00",
    completeness: "current" as const,
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
    costs: [],
  }
}
