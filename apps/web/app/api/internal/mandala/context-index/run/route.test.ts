import { beforeEach, describe, expect, it, vi } from "vitest"
import { prepareContextIndexMaintenance } from "@/actions/admin/context-index-maintenance"
import { POST } from "./route"

vi.mock("@/actions/admin/context-index-maintenance", () => ({
  prepareContextIndexMaintenance: vi.fn(),
}))

const secret = "context-index-worker-secret-at-least-32-characters"
const prepare = vi.fn()

describe("Context index internal worker", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv("CONTEXT_INDEX_WORKER_SECRET", secret)
    prepare.mockResolvedValue({
      recoveredCount: 0,
      deadLetteredCount: 0,
      preparedAt: "2026-07-16T20:00:00.000Z",
    })
    vi.mocked(prepareContextIndexMaintenance).mockImplementation(prepare)
  })

  it("rejects missing credentials and caller-supplied scope", async () => {
    const unauthorized = await POST(request())
    expect(unauthorized.status).toBe(401)
    expect(prepareContextIndexMaintenance).not.toHaveBeenCalled()

    const scoped = await POST(
      request(secret, { companyId: "20000000-0000-4000-8000-000000000001" })
    )
    expect(scoped.status).toBe(400)
    expect(prepareContextIndexMaintenance).not.toHaveBeenCalled()
  })

  it("runs fixed bounded preparation and reports the disabled provider", async () => {
    const response = await POST(request(secret))

    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    expect(prepareContextIndexMaintenance).toHaveBeenCalledOnce()
    await expect(response.json()).resolves.toMatchObject({
      batch: { claimed: 0 },
      providerOperational: false,
    })
  })
})

function request(workerSecret?: string, body?: unknown) {
  return new Request(
    "http://localhost/api/internal/mandala/context-index/run",
    {
      method: "POST",
      headers: workerSecret
        ? {
            authorization: `Bearer ${workerSecret}`,
            ...(body === undefined
              ? {}
              : { "content-type": "application/json" }),
          }
        : undefined,
      body: body === undefined ? undefined : JSON.stringify(body),
    }
  )
}
