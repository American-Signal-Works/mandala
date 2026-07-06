import { createServerClient } from "@supabase/ssr"
import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { middleware } from "./middleware"

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(),
}))

const createServerClientMock = vi.mocked(createServerClient)

function mockUser(user: { id: string } | null) {
  createServerClientMock.mockReturnValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user },
      }),
    },
  } as never)
}

function request(path: string) {
  return new NextRequest(new URL(path, "https://mandala.md"))
}

describe("middleware auth redirects", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co")
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key")
    createServerClientMock.mockReset()
  })

  it("redirects unauthenticated app routes to login", async () => {
    mockUser(null)

    const response = await middleware(request("/settings"))

    expect(response.headers.get("location")).toBe(
      "https://mandala.md/login"
    )
  })

  it("drops query params when redirecting unauthenticated app routes", async () => {
    mockUser(null)

    const response = await middleware(request("/settings?token=secret"))

    expect(response.headers.get("location")).toBe(
      "https://mandala.md/login"
    )
  })

  it("allows the callback success screen to render before the user cookie is observed", async () => {
    mockUser(null)

    const response = await middleware(request("/login?auth=success"))

    expect(response.headers.get("location")).toBeNull()
  })

  it("allows unauthenticated users to reach sign-up", async () => {
    mockUser(null)

    const response = await middleware(request("/sign-up"))

    expect(response.headers.get("location")).toBeNull()
  })

  it("redirects authenticated users away from plain login", async () => {
    mockUser({ id: "user_1" })

    const response = await middleware(request("/login"))

    expect(response.headers.get("location")).toBe("https://mandala.md/")
  })

  it("redirects authenticated users away from sign-up", async () => {
    mockUser({ id: "user_1" })

    const response = await middleware(request("/sign-up"))

    expect(response.headers.get("location")).toBe("https://mandala.md/")
  })

  it("drops query params when redirecting authenticated auth routes", async () => {
    mockUser({ id: "user_1" })

    const response = await middleware(request("/sign-up?invite=secret"))

    expect(response.headers.get("location")).toBe("https://mandala.md/")
  })

  it("keeps authenticated users on the callback success screen", async () => {
    mockUser({ id: "user_1" })

    const response = await middleware(request("/login?auth=success"))

    expect(response.headers.get("location")).toBeNull()
  })
})
