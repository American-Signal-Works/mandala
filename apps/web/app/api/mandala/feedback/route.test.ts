import { beforeEach, describe, expect, it, vi } from "vitest"
import { captureRecommendationFeedback } from "@/lib/mandala/feedback"
import { getCompanyMembership } from "@/lib/mandala/workflows"
import { authenticateRequest } from "@/lib/supabase/request"
import { POST } from "./route"

vi.mock("@/lib/supabase/request", () => ({ authenticateRequest: vi.fn() }))
vi.mock("@/lib/mandala/workflows", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/mandala/workflows")>()),
  getCompanyMembership: vi.fn(),
}))
vi.mock("@/lib/mandala/feedback", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/mandala/feedback")>()),
  captureRecommendationFeedback: vi.fn(),
  SupabaseFeedbackRepository: vi.fn(),
}))
vi.mock("@/lib/mandala/memory", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/mandala/memory")>()),
  SupabasePostgresMemoryProvider: vi.fn(),
}))

const companyId = "20000000-0000-4000-8000-000000000001"
const userId = "10000000-0000-4000-8000-000000000001"
const auth = { authMode: "bearer", supabase: {}, user: { id: userId } }

describe("feedback route", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateRequest).mockResolvedValue(auth as never)
    vi.mocked(getCompanyMembership).mockResolvedValue({ role: "member" })
    vi.mocked(captureRecommendationFeedback).mockResolvedValue({
      feedback: {} as never,
      memoryCandidateId: null,
      memoryCandidateStatus: "not_requested",
    })
  })

  it("authenticates, authorizes a contributor, and never caches", async () => {
    const response = await POST(jsonRequest({ companyId }))
    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    expect(captureRecommendationFeedback).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: userId, request: { companyId } })
    )
  })

  it("rejects unauthenticated and viewer writes", async () => {
    vi.mocked(authenticateRequest).mockResolvedValueOnce(null)
    expect((await POST(jsonRequest({ companyId }))).status).toBe(401)
    vi.mocked(getCompanyMembership).mockResolvedValueOnce({ role: "viewer" })
    expect((await POST(jsonRequest({ companyId }))).status).toBe(403)
    expect(captureRecommendationFeedback).not.toHaveBeenCalled()
  })

  it("prevents members from creating memory scoped to another user", async () => {
    const response = await POST(
      jsonRequest({
        companyId,
        memorySuggestion: {
          applicability: {
            userId: "10000000-0000-4000-8000-000000000002",
          },
        },
      })
    )
    expect(response.status).toBe(403)
    expect(captureRecommendationFeedback).not.toHaveBeenCalled()
  })
})

function jsonRequest(body: unknown) {
  return new Request("http://localhost/api/mandala/feedback", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}
