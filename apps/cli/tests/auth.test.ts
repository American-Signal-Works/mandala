import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createClient } from "@supabase/supabase-js"
import {
  authCallbackUrl,
  loginWithDeviceAuthorization,
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

  it("cancels a pending magic-link callback and releases the loopback port", async () => {
    const signInWithOtp = vi.fn().mockResolvedValue({ error: null })
    vi.mocked(createClient).mockReturnValue({
      auth: {
        signInWithOtp,
        exchangeCodeForSession: vi.fn(),
      },
    } as never)
    const controller = new AbortController()
    const login = loginWithMagicLink({
      email: "user@example.com",
      environment,
      signal: controller.signal,
      store,
      timeoutMs: 1_000,
    })
    await vi.waitFor(() => expect(signInWithOtp).toHaveBeenCalled())

    controller.abort()

    await expect(login).rejects.toMatchObject({ code: "auth_cancelled" })
    await expect(store.readSession()).resolves.toBeNull()
    await expect(fetch(authCallbackUrl)).rejects.toThrow()
  })

  it("explains when an email is not part of the local demo", async () => {
    vi.mocked(createClient).mockReturnValue({
      auth: {
        signInWithOtp: vi.fn().mockResolvedValue({
          error: { code: "otp_disabled", status: 422 },
        }),
        exchangeCodeForSession: vi.fn(),
      },
    } as never)

    await expect(
      loginWithMagicLink({
        email: "unknown@example.com",
        environment,
        store,
        timeoutMs: 1_000,
      })
    ).rejects.toMatchObject({ code: "unknown_local_user" })
  })
})

describe("hosted device authorization", () => {
  it("opens the browser, polls once, and saves the approved workspace", async () => {
    vi.useFakeTimers()
    const onAuthorizationRequested = vi.fn()
    const openBrowser = vi.fn().mockResolvedValue(true)
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(
          {
            deviceCode: "d".repeat(43),
            verificationUri:
              "https://mandala.md/cli/authorize#request=" + "b".repeat(43),
            expiresAt: "2030-01-01T00:10:00.000Z",
            intervalSeconds: 5,
          },
          201
        )
      )
      .mockResolvedValueOnce(
        jsonResponse({
          status: "authorized",
          sessionId: "30000000-0000-4000-8000-000000000001",
          accessToken: "hosted-access",
          refreshToken: "hosted-refresh",
          expiresAt: 2_000_000_000,
          user: { id: userId, email: "user@example.com" },
          company: {
            id: "20000000-0000-4000-8000-000000000001",
            name: "Example Company",
          },
        })
      )
    const fetchImplementation = fetchMock as unknown as typeof fetch

    const login = loginWithDeviceAuthorization({
      environment: { MANDALA_API_URL: "https://mandala.md" },
      fetchImplementation,
      onAuthorizationRequested,
      openBrowser,
      store,
    })
    await vi.advanceTimersByTimeAsync(5_000)

    await expect(login).resolves.toMatchObject({
      refreshMode: "hosted",
      company: { name: "Example Company" },
    })
    expect(openBrowser).toHaveBeenCalledWith(
      "https://mandala.md/cli/authorize#request=" + "b".repeat(43)
    )
    expect(onAuthorizationRequested).toHaveBeenCalledWith({
      browserOpened: true,
    })
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      headers: expect.objectContaining({
        "x-mandala-cli-capability": "workspace-binding-v1",
      }),
    })
    await expect(store.readSession()).resolves.toMatchObject({
      refreshMode: "hosted",
      cliSessionId: "30000000-0000-4000-8000-000000000001",
      accessToken: "hosted-access",
    })
    await expect(store.readConfig()).resolves.toMatchObject({
      selectedCompany: { name: "Example Company" },
    })
    vi.useRealTimers()
  })

  it("keeps a mixed deployment compatible when the server omits workspace binding", async () => {
    vi.useFakeTimers()
    await store.writeConfig({
      schemaVersion: 1,
      mode: "mock",
      selectedCompany: {
        id: "20000000-0000-4000-8000-000000000099",
        name: "Previous workspace",
      },
    })
    const fetchImplementation = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(
          {
            deviceCode: "d".repeat(43),
            verificationUri:
              "https://mandala.md/cli/authorize#request=" + "b".repeat(43),
            expiresAt: "2030-01-01T00:10:00.000Z",
            intervalSeconds: 5,
          },
          201
        )
      )
      .mockResolvedValueOnce(
        jsonResponse({
          status: "authorized",
          sessionId: "30000000-0000-4000-8000-000000000001",
          accessToken: "hosted-access",
          refreshToken: "hosted-refresh",
          expiresAt: 2_000_000_000,
          user: { id: userId, email: "user@example.com" },
        })
      ) as unknown as typeof fetch

    const login = loginWithDeviceAuthorization({
      environment: {},
      fetchImplementation,
      openBrowser: vi.fn().mockResolvedValue(true),
      store,
    })
    await vi.advanceTimersByTimeAsync(5_000)

    await expect(login).resolves.not.toHaveProperty("company")
    await expect(store.readSession()).resolves.toMatchObject({
      accessToken: "hosted-access",
    })
    await expect(store.readConfig()).resolves.toMatchObject({
      selectedCompany: null,
    })
    vi.useRealTimers()
  })

  it("does not save credentials when browser approval is denied", async () => {
    vi.useFakeTimers()
    const fetchImplementation = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(
          {
            deviceCode: "d".repeat(43),
            verificationUri:
              "https://mandala.md/cli/authorize#request=" + "b".repeat(43),
            expiresAt: "2030-01-01T00:10:00.000Z",
            intervalSeconds: 5,
          },
          201
        )
      )
      .mockResolvedValueOnce(
        jsonResponse({ status: "denied" })
      ) as unknown as typeof fetch
    const login = loginWithDeviceAuthorization({
      environment: {},
      fetchImplementation,
      openBrowser: vi.fn().mockResolvedValue(true),
      store,
    })
    const rejection = expect(login).rejects.toMatchObject({
      code: "auth_denied",
    })
    await vi.advanceTimersByTimeAsync(5_000)

    await rejection
    await expect(store.readSession()).resolves.toBeNull()
    vi.useRealTimers()
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

it("clears an invalid saved session and selected company", async () => {
  await store.writeConfig({
    schemaVersion: 1,
    mode: "mock",
    selectedCompany: {
      id: "20000000-0000-4000-8000-000000000099",
      name: "Old workspace",
    },
  })
  await store.writeSession({
    schemaVersion: 1,
    accessToken: "expired-access",
    refreshToken: "missing-refresh",
    expiresAt: 1,
    user: { id: userId, email: "user@example.com" },
  })
  vi.mocked(createClient).mockReturnValue({
    auth: {
      refreshSession: vi.fn().mockResolvedValue({
        data: { session: null },
        error: { code: "refresh_token_not_found", status: 400 },
      }),
    },
  } as never)

  const manager = new SessionManager(store, environment)
  await expect(manager.getAccessToken()).rejects.toMatchObject({
    code: "session_expired",
  })
  await expect(store.readSession()).resolves.toBeNull()
  await expect(store.readConfig()).resolves.toMatchObject({
    selectedCompany: null,
  })
})

it("refreshes a hosted session through Mandala instead of direct Supabase", async () => {
  await store.writeSession({
    schemaVersion: 1,
    refreshMode: "hosted",
    cliSessionId: "30000000-0000-4000-8000-000000000001",
    accessToken: "expired-access",
    refreshToken: "old-refresh",
    expiresAt: 1,
    user: { id: userId, email: "user@example.com" },
  })
  const fetchImplementation = vi.fn().mockResolvedValue(
    jsonResponse({
      accessToken: "fresh-hosted-access",
      refreshToken: "fresh-hosted-refresh",
      expiresAt: 2_000_000_000,
      user: { id: userId, email: "user@example.com" },
    })
  ) as unknown as typeof fetch

  const manager = new SessionManager(store, {}, fetchImplementation)
  await expect(manager.getAccessToken()).resolves.toBe("fresh-hosted-access")
  expect(fetchImplementation).toHaveBeenCalledWith(
    "https://mandala.md/api/mandala/cli/sessions/refresh",
    expect.objectContaining({
      body: JSON.stringify({ refreshToken: "old-refresh" }),
      method: "POST",
    })
  )
  await expect(store.readSession()).resolves.toMatchObject({
    refreshMode: "hosted",
    cliSessionId: "30000000-0000-4000-8000-000000000001",
    refreshToken: "fresh-hosted-refresh",
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

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}
