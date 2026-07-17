import { beforeEach, describe, expect, it, vi } from "vitest"
import { createClient as createSupabaseClient } from "@supabase/supabase-js"
import { encryptCliActorSession } from "@/lib/mandala/cli-auth"
import { createAdminClient } from "./admin"
import { createClient as createCookieClient } from "./server"
import { authenticateRequest } from "./request"

vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn() }))
vi.mock("./admin", () => ({ createAdminClient: vi.fn() }))
vi.mock("./server", () => ({ createClient: vi.fn() }))

const user = { id: "10000000-0000-0000-0000-000000000001" }
const cliSessionId = "20000000-0000-4000-8000-000000000001"
const companyId = "30000000-0000-4000-8000-000000000001"
const opaqueAccessToken = `mdl_cli_at_${"a".repeat(43)}`
const actorAccessToken = "internal-user-access-token"

describe("authenticateRequest", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321")
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key")
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key")
  })

  it("verifies an ordinary Supabase bearer token and binds it to the request client", async () => {
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
    expect(result?.cliSession).toBeUndefined()
    expect(createCookieClient).not.toHaveBeenCalled()
  })

  it("validates an API-only CLI credential through the service boundary", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        allowed: true,
        sessionId: cliSessionId,
        userId: user.id,
        selectedCompanyId: companyId,
        scopes: ["workspace:control"],
        actorSessionCiphertext: encryptCliActorSession(actorSession()),
      },
      error: null,
    })
    vi.mocked(createAdminClient).mockReturnValue({
      rpc,
    } as never)
    const getUser = vi.fn().mockResolvedValue({ data: { user }, error: null })
    vi.mocked(createSupabaseClient).mockReturnValue({
      auth: { getUser },
    } as never)

    const result = await authenticateRequest(
      new Request("http://localhost/api/mandala/companies", {
        headers: { authorization: `Bearer ${opaqueAccessToken}` },
      }),
      { allowManagedCli: true }
    )

    expect(rpc).toHaveBeenCalledWith("validate_cli_session_v1", {
      p_access_token_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
    })
    expect(getUser).toHaveBeenCalledWith(actorAccessToken)
    expect(result).toMatchObject({
      authMode: "bearer",
      user,
      cliSession: {
        managed: true,
        sessionId: cliSessionId,
        selectedCompanyId: companyId,
        scopes: ["workspace:control"],
      },
    })
    expect(createSupabaseClient).toHaveBeenCalledWith(
      "http://127.0.0.1:54321",
      "anon-key",
      expect.objectContaining({
        global: {
          headers: { Authorization: `Bearer ${actorAccessToken}` },
        },
      })
    )
  })

  it("default-denies API-only CLI credentials unless a route explicitly opts in", async () => {
    await expect(
      authenticateRequest(
        new Request("http://localhost/api/settings/profile/avatar", {
          headers: { authorization: `Bearer ${opaqueAccessToken}` },
        })
      )
    ).resolves.toBeNull()

    expect(createAdminClient).not.toHaveBeenCalled()
    expect(createSupabaseClient).not.toHaveBeenCalled()
  })

  it("rejects an expired or revoked API-only CLI credential", async () => {
    vi.mocked(createAdminClient).mockReturnValue({
      rpc: vi.fn().mockResolvedValue({
        data: { allowed: false },
        error: null,
      }),
    } as never)

    await expect(
      authenticateRequest(
        new Request("http://localhost/api/mandala/companies", {
          headers: { authorization: `Bearer ${opaqueAccessToken}` },
        }),
        { allowManagedCli: true }
      )
    ).resolves.toBeNull()
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

function actorSession() {
  return {
    access_token: actorAccessToken,
    refresh_token: "unused-refresh-token",
    expires_at: Math.floor(Date.now() / 1_000) + 3_600,
    expires_in: 3_600,
    token_type: "bearer",
    user,
  } as never
}
