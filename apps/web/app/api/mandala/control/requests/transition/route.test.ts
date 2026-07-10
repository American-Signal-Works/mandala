import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  classifyWorkflowRpcError,
  transitionWorkflowControlRequestRpc,
} from "@/lib/mandala/workflows"
import { authenticateRequest } from "@/lib/supabase/request"
import { POST } from "./route"

vi.mock("@/lib/supabase/request", () => ({ authenticateRequest: vi.fn() }))
vi.mock("@/lib/mandala/workflows", () => ({
  classifyWorkflowRpcError: vi.fn(),
  transitionWorkflowControlRequestRpc: vi.fn(),
}))

const companyId = "20000000-0000-4000-8000-000000000001"
const controlRequestId = "50000000-0000-4000-8000-000000000001"
const auth = {
  authMode: "bearer",
  supabase: {},
  user: { id: "10000000-0000-4000-8000-000000000001" },
}

describe("control request transition route", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateRequest).mockResolvedValue(auth as never)
    vi.mocked(transitionWorkflowControlRequestRpc).mockResolvedValue({
      id: controlRequestId,
      resolution_status: "executed",
    } as never)
  })

  it("transitions an authenticated actor control request", async () => {
    const response = await POST(
      request({ companyId, controlRequestId, resolutionStatus: "executed" })
    )

    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    expect(transitionWorkflowControlRequestRpc).toHaveBeenCalledWith({
      supabase: auth.supabase,
      companyId,
      controlRequestId,
      resolutionStatus: "executed",
    })
    await expect(response.json()).resolves.toMatchObject({
      request: { id: controlRequestId, resolution_status: "executed" },
    })
  })

  it("requires authentication", async () => {
    vi.mocked(authenticateRequest).mockResolvedValue(null)

    const response = await POST(
      request({ companyId, controlRequestId, resolutionStatus: "blocked" })
    )

    expect(response.status).toBe(401)
    expect(transitionWorkflowControlRequestRpc).not.toHaveBeenCalled()
  })

  it("does not expose a control request owned by another actor", async () => {
    vi.mocked(transitionWorkflowControlRequestRpc).mockRejectedValue(
      new Error("control_request_forbidden")
    )
    vi.mocked(classifyWorkflowRpcError).mockReturnValue({
      code: "control_request_forbidden",
      status: 403,
    })

    const response = await POST(
      request({ companyId, controlRequestId, resolutionStatus: "blocked" })
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error: "control_request_forbidden",
    })
  })
})

function request(body: unknown): Request {
  return new Request(
    "http://localhost/api/mandala/control/requests/transition",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost",
        authorization: "Bearer token",
      },
      body: JSON.stringify(body),
    }
  )
}
