import { beforeEach, describe, expect, it, vi } from "vitest"

import { DELETE, POST } from "./route"
import {
  encodePendingAuthSession,
  PENDING_AUTH_COOKIE,
} from "@/lib/auth/pending-session"
import { createClient } from "@/lib/supabase/server"

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}))

const createClientMock = vi.mocked(createClient)

describe("session replacement route", () => {
  beforeEach(() => {
    createClientMock.mockReset()
    vi.stubEnv(
      "AUTH_PENDING_SESSION_SECRET",
      "pending-session-test-secret-value-32-bytes"
    )
  })

  it("requires a same-origin explicit confirmation", async () => {
    const response = await POST(
      new Request("https://mandala.md/api/auth/session/replacement", {
        method: "POST",
      })
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ status: "forbidden" })
    expect(createClientMock).not.toHaveBeenCalled()
  })

  it("replaces the session only after confirmation and returns a safe continuation", async () => {
    const pending = encodePendingAuthSession({
      credential: { kind: "code", value: "one-time-code" },
      continuation: "/login?auth=success",
      version: 1,
    })
    createClientMock.mockResolvedValue({
      auth: {
        exchangeCodeForSession: vi.fn().mockResolvedValue({ error: null }),
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "replacement_user" } },
          error: null,
        }),
        verifyOtp: vi.fn(),
      },
    } as never)

    const response = await POST(
      new Request("https://mandala.md/api/auth/session/replacement", {
        method: "POST",
        headers: {
          cookie: `${PENDING_AUTH_COOKIE}=${pending}`,
          origin: "https://mandala.md",
        },
      })
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      continuation: "/login?auth=success",
      status: "session_replaced",
    })
    expect(response.headers.get("set-cookie")).toContain(
      "mandala-auth-pending=;"
    )
    expect(response.headers.get("set-cookie")).toContain(
      "Path=/api/auth/session/replacement"
    )
  })

  it("can cancel without exchanging the staged credential", async () => {
    const response = await DELETE(
      new Request("https://mandala.md/api/auth/session/replacement", {
        method: "DELETE",
        headers: { origin: "https://mandala.md" },
      })
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      status: "session_replacement_cancelled",
    })
    expect(createClientMock).not.toHaveBeenCalled()
  })
})
