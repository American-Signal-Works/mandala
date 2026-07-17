import { beforeEach, describe, expect, it, vi } from "vitest"
import { runContextIndexMaintenance } from "@/actions/admin/context-index-maintenance"
import { GET, POST } from "./route"

vi.mock("@/actions/admin/context-index-maintenance", () => ({
  runContextIndexMaintenance: vi.fn(),
}))

const secret = "context-index-worker-secret-at-least-32-characters"
const run = vi.fn()

describe("Context index internal worker", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv("CONTEXT_INDEX_WORKER_SECRET", secret)
    vi.stubEnv("CRON_SECRET", `${secret}-cron`)
    run.mockResolvedValue({
      preparation: {
        recoveredCount: 0,
        deadLetteredCount: 0,
        preparedAt: "2026-07-16T20:00:00.000Z",
      },
      batch: {
        claimed: 0,
        completed: 0,
        retryScheduled: 0,
        deadLettered: 0,
        providerProcessing: 0,
        reconciliationRequired: 0,
        leaseUnresolved: 0,
        results: [],
      },
      providerOperational: true,
    })
    vi.mocked(runContextIndexMaintenance).mockImplementation(run)
  })

  it("rejects missing credentials and caller-supplied scope", async () => {
    const unauthorized = await POST(request())
    expect(unauthorized.status).toBe(401)
    expect(runContextIndexMaintenance).not.toHaveBeenCalled()

    const scoped = await POST(
      request(secret, { companyId: "20000000-0000-4000-8000-000000000001" })
    )
    expect(scoped.status).toBe(400)
    expect(runContextIndexMaintenance).not.toHaveBeenCalled()
  })

  it("runs the fixed bounded worker and reports the operational provider", async () => {
    const response = await POST(request(secret))

    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    expect(runContextIndexMaintenance).toHaveBeenCalledOnce()
    await expect(response.json()).resolves.toMatchObject({
      batch: { claimed: 0 },
      providerOperational: true,
    })
  })

  it("accepts the Vercel cron secret only on an authenticated GET", async () => {
    const response = await GET(request(`${secret}-cron`, undefined, "GET"))
    expect(response.status).toBe(200)
    expect(runContextIndexMaintenance).toHaveBeenCalledOnce()
  })
})

function request(workerSecret?: string, body?: unknown, method = "POST") {
  return new Request(
    "http://localhost/api/internal/mandala/context-index/run",
    {
      method,
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
