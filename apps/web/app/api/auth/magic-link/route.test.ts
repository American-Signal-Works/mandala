// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest"

import { createClient } from "@/lib/supabase/server"
import { POST } from "./route"

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }))

const createClientMock = vi.mocked(createClient)
const endpoint = "https://mandala.test/api/auth/magic-link"

function request(body: unknown, origin = "https://mandala.test") {
  return new Request(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin,
    },
    body: JSON.stringify(body),
  })
}

describe("magic-link request route", () => {
  beforeEach(() => {
    createClientMock.mockReset()
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://mandala.test")
  })

  it("returns the same accepted response for known and unknown addresses", async () => {
    const signInWithOtp = vi
      .fn()
      .mockResolvedValueOnce({ data: {}, error: null })
      .mockResolvedValueOnce({
        data: null,
        error: { code: "otp_disabled", message: "Signups not allowed" },
      })
    createClientMock.mockResolvedValue({ auth: { signInWithOtp } } as never)

    const known = await POST(request({ email: "known@example.test" }))
    const unknown = await POST(request({ email: "unknown@example.test" }))

    expect(known.status).toBe(202)
    expect(unknown.status).toBe(202)
    await expect(known.json()).resolves.toEqual({ accepted: true })
    await expect(unknown.json()).resolves.toEqual({ accepted: true })
    expect(known.headers.get("cache-control")).toContain("no-store")
    expect(known.headers.get("set-cookie")).toContain(
      "mandala-auth-continuation="
    )
    expect(known.headers.get("set-cookie")).toContain("Path=/callback")
    expect(known.headers.get("set-cookie")).toContain("SameSite=lax")
  })

  it("keeps provider exceptions private", async () => {
    createClientMock.mockResolvedValue({
      auth: {
        signInWithOtp: vi.fn().mockRejectedValue(new Error("private detail")),
      },
    } as never)

    const response = await POST(request({ email: "person@example.test" }))

    expect(response.status).toBe(202)
    expect(await response.text()).not.toContain("private detail")
  })

  it("normalizes email and allowlists the post-auth continuation", async () => {
    const signInWithOtp = vi.fn().mockResolvedValue({ data: {}, error: null })
    createClientMock.mockResolvedValue({ auth: { signInWithOtp } } as never)

    await POST(
      request({
        email: " Person@Example.Test ",
        postAuthPath: "https://attacker.test/steal",
        shouldCreateUser: true,
      })
    )

    expect(signInWithOtp).toHaveBeenCalledWith({
      email: "person@example.test",
      options: {
        emailRedirectTo:
          "https://mandala.test/callback",
        shouldCreateUser: true,
      },
    })
  })

  it("rejects invalid input and cross-origin requests before contacting Auth", async () => {
    const signInWithOtp = vi.fn()
    createClientMock.mockResolvedValue({ auth: { signInWithOtp } } as never)

    const invalid = await POST(request({ email: "not-an-email" }))
    const crossOrigin = await POST(
      request({ email: "person@example.test" }, "https://attacker.test")
    )

    expect(invalid.status).toBe(400)
    expect(crossOrigin.status).toBe(403)
    expect(createClientMock).not.toHaveBeenCalled()
    expect(signInWithOtp).not.toHaveBeenCalled()
  })
})
