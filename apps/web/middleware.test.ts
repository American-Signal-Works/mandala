import { createServerClient } from "@supabase/ssr"
import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { middleware } from "./middleware"

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(),
}))

const createServerClientMock = vi.mocked(createServerClient)

describe("middleware auth routing", () => {
  beforeEach(() => {
    createServerClientMock.mockReset()
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co")
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key")
  })

  it("allows the post-callback success screen before middleware can observe the session cookie", async () => {
    mockUser(null)

    const response = await middleware(
      new NextRequest("https://usebackdesk.com/login?auth=success")
    )

    expect(response.headers.get("location")).toBeNull()
  })

  it("still redirects unauthenticated app routes to sign in", async () => {
    mockUser(null)

    const response = await middleware(
      new NextRequest("https://usebackdesk.com/")
    )

    expect(response.headers.get("location")).toBe(
      "https://usebackdesk.com/login"
    )
  })
})

function mockUser(user: { id: string } | null) {
  createServerClientMock.mockReturnValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user },
        error: null,
      }),
    },
  } as never)
}
