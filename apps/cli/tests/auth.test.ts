import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createClient } from "@supabase/supabase-js"
import {
  authCallbackUrl,
  loginWithMagicLink,
  SessionManager,
} from "../src/auth.js"
import { SecureStore } from "../src/persistence.js"

vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn() }))

const userId = "10000000-0000-4000-8000-000000000001"
const environment = {
  MANDALA_SUPABASE_URL: "http://127.0.0.1:54321",
  MANDALA_SUPABASE_ANON_KEY: "anon-key",
}
const directories: string[] = []
let store: SecureStore

beforeEach(async () => {
  vi.clearAllMocks()
  const directory = await mkdtemp(join(tmpdir(), "mandala-cli-auth-"))
  directories.push(directory)
  store = new SecureStore(directory)
})

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true }))
  )
})

describe.sequential("PKCE magic-link authentication", () => {
  it("exchanges a loopback code and persists the resulting session", async () => {
    await store.writeConfig({
      schemaVersion: 1,
      mode: "mock",
      selectedCompany: {
        id: "20000000-0000-4000-8000-000000000099",
        name: "Previous account company",
      },
    })
    const signInWithOtp = vi.fn().mockResolvedValue({ error: null })
    const exchangeCodeForSession = vi.fn().mockResolvedValue({
      data: { session: session("access-secret", "refresh-secret") },
      error: null,
    })
    vi.mocked(createClient).mockReturnValue({
      auth: { signInWithOtp, exchangeCodeForSession },
    } as never)

    const login = loginWithMagicLink({
      email: "user@example.com",
      environment,
      store,
      timeoutMs: 1_000,
    })
    await vi.waitFor(() => expect(signInWithOtp).toHaveBeenCalled())
    const redirect = requestedRedirect(signInWithOtp)
    redirect.searchParams.set("code", "one-time-code")
    const callback = await fetch(redirect)

    expect(callback.status).toBe(200)
    await expect(login).resolves.toMatchObject({ user: { id: userId } })
    expect(redirect.origin + redirect.pathname).toBe(authCallbackUrl)
    expect(redirect.searchParams.get("state")).toMatch(/^[a-f0-9]{64}$/)
    expect(signInWithOtp).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "user@example.com",
        options: expect.objectContaining({ shouldCreateUser: false }),
      })
    )
    expect(exchangeCodeForSession).toHaveBeenCalledWith("one-time-code")
    await expect(store.readSession()).resolves.toMatchObject({
      accessToken: "access-secret",
      refreshToken: "refresh-secret",
    })
    await expect(store.readConfig()).resolves.toMatchObject({
      selectedCompany: null,
    })
  })

  it("ignores callback preemption without the per-login state", async () => {
    const signInWithOtp = vi.fn().mockResolvedValue({ error: null })
    const exchangeCodeForSession = vi.fn().mockResolvedValue({
      data: { session: session("access-secret", "refresh-secret") },
      error: null,
    })
    vi.mocked(createClient).mockReturnValue({
      auth: { signInWithOtp, exchangeCodeForSession },
    } as never)

    const login = loginWithMagicLink({
      email: "user@example.com",
      environment,
      store,
      timeoutMs: 1_000,
    })
    await vi.waitFor(() => expect(signInWithOtp).toHaveBeenCalled())
    const invalid = await fetch(
      `${authCallbackUrl}?state=wrong&code=attacker-code`
    )
    expect(invalid.status).toBe(400)
    expect(exchangeCodeForSession).not.toHaveBeenCalled()

    const redirect = requestedRedirect(signInWithOtp)
    redirect.searchParams.set("code", "valid-code")
    expect((await fetch(redirect)).status).toBe(200)
    await expect(login).resolves.toMatchObject({ user: { id: userId } })
    expect(exchangeCodeForSession).toHaveBeenCalledWith("valid-code")
  })

  it("times out without writing a partial session", async () => {
    vi.mocked(createClient).mockReturnValue({
      auth: {
        signInWithOtp: vi.fn().mockResolvedValue({ error: null }),
        exchangeCodeForSession: vi.fn(),
      },
    } as never)

    await expect(
      loginWithMagicLink({
        email: "user@example.com",
        environment,
        store,
        timeoutMs: 20,
      })
    ).rejects.toMatchObject({ code: "auth_callback_timeout" })
    await expect(store.readSession()).resolves.toBeNull()
  })
})

it("refreshes an expired session and atomically replaces its tokens", async () => {
  await store.writeSession({
    schemaVersion: 1,
    accessToken: "expired-access",
    refreshToken: "old-refresh",
    expiresAt: 1,
    user: { id: userId, email: "user@example.com" },
  })
  const refreshSession = vi.fn().mockResolvedValue({
    data: { session: session("fresh-access", "fresh-refresh") },
    error: null,
  })
  vi.mocked(createClient).mockReturnValue({ auth: { refreshSession } } as never)

  const manager = new SessionManager(store, environment)
  await expect(manager.getAccessToken()).resolves.toBe("fresh-access")
  expect(refreshSession).toHaveBeenCalledWith({ refresh_token: "old-refresh" })
  await expect(store.readSession()).resolves.toMatchObject({
    accessToken: "fresh-access",
    refreshToken: "fresh-refresh",
  })
})

function session(accessToken: string, refreshToken: string) {
  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_at: 2_000_000_000,
    expires_in: 3_600,
    token_type: "bearer",
    user: { id: userId, email: "user@example.com" },
  }
}

function requestedRedirect(signInWithOtp: ReturnType<typeof vi.fn>): URL {
  const request = signInWithOtp.mock.calls[0]?.[0] as
    | { options?: { emailRedirectTo?: string } }
    | undefined
  const value = request?.options?.emailRedirectTo
  if (!value) throw new Error("Missing test redirect URL")
  return new URL(value)
}
