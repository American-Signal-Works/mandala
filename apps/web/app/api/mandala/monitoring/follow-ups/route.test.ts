import { beforeEach, describe, expect, it, vi } from "vitest"
import { scheduleFollowUp } from "@/lib/mandala/monitoring"
import { getCompanyMembership } from "@/lib/mandala/workflows"
import { authenticateRequest } from "@/lib/supabase/request"
import { POST } from "./route"

vi.mock("@/lib/supabase/request", () => ({ authenticateRequest: vi.fn() }))
vi.mock("@/lib/mandala/workflows", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/mandala/workflows")>()),
  getCompanyMembership: vi.fn(),
}))
vi.mock("@/lib/mandala/monitoring", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/mandala/monitoring")>()),
  SupabaseFollowUpScheduler: vi.fn(),
  scheduleFollowUp: vi.fn(),
}))

const companyId = "20000000-0000-4000-8000-000000000001"
const userId = "10000000-0000-4000-8000-000000000001"
const auth = { authMode: "bearer", supabase: {}, user: { id: userId } }

describe("follow-up scheduling route", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateRequest).mockResolvedValue(auth as never)
    vi.mocked(getCompanyMembership).mockResolvedValue({ role: "admin" })
    vi.mocked(scheduleFollowUp).mockResolvedValue({} as never)
  })

  it("requires admin membership and returns private no-store", async () => {
    const response = await POST(jsonRequest({ companyId }))
    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    expect(scheduleFollowUp).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: userId, request: { companyId } })
    )
  })

  it("blocks members before scheduling", async () => {
    vi.mocked(getCompanyMembership).mockResolvedValue({ role: "member" })
    const response = await POST(jsonRequest({ companyId }))
    expect(response.status).toBe(403)
    expect(scheduleFollowUp).not.toHaveBeenCalled()
  })
})

function jsonRequest(body: unknown) {
  return new Request("http://localhost/api/mandala/monitoring/follow-ups", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}
