import { beforeEach, describe, expect, it, vi } from "vitest"
import { getCompanyMembership } from "@/lib/mandala/workflows"
import { authenticateRequest } from "@/lib/supabase/request"
import { POST } from "./route"

vi.mock("@/lib/supabase/request", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase/request")>()),
  authenticateRequest: vi.fn(),
}))
vi.mock("@/lib/mandala/workflows", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/mandala/workflows")>()),
  getCompanyMembership: vi.fn(),
}))

const companyId = "a2000000-0000-4000-8000-000000000001"
const userId = "a1000000-0000-4000-8000-000000000001"
const rpc = vi.fn()
const auth = {
  authMode: "bearer",
  cliSession: {
    managed: true,
    sessionId: "a3000000-0000-4000-8000-000000000001",
    selectedCompanyId: companyId,
    scopes: ["workspace:control"],
  },
  supabase: { rpc },
  user: { id: userId },
}
const snapshot = {
  schemaVersion: 1,
  mode: "sandbox",
  ephemeral: true,
  companyId,
  createdAt: "2026-07-16T04:00:00.000Z",
  dataAnchorAt: "2026-07-15",
  recordCount: 82_166,
  candidateCount: 1,
  sources: [],
  candidates: [],
}

describe("real-data Sandbox session route", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateRequest).mockResolvedValue(auth as never)
    vi.mocked(getCompanyMembership).mockResolvedValue({ role: "viewer" })
    rpc.mockResolvedValue({ data: snapshot, error: null })
  })

  it("reads a tenant-scoped snapshot without caching", async () => {
    const response = await POST(jsonRequest({ companyId, candidateLimit: 10 }))
    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    expect(getCompanyMembership).toHaveBeenCalledWith({
      supabase: auth.supabase,
      companyId,
      userId,
    })
    expect(rpc).toHaveBeenCalledWith("get_sandbox_workspace_snapshot_v1", {
      p_company_id: companyId,
      p_candidate_limit: 10,
    })
    expect(await response.json()).toMatchObject({
      mode: "sandbox",
      ephemeral: true,
      companyId,
      sessionId: expect.any(String),
    })
  })

  it("rejects unauthenticated and unauthorized requests", async () => {
    vi.mocked(authenticateRequest).mockResolvedValueOnce(null)
    expect((await POST(jsonRequest({ companyId }))).status).toBe(401)

    vi.mocked(getCompanyMembership).mockResolvedValueOnce(null)
    expect((await POST(jsonRequest({ companyId }))).status).toBe(403)
    expect(rpc).not.toHaveBeenCalled()
  })

  it("rejects a CLI token bound to another workspace", async () => {
    vi.mocked(authenticateRequest).mockResolvedValueOnce({
      ...auth,
      cliSession: {
        ...auth.cliSession,
        selectedCompanyId: "a2000000-0000-4000-8000-000000000099",
      },
    } as never)
    expect((await POST(jsonRequest({ companyId }))).status).toBe(403)
    expect(rpc).not.toHaveBeenCalled()
  })

  it("rejects invalid and unrestricted database responses", async () => {
    expect((await POST(jsonRequest({ companyId: "invalid" }))).status).toBe(400)

    rpc.mockResolvedValueOnce({
      data: { ...snapshot, unrestrictedPayload: { secret: true } },
      error: null,
    })
    const response = await POST(jsonRequest({ companyId }))
    expect(response.status).toBe(502)
    expect(await response.json()).toEqual({ error: "sandbox_snapshot_invalid" })
  })
})

function jsonRequest(body: unknown) {
  return new Request("http://localhost/api/mandala/sandbox/sessions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}
