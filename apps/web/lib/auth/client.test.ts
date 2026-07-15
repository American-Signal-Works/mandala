import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  confirmCurrentSession,
  requestEmailMagicLink,
  requestOAuthSignIn,
  signOutCurrentSession,
} from "./client"
import { createClient } from "@/lib/supabase/browser"

vi.mock("@/lib/supabase/browser", () => ({
  createClient: vi.fn(),
}))

const createClientMock = vi.mocked(createClient)

describe("auth client helpers", () => {
  beforeEach(() => {
    createClientMock.mockReset()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it("returns errors instead of throwing when magic link requests fail at the network layer", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("fetch failed")))

    const result = await requestEmailMagicLink("person@example.com")

    expect(result.error).toBeInstanceOf(Error)
    expect(result.error?.message).toBe("Authentication email request failed.")
  })

  it("requests magic links through the same-origin endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ accepted: true }), { status: 202 })
    )
    vi.stubGlobal("fetch", fetchMock)

    const result = await requestEmailMagicLink("person@example.com", {
      postAuthPath: "/invitation/complete",
      shouldCreateUser: true,
    })

    expect(fetchMock).toHaveBeenCalledWith("/api/auth/magic-link", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "person@example.com",
        postAuthPath: "/invitation/complete",
        shouldCreateUser: true,
      }),
    })
    expect(createClientMock).not.toHaveBeenCalled()
    expect(result).toEqual({ data: { accepted: true }, error: null })
  })

  it("starts Google sign-on through Supabase OAuth", async () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://mandala.md")
    const signInWithOAuth = vi.fn().mockResolvedValue({
      data: { url: "https://provider.example.com" },
      error: null,
    })
    createClientMock.mockReturnValue({
      auth: {
        signInWithOAuth,
      },
    } as never)

    await requestOAuthSignIn("google")

    expect(signInWithOAuth).toHaveBeenCalledWith({
      provider: "google",
      options: {
        redirectTo:
          "https://mandala.md/callback?next=%2Flogin%3Fauth%3Dsuccess&method=google",
      },
    })
  })

  it("requests email scope for Microsoft sign-on", async () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://mandala.md")
    const signInWithOAuth = vi.fn().mockResolvedValue({
      data: { url: "https://provider.example.com" },
      error: null,
    })
    createClientMock.mockReturnValue({
      auth: {
        signInWithOAuth,
      },
    } as never)

    await requestOAuthSignIn("azure")

    expect(signInWithOAuth).toHaveBeenCalledWith({
      provider: "azure",
      options: {
        redirectTo:
          "https://mandala.md/callback?next=%2Flogin%3Fauth%3Dsuccess&method=microsoft",
        scopes: "email",
      },
    })
  })

  it("returns errors instead of throwing when OAuth start fails at the network layer", async () => {
    createClientMock.mockReturnValue({
      auth: {
        signInWithOAuth: vi.fn().mockRejectedValue(new Error("fetch failed")),
      },
    } as never)

    const result = await requestOAuthSignIn("google")

    expect(result.error).toBeInstanceOf(Error)
    expect(result.error?.message).toBe("fetch failed")
  })

  it("returns errors instead of throwing when sign-out fails at the network layer", async () => {
    createClientMock.mockReturnValue({
      auth: {
        signOut: vi.fn().mockRejectedValue(new Error("fetch failed")),
      },
    } as never)

    const result = await signOutCurrentSession()

    expect(result.error).toBeInstanceOf(Error)
    expect(result.error?.message).toBe("fetch failed")
  })

  it("confirms the current user before showing authentication success", async () => {
    const getUser = vi.fn().mockResolvedValue({
      data: { user: { id: "user_1" } },
      error: null,
    })
    createClientMock.mockReturnValue({ auth: { getUser } } as never)

    const result = await confirmCurrentSession()

    expect(getUser).toHaveBeenCalledTimes(1)
    expect(result.data.user).toMatchObject({ id: "user_1" })
  })

  it("fails closed when session confirmation throws", async () => {
    createClientMock.mockReturnValue({
      auth: {
        getUser: vi.fn().mockRejectedValue(new Error("fetch failed")),
      },
    } as never)

    const result = await confirmCurrentSession()

    expect(result.data.user).toBeNull()
    expect(result.error?.message).toBe("fetch failed")
  })
})
