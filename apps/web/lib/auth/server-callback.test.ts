import { describe, expect, it, vi } from "vitest"

import { completeAuthCallback } from "./server-callback"

describe("server auth callback completion", () => {
  it("exchanges PKCE codes and confirms the server-visible user", async () => {
    const exchangeCodeForSession = vi.fn().mockResolvedValue({ error: null })
    const getUser = vi.fn().mockResolvedValue({
      data: { user: { id: "user_1" } },
      error: null,
    })

    const result = await completeAuthCallback(
      {
        auth: {
          exchangeCodeForSession,
          getUser,
          verifyOtp: vi.fn(),
        },
      } as never,
      { kind: "code", value: "one-time-code" }
    )

    expect(result).toMatchObject({ ok: true, user: { id: "user_1" } })
    expect(exchangeCodeForSession).toHaveBeenCalledWith("one-time-code")
    expect(getUser).toHaveBeenCalledTimes(1)
  })

  it("maps replayed exchanges without exposing the provider error", async () => {
    const result = await completeAuthCallback(
      {
        auth: {
          exchangeCodeForSession: vi.fn().mockResolvedValue({
            error: { code: "flow_state_not_found", message: "provider detail" },
          }),
          getUser: vi.fn(),
          verifyOtp: vi.fn(),
        },
      } as never,
      { kind: "code", value: "one-time-code" }
    )

    expect(result).toEqual({ ok: false, failure: "replayed" })
  })

  it("supports the legacy token-hash cutover on the server", async () => {
    const verifyOtp = vi.fn().mockResolvedValue({ error: null })
    const result = await completeAuthCallback(
      {
        auth: {
          exchangeCodeForSession: vi.fn(),
          getUser: vi.fn().mockResolvedValue({
            data: { user: { id: "user_1" } },
            error: null,
          }),
          verifyOtp,
        },
      } as never,
      { kind: "otp", type: "email", value: "one-time-token" }
    )

    expect(result.ok).toBe(true)
    expect(verifyOtp).toHaveBeenCalledWith({
      token_hash: "one-time-token",
      type: "email",
    })
  })
})
