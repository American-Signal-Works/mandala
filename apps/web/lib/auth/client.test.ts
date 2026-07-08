import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  requestEmailMagicLink,
  requestOAuthSignIn,
  signOutCurrentSession,
} from "./client"
import { createClient } from "@/lib/supabase/browser"
import { createClient as createSupabaseClient } from "@supabase/supabase-js"

vi.mock("@/lib/supabase/browser", () => ({
  createClient: vi.fn(),
}))

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(),
}))

const createClientMock = vi.mocked(createClient)
const createSupabaseClientMock = vi.mocked(createSupabaseClient)

describe("auth client helpers", () => {
  beforeEach(() => {
    createClientMock.mockReset()
    createSupabaseClientMock.mockReset()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("returns errors instead of throwing when magic link requests fail at the network layer", async () => {
    createSupabaseClientMock.mockReturnValue({
      auth: {
        signInWithOtp: vi.fn().mockRejectedValue(new Error("fetch failed")),
      },
    } as never)

    const result = await requestEmailMagicLink("person@example.com")

    expect(result.error).toBeInstanceOf(Error)
    expect(result.error?.message).toBe("fetch failed")
  })

  it("requests email magic links with callback and sign-up intent", async () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://mandala.md")
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co")
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key")
    const signInWithOtp = vi.fn().mockResolvedValue({
      data: {},
      error: null,
    })
    createSupabaseClientMock.mockReturnValue({
      auth: {
        signInWithOtp,
      },
    } as never)

    await requestEmailMagicLink("person@example.com", {
      shouldCreateUser: true,
    })

    expect(signInWithOtp).toHaveBeenCalledWith({
      email: "person@example.com",
      options: {
        emailRedirectTo:
          "https://mandala.md/callback?next=%2Flogin%3Fauth%3Dsuccess&method=email",
        shouldCreateUser: true,
      },
    })
    expect(createSupabaseClientMock).toHaveBeenCalledWith(
      "https://project.supabase.co",
      "anon-key",
      {
        auth: {
          autoRefreshToken: false,
          detectSessionInUrl: false,
          flowType: "implicit",
          persistSession: false,
        },
      }
    )
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
})
