import { createServer, type Server } from "node:http"
import { randomBytes } from "node:crypto"
import {
  createClient,
  type Session,
  type SupportedStorage,
} from "@supabase/supabase-js"
import { z } from "zod"
import {
  getSupabaseEnvironment,
  type RuntimeEnvironment,
} from "./environment.js"
import { CliError } from "./errors.js"
import { SecureStore, type StoredSession } from "./persistence.js"

export const authCallbackUrl = "http://127.0.0.1:45454/auth/callback"
const callbackTimeoutMs = 5 * 60 * 1_000
const emailSchema = z.string().email()

export type LoginOptions = {
  email: string
  environment: RuntimeEnvironment
  store: SecureStore
  onMagicLinkSent?: () => void
  signal?: AbortSignal
  timeoutMs?: number
}

export type SessionAccess = {
  getAccessToken(forceRefresh?: boolean): Promise<string>
}

export async function loginWithMagicLink(
  options: LoginOptions
): Promise<Omit<StoredSession, "accessToken" | "refreshToken">> {
  const email = emailSchema.safeParse(options.email)
  if (!email.success)
    throw new CliError("invalid_email", "Enter a valid email address.")

  if (options.signal?.aborted) throw authCancelled()

  const configuration = getSupabaseEnvironment(options.environment)
  const memoryStorage = new MemoryStorage()
  const supabase = createClient(configuration.url, configuration.anonKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      flowType: "pkce",
      persistSession: true,
      storage: memoryStorage,
    },
  })

  const callbackState = randomBytes(32).toString("hex")
  const redirectUrl = new URL(authCallbackUrl)
  redirectUrl.searchParams.set("state", callbackState)
  const callback = await openAuthCallback(
    options.timeoutMs ?? callbackTimeoutMs,
    callbackState,
    options.signal
  )
  try {
    const { error } = await supabase.auth.signInWithOtp({
      email: email.data,
      options: {
        emailRedirectTo: redirectUrl.toString(),
        shouldCreateUser: false,
      },
    })
    if (error) {
      if (
        isLocalSupabaseUrl(configuration.url) &&
        authErrorCode(error) === "otp_disabled"
      ) {
        throw new CliError(
          "unknown_local_user",
          "That email is not part of the local demo."
        )
      }
      throw new CliError(
        "magic_link_failed",
        "The authentication email could not be sent."
      )
    }
    options.onMagicLinkSent?.()

    const code = await callback.code
    const { data, error: exchangeError } =
      await supabase.auth.exchangeCodeForSession(code)
    if (exchangeError || !data.session) {
      throw new CliError(
        "invalid_auth_callback",
        "The one-time authentication callback could not be verified."
      )
    }

    const session = toStoredSession(data.session)
    await options.store.writeSession(session)
    await options.store.clearSelectedCompany()
    return {
      schemaVersion: session.schemaVersion,
      expiresAt: session.expiresAt,
      user: session.user,
    }
  } finally {
    await callback.close()
  }
}

export class SessionManager implements SessionAccess {
  constructor(
    private readonly store: SecureStore,
    private readonly environment: RuntimeEnvironment
  ) {}

  async getAccessToken(forceRefresh = false): Promise<string> {
    const session = await this.store.readSession()
    if (!session)
      throw new CliError(
        "unauthorized",
        "Sign in with 'mandala auth login' first."
      )

    const refreshRequired =
      forceRefresh || session.expiresAt <= Math.floor(Date.now() / 1_000) + 60
    if (!refreshRequired) return session.accessToken

    const configuration = getSupabaseEnvironment(this.environment)
    const supabase = createClient(configuration.url, configuration.anonKey, {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
    })
    const { data, error } = await supabase.auth.refreshSession({
      refresh_token: session.refreshToken,
    })
    if (error || !data.session) {
      if (isInvalidRefreshToken(error)) {
        await clearInvalidSession(this.store)
      }
      throw new CliError(
        "session_expired",
        "The local session has expired. Sign in again."
      )
    }

    const refreshed = toStoredSession(data.session)
    await this.store.writeSession(refreshed)
    return refreshed.accessToken
  }
}

function authErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined
  const code = (error as { code?: unknown }).code
  return typeof code === "string" ? code : undefined
}

function authErrorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined
  const status = (error as { status?: unknown }).status
  return typeof status === "number" ? status : undefined
}

function isInvalidRefreshToken(error: unknown): boolean {
  const code = authErrorCode(error)
  return (
    authErrorStatus(error) === 400 ||
    code === "refresh_token_not_found" ||
    code === "refresh_token_already_used"
  )
}

async function clearInvalidSession(store: SecureStore): Promise<void> {
  await store.deleteSession()
  await store.clearSelectedCompany()
}

function isLocalSupabaseUrl(value: string): boolean {
  const hostname = new URL(value).hostname
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]"
}

function toStoredSession(session: Session): StoredSession {
  const expiresAt =
    session.expires_at ??
    Math.floor(Date.now() / 1_000) + (session.expires_in ?? 0)
  return {
    schemaVersion: 1,
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    expiresAt,
    user: {
      id: session.user.id,
      email: session.user.email ?? null,
    },
  }
}

class MemoryStorage implements SupportedStorage {
  private readonly values = new Map<string, string>()

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }

  removeItem(key: string): void {
    this.values.delete(key)
  }
}

async function openAuthCallback(
  timeoutMs: number,
  expectedState: string,
  signal?: AbortSignal
): Promise<{
  code: Promise<string>
  close: () => Promise<void>
}> {
  let settled = false
  let invalidAttempts = 0
  let resolveCode: (code: string) => void
  let rejectCode: (error: Error) => void
  const code = new Promise<string>((resolve, reject) => {
    resolveCode = resolve
    rejectCode = reject
  })
  const abort = () => {
    if (settled) return
    settled = true
    rejectCode(authCancelled())
  }
  signal?.addEventListener("abort", abort, { once: true })

  const server: Server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", authCallbackUrl)
    if (request.method !== "GET" || url.pathname !== "/auth/callback") {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" })
      response.end("Not found")
      return
    }

    const callbackCode = url.searchParams.get("code")
    const callbackState = url.searchParams.get("state")
    if (!callbackCode || callbackState !== expectedState) {
      invalidAttempts += 1
      response.writeHead(invalidAttempts > 10 ? 429 : 400, {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store",
      })
      response.end("Authentication callback is invalid or incomplete.")
      return
    }

    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
    })
    response.end(
      "<!doctype html><title>Mandala authentication</title><p>Authentication complete. You can close this window.</p>"
    )
    if (!settled) {
      settled = true
      resolveCode(callbackCode)
    }
  })

  await new Promise<void>((resolve, reject) => {
    server.once("error", () =>
      reject(
        new CliError(
          "callback_unavailable",
          "The local authentication callback port is unavailable."
        )
      )
    )
    server.listen(45454, "127.0.0.1", () => resolve())
  })

  const timeout = setTimeout(() => {
    if (!settled) {
      settled = true
      rejectCode(
        new CliError(
          "auth_callback_timeout",
          "The authentication callback timed out."
        )
      )
    }
  }, timeoutMs)
  timeout.unref()

  return {
    code,
    close: async () => {
      clearTimeout(timeout)
      signal?.removeEventListener("abort", abort)
      if (!server.listening) return
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}

function authCancelled(): CliError {
  return new CliError("auth_cancelled", "Sign in was cancelled.")
}
