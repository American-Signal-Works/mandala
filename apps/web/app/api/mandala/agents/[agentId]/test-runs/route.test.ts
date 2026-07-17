import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  recordAgentTestReadiness,
  runSyntheticAgentTest,
} from "@/lib/mandala/agents"
import { getCompanyMembership } from "@/lib/mandala/workflows"
import { authenticateRequest } from "@/lib/supabase/request"
import { POST } from "./route"

vi.mock("@/lib/supabase/request", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase/request")>()),
  authenticateRequest: vi.fn(),
}))
vi.mock("@/actions/admin/provider-usage", () => ({
  createServerModelUsageRecorder: vi.fn(() => vi.fn()),
}))
vi.mock("@/lib/mandala/agents", () => ({
  recordAgentTestReadiness: vi.fn(),
  runSyntheticAgentTest: vi.fn(),
}))
vi.mock("@/lib/mandala/workflows", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/lib/mandala/workflows")>()
  return { ...original, getCompanyMembership: vi.fn() }
})

const companyId = "20000000-0000-4000-8000-000000000001"
const agentId = "a0000000-0000-4000-8000-000000000001"
const userId = "10000000-0000-4000-8000-000000000001"

describe("POST /api/mandala/agents/[agentId]/test-runs", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateRequest).mockResolvedValue({
      authMode: "bearer",
      supabase: {},
      user: { id: userId },
    } as never)
  })

  it("requires authentication and an owner or admin role", async () => {
    vi.mocked(authenticateRequest).mockResolvedValueOnce(null)
    const unauthorized = await request()
    expect(unauthorized.status).toBe(401)

    vi.mocked(getCompanyMembership).mockResolvedValueOnce({ role: "member" })
    const forbidden = await request()
    expect(forbidden.status).toBe(403)
    expect(runSyntheticAgentTest).not.toHaveBeenCalled()
  })

  it("runs a bounded CLI sandbox test and returns the shared contract", async () => {
    vi.mocked(getCompanyMembership).mockResolvedValue({ role: "admin" })
    vi.mocked(runSyntheticAgentTest).mockResolvedValue({
      agentId,
      workflowRunId: "30000000-0000-4000-8000-000000000001",
      status: "waiting_for_approval",
      itemId: "33000000-0000-4000-8000-000000000001",
      dataset: { productCount: 1_200 },
      result: { execution: "deterministic" },
    })

    const response = await request("coffee-shop")

    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    await expect(response.json()).resolves.toMatchObject({
      agentId,
      status: "waiting_for_approval",
      dataset: { productCount: 1_200 },
    })
    expect(runSyntheticAgentTest).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId,
        request: { companyId, seed: "coffee-shop" },
        actorUserId: userId,
        clientSurface: "cli",
      })
    )
    expect(recordAgentTestReadiness).toHaveBeenCalledWith(
      expect.objectContaining({ companyId, agentId })
    )
  })
})

async function request(seed?: string) {
  return POST(
    new Request(`http://localhost/api/mandala/agents/${agentId}/test-runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ companyId, ...(seed ? { seed } : {}) }),
    }),
    { params: Promise.resolve({ agentId }) }
  )
}
