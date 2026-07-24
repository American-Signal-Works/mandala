import { beforeEach, describe, expect, it, vi } from "vitest"

import { GET, POST } from "./route"
import { runConnectorSync } from "@/actions/admin/connector-sync"

vi.mock("@/actions/admin/connector-sync", () => ({
  runConnectorSync: vi.fn(),
}))

const WORKER_SECRET = "connector-sync-worker-secret-0123456789abcdef"
const CRON_SECRET = "vercel-cron-shared-secret-0123456789abcdef"

function request(input: { secret?: string; body?: string } = {}) {
  const headers = new Headers()
  if (input.secret) headers.set("authorization", `Bearer ${input.secret}`)
  return new Request(
    "https://mandala.test/api/internal/mandala/connector-sync/run",
    {
      method: "POST",
      headers,
      body: input.body ?? "",
    }
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv("CONNECTOR_SYNC_WORKER_SECRET", WORKER_SECRET)
  vi.stubEnv("CRON_SECRET", CRON_SECRET)
})

describe("connector-sync run route", () => {
  it("rejects requests without credentials", async () => {
    const response = await POST(request())
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: "unauthorized" })
    expect(runConnectorSync).not.toHaveBeenCalled()
  })

  it("rejects requests with the wrong secret", async () => {
    const response = await POST(
      request({ secret: "wrong-secret-but-also-32-bytes-long!!" })
    )
    expect(response.status).toBe(401)
    expect(runConnectorSync).not.toHaveBeenCalled()
  })

  it("rejects POST bodies that attempt to scope the run", async () => {
    const response = await POST(
      request({
        secret: WORKER_SECRET,
        body: JSON.stringify({ kinds: ["shiphero"] }),
      })
    )
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: "invalid_request" })
    expect(runConnectorSync).not.toHaveBeenCalled()
  })

  it("runs a slice with the worker secret", async () => {
    vi.mocked(runConnectorSync).mockResolvedValue({
      claimed: false,
      skippedAdapters: undefined,
    })
    const response = await POST(request({ secret: WORKER_SECRET }))
    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    expect(await response.json()).toEqual({ claimed: false })
  })

  it("accepts Vercel cron GET requests with CRON_SECRET", async () => {
    vi.mocked(runConnectorSync).mockResolvedValue({
      claimed: true,
      sourceKey: "trello",
      skippedAdapters: undefined,
    })
    const headers = new Headers({ authorization: `Bearer ${CRON_SECRET}` })
    const response = await GET(
      new Request(
        "https://mandala.test/api/internal/mandala/connector-sync/run",
        { headers }
      )
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      claimed: true,
      sourceKey: "trello",
    })
  })

  it("maps worker failures to an opaque 500", async () => {
    vi.mocked(runConnectorSync).mockRejectedValue(
      new Error("supabase exploded")
    )
    const response = await POST(request({ secret: WORKER_SECRET }))
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({
      error: "connector_sync_worker_failed",
    })
  })
})
