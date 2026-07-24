import { beforeEach, describe, expect, it, vi } from "vitest"

import { GET } from "./route"
import { createClient } from "@/lib/supabase/server"

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}))

const createClientMock = vi.mocked(createClient)

describe("auth callback route", () => {
  beforeEach(() => {
    createClientMock.mockReset()
    vi.stubEnv(
      "AUTH_PENDING_SESSION_SECRET",
      "pending-session-test-secret-value-32-bytes"
    )
  })

  it("exchanges a PKCE code on the server and redirects after user confirmation", async () => {
    const exchangeCodeForSession = vi.fn().mockResolvedValue({ error: null })
    const getUser = vi
      .fn()
      .mockResolvedValueOnce({ data: { user: null }, error: null })
      .mockResolvedValueOnce({
        data: { user: { id: "user_1" } },
        error: null,
      })
    createClientMock.mockResolvedValue({
      auth: { exchangeCodeForSession, getUser, verifyOtp: vi.fn() },
    } as never)

    const response = await GET(
      new Request(
        "https://mandala.md/callback?code=one-time-code&next=%2Flogin%3Fauth%3Dsuccess"
      )
    )

    expect(response.status).toBe(303)
    expect(response.headers.get("location")).toBe(
      "https://mandala.md/login?auth=success"
    )
    expect(response.headers.get("cache-control")).toContain("no-store")
    expect(response.headers.get("referrer-policy")).toBe("no-referrer")
    expect(exchangeCodeForSession).toHaveBeenCalledWith("one-time-code")
  })

  it("restores an allowlisted email continuation from the scoped cookie", async () => {
    const exchangeCodeForSession = vi.fn().mockResolvedValue({ error: null })
    const getUser = vi
      .fn()
      .mockResolvedValueOnce({ data: { user: null }, error: null })
      .mockResolvedValueOnce({
        data: { user: { id: "user_1" } },
        error: null,
      })
    createClientMock.mockResolvedValue({
      auth: { exchangeCodeForSession, getUser, verifyOtp: vi.fn() },
    } as never)

    const response = await GET(
      new Request("https://mandala.md/callback?code=one-time-code", {
        headers: {
          cookie: "mandala-auth-continuation=%2Finvitation%2Fcomplete",
        },
      })
    )

    expect(response.headers.get("location")).toBe(
      "https://mandala.md/invitation/complete"
    )
    expect(response.headers.get("set-cookie")).toContain(
      "mandala-auth-continuation="
    )
    expect(response.headers.get("set-cookie")).toContain(
      "Expires=Thu, 01 Jan 1970 00:00:00 GMT"
    )
  })

  it("returns stable failures for missing and provider-failed callbacks", async () => {
    const missing = await GET(new Request("https://mandala.md/callback"))
    const providerFailed = await GET(
      new Request(
        "https://mandala.md/callback?error=access_denied&error_description=sensitive"
      )
    )

    expect(missing.headers.get("location")).toBe(
      "https://mandala.md/login?error=missing"
    )
    expect(providerFailed.headers.get("location")).toBe(
      "https://mandala.md/login?error=provider_failed"
    )
    expect(providerFailed.headers.get("location")).not.toContain("sensitive")
    expect(createClientMock).not.toHaveBeenCalled()
  })

  it("stages an opaque callback before replacing an existing session", async () => {
    createClientMock.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "current_user" } },
          error: null,
        }),
      },
    } as never)

    const response = await GET(
      new Request("https://mandala.md/callback?code=one-time-code")
    )

    expect(response.headers.get("location")).toBe(
      "https://mandala.md/login?error=session_replacement_required"
    )
    expect(response.headers.get("set-cookie")).toContain(
      "mandala-auth-pending="
    )
    expect(response.headers.get("set-cookie")).toContain("HttpOnly")
    expect(response.headers.get("set-cookie")).toContain(
      "Path=/api/auth/session/replacement"
    )
    expect(response.headers.get("set-cookie")).not.toContain("one-time-code")
  })
})
