import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  forgetGovernedMemory,
  exportGovernedMemory,
  retrieveGovernedMemory,
  reviewMemoryCandidate,
} from "@/lib/mandala/memory"
import { getCompanyMembership } from "@/lib/mandala/workflows"
import { authenticateRequest } from "@/lib/supabase/request"
import { DELETE, GET, POST } from "./route"
import { GET as EXPORT } from "./export/route"

vi.mock("@/lib/supabase/request", () => ({ authenticateRequest: vi.fn() }))
vi.mock("@/lib/mandala/workflows", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/mandala/workflows")>()),
  getCompanyMembership: vi.fn(),
}))
vi.mock("@/lib/mandala/memory", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/mandala/memory")>()),
  SupabasePostgresMemoryProvider: vi.fn(),
  retrieveGovernedMemory: vi.fn(),
  reviewMemoryCandidate: vi.fn(),
  forgetGovernedMemory: vi.fn(),
  exportGovernedMemory: vi.fn(),
}))

const companyId = "20000000-0000-4000-8000-000000000001"
const userId = "10000000-0000-4000-8000-000000000001"
const auth = { authMode: "bearer", supabase: {}, user: { id: userId } }

describe("memory routes", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateRequest).mockResolvedValue(auth as never)
    vi.mocked(getCompanyMembership).mockResolvedValue({ role: "admin" })
    vi.mocked(retrieveGovernedMemory).mockResolvedValue({
      items: [],
      provider: "test",
    })
    vi.mocked(reviewMemoryCandidate).mockResolvedValue({} as never)
    vi.mocked(forgetGovernedMemory).mockResolvedValue({
      id: "40000000-0000-4000-8000-000000000001",
      companyId,
      status: "forgotten",
      forgottenAt: "2026-07-14T00:00:00.000Z",
    })
    vi.mocked(exportGovernedMemory).mockResolvedValue({
      items: [],
      exportedAt: "2026-07-14T00:00:00.000Z",
    })
  })

  it("allows members to retrieve bounded memory with no-store", async () => {
    vi.mocked(getCompanyMembership).mockResolvedValue({ role: "member" })
    const response = await GET(
      new Request(
        `http://localhost/api/mandala/memory?companyId=${companyId}&maxResults=5&asOf=2020-01-01T00:00:00.000Z`
      )
    )
    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    expect(retrieveGovernedMemory).toHaveBeenCalledWith(
      expect.objectContaining({
        request: expect.objectContaining({ companyId, maxResults: "5" }),
      })
    )
    expect(
      vi.mocked(retrieveGovernedMemory).mock.calls[0]?.[0].request
    ).not.toHaveProperty("asOf")
  })

  it("requires an admin or owner to review or forget memory", async () => {
    vi.mocked(getCompanyMembership).mockResolvedValue({ role: "member" })
    expect((await POST(jsonRequest("POST", { companyId }))).status).toBe(403)
    expect((await DELETE(jsonRequest("DELETE", { companyId }))).status).toBe(
      403
    )
    expect(reviewMemoryCandidate).not.toHaveBeenCalled()
    expect(forgetGovernedMemory).not.toHaveBeenCalled()
  })

  it("prevents members from reading another user's scoped memory", async () => {
    vi.mocked(getCompanyMembership).mockResolvedValue({ role: "member" })
    const response = await GET(
      new Request(
        `http://localhost/api/mandala/memory?companyId=${companyId}&userId=10000000-0000-4000-8000-000000000002`
      )
    )
    expect(response.status).toBe(403)
    expect(retrieveGovernedMemory).not.toHaveBeenCalled()
  })

  it("restricts company memory export to admins and owners", async () => {
    const url = `http://localhost/api/mandala/memory/export?companyId=${companyId}`
    const response = await EXPORT(new Request(url))
    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("private, no-store")

    vi.mocked(getCompanyMembership).mockResolvedValueOnce({ role: "member" })
    expect((await EXPORT(new Request(url))).status).toBe(403)
  })
})

function jsonRequest(method: string, body: unknown) {
  return new Request("http://localhost/api/mandala/memory", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}
