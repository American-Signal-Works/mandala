import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { runSignalDispatchMaintenance } from "@/actions/admin/signal-dispatch"
import { GET, POST } from "./route"

vi.mock("@/actions/admin/signal-dispatch", () => ({
  runSignalDispatchMaintenance: vi.fn(),
}))

const cronSecret = "signal-cron-secret-0123456789abcdef"

describe("signal dispatch worker route", () => {
  beforeEach(() => {
    vi.stubEnv("CRON_SECRET", cronSecret)
    vi.mocked(runSignalDispatchMaintenance).mockResolvedValue({
      preparation: {
        changeWindowsProcessed: 2,
        changeDispatchesEnqueued: 1,
        scheduleDispatchesEnqueued: 0,
        reconciliationDispatchesEnqueued: 0,
        preparedAt: "2026-07-24T18:30:00.000Z",
      },
      batch: {
        claimed: 1,
        completed: 1,
        suppressed: 0,
        retryScheduled: 0,
        deadLettered: 0,
        leaseUnresolved: 0,
        results: [{ dispatchId: crypto.randomUUID(), status: "completed" }],
      },
    })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.clearAllMocks()
  })

  it("rejects unauthenticated requests", async () => {
    const response = await GET(
      new Request(
        "https://example.test/api/internal/mandala/signal-dispatch/run"
      )
    )

    expect(response.status).toBe(401)
    expect(runSignalDispatchMaintenance).not.toHaveBeenCalled()
  })

  it("accepts a Vercel cron GET with private no-store output", async () => {
    const response = await GET(request("GET"))

    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    expect(runSignalDispatchMaintenance).toHaveBeenCalledOnce()
  })

  it("accepts only an empty authenticated POST body", async () => {
    expect((await POST(request("POST", "{}"))).status).toBe(200)
    expect((await POST(request("POST", '{"force":true}'))).status).toBe(400)
    expect(runSignalDispatchMaintenance).toHaveBeenCalledOnce()
  })
})

function request(method: "GET" | "POST", body?: string) {
  return new Request(
    "https://example.test/api/internal/mandala/signal-dispatch/run",
    {
      method,
      headers: { authorization: `Bearer ${cronSecret}` },
      ...(body === undefined ? {} : { body }),
    }
  )
}
