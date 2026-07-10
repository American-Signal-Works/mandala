import { beforeEach, describe, expect, it, vi } from "vitest"
import { createClient as createSupabaseClient } from "@supabase/supabase-js"
import { createClient as createCookieClient } from "./server"
import { authenticateRequest } from "./request"

vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn() }))
vi.mock("./server", () => ({ createClient: vi.fn() }))

const user = { id: "10000000-0000-0000-0000-000000000001" }

describe("authenticateRequest", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321")
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key")
  })

  it("verifies a bearer token and binds it to the request client", async () => {
    const getUser = vi.fn().mockResolvedValue({ data: { user }, error: null })
    vi.mocked(createSupabaseClient).mockReturnValue({
      auth: { getUser },
    } as never)

    const result = await authenticateRequest(
      new Request("http://localhost/api/mandala/companies", {
        headers: { authorization: "Bearer access-token" },
      })
    )

    expect(createSupabaseClient).toHaveBeenCalledWith(
      "http://127.0.0.1:54321",
      "anon-key",
      expect.objectContaining({
        global: { headers: { Authorization: "Bearer access-token" } },
      })
    )
    expect(getUser).toHaveBeenCalledWith("access-token")
    expect(result).toMatchObject({ authMode: "bearer", user })
    expect(createCookieClient).not.toHaveBeenCalled()
  })

  it("keeps cookie authentication when no Authorization header is present", async () => {
    vi.mocked(createCookieClient).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user } }) },
    } as never)

    const result = await authenticateRequest(
      new Request("http://localhost/api/mandala/companies")
    )

    expect(result).toMatchObject({ authMode: "cookie", user })
    expect(createSupabaseClient).not.toHaveBeenCalled()
  })

  it("requires an exact same-origin Origin header for cookie-authenticated mutations", async () => {
    vi.mocked(createCookieClient).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user } }) },
    } as never)

    const missingOrigin = await authenticateRequest(
      new Request("http://localhost/api/mandala/workflows/decisions", {
        method: "POST",
      })
    )
    const crossOrigin = await authenticateRequest(
      new Request("http://localhost/api/mandala/workflows/decisions", {
        method: "POST",
        headers: { origin: "https://attacker.example" },
      })
    )
    const sameOrigin = await authenticateRequest(
      new Request("http://localhost/api/mandala/workflows/decisions", {
        method: "POST",
        headers: { origin: "http://localhost" },
      })
    )

    expect(missingOrigin).toBeNull()
    expect(crossOrigin).toBeNull()
    expect(sameOrigin).toMatchObject({ authMode: "cookie", user })
  })

  it("rejects malformed or invalid bearer auth without falling back to cookies", async () => {
    const malformed = await authenticateRequest(
      new Request("http://localhost/api/mandala/companies", {
        headers: { authorization: "Basic credentials" },
      })
    )
    expect(malformed).toBeNull()

    vi.mocked(createSupabaseClient).mockReturnValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: null },
          error: new Error("invalid"),
        }),
      },
    } as never)
    const invalid = await authenticateRequest(
      new Request("http://localhost/api/mandala/companies", {
        headers: { authorization: "Bearer invalid" },
      })
    )

    expect(invalid).toBeNull()
    expect(createCookieClient).not.toHaveBeenCalled()
  })
})
