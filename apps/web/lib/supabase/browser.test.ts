import { beforeEach, describe, expect, it, vi } from "vitest"

import { createBrowserClient } from "@supabase/ssr"
import { createClient } from "./browser"

vi.mock("@supabase/ssr", () => ({
  createBrowserClient: vi.fn(() => ({})),
}))

const createBrowserClientMock = vi.mocked(createBrowserClient)

describe("browser Supabase client", () => {
  beforeEach(() => {
    createBrowserClientMock.mockClear()
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co")
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key")
  })

  it("leaves callback URL exchange to the auth callback route", () => {
    createClient()

    expect(createBrowserClientMock).toHaveBeenCalledWith(
      "https://project.supabase.co",
      "anon-key",
      {
        auth: {
          detectSessionInUrl: false,
          flowType: "pkce",
        },
      }
    )
  })
})
