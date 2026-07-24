import { createServer, type Server } from "node:http"
import { randomBytes } from "node:crypto"
import { execFile } from "node:child_process"
import {
  createClient,
  type Session,
  type SupportedStorage,
} from "@supabase/supabase-js"
import {
  cliDeviceAuthorizationCreateResponseSchema,
  cliDeviceAuthorizationTokenResponseSchema,
  cliSessionCompanySelectionResponseSchema,
  cliSessionListResponseSchema,
  cliSessionRevocationResponseSchema,
  cliSessionRefreshResponseSchema,
} from "@workspace/control-plane"
import { z } from "zod"
import {
  getApiUrl,
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

export type DeviceLoginOptions = {
  environment: RuntimeEnvironment
  store: SecureStore
  clientName?: string
  clientVersion?: string
  clientPlatform?: string
  fetchImplementation?: typeof fetch
  openBrowser?: (url: string) => Promise<boolean>
  onAuthorizationRequested?: (request: { browserOpened: boolean }) => void
  signal?: AbortSignal
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

    const session = toStoredSession(data.session, "supabase")
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

export async function loginWithDeviceAuthorization(
  options: DeviceLoginOptions
) {
  if (options.signal?.aborted) throw authCancelled()
  const fetchImplementation = options.fetchImplementation ?? fetch
  const baseUrl = getApiUrl(options.environment)
  const deviceResponse = await postJson(
    fetchImplementation,
    `${baseUrl}/api/mandala/cli/device-authorizations`,
    {
      clientName: options.clientName ?? "Mandala CLI",
      clientVersion: options.clientVersion ?? "0.0.0",
      clientPlatform: options.clientPlatform ?? process.platform,
      requestedScopes: ["workspace:control"],
    },
    options.signal
  )
  const device = cliDeviceAuthorizationCreateResponseSchema.safeParse(
    deviceResponse.body
  )
  if (!deviceResponse.ok || !device.success) {
    throw new CliError(
      deviceResponse.status === 429 ? "auth_rate_limited" : "auth_unavailable",
      deviceResponse.status === 429
        ? "Too many sign-in attempts. Wait a few minutes and try again."
        : "Mandala could not start browser sign-in."
    )
  }

  const browserOpened = await (options.openBrowser ?? openSystemBrowser)(
    device.data.verificationUri
  ).catch(() => false)
  options.onAuthorizationRequested?.({
    browserOpened,
  })
  if (!browserOpened) {
    throw new CliError(
      "auth_browser_open_failed",
      "Mandala could not open the browser sign-in page. Check browser access and try again."
    )
  }

  let intervalSeconds = device.data.intervalSeconds
  const deadline = Date.parse(device.data.expiresAt)
  while (Date.now() < deadline) {
    await waitForPoll(intervalSeconds * 1_000, options.signal)
    const tokenResponse = await postJson(
      fetchImplementation,
      `${baseUrl}/api/mandala/cli/device-authorizations/token`,
      { deviceCode: device.data.deviceCode },
      options.signal,
      { "x-mandala-cli-capability": "workspace-binding-v1" }
    )
    const token = cliDeviceAuthorizationTokenResponseSchema.safeParse(
      tokenResponse.body
    )
    if (!tokenResponse.ok || !token.success) {
      throw new CliError(
        "auth_unavailable",
        "Mandala could not finish browser sign-in."
      )
    }
    if (
      token.data.status === "authorization_pending" ||
      token.data.status === "slow_down"
    ) {
      intervalSeconds = token.data.intervalSeconds
      continue
    }
    if (token.data.status !== "authorized") {
      throw deviceAuthorizationError(token.data.status)
    }

    const session: StoredSession = {
      schemaVersion: 1,
      refreshMode: "hosted",
      cliSessionId: token.data.sessionId,
      accessToken: token.data.accessToken,
      refreshToken: token.data.refreshToken,
      expiresAt: token.data.expiresAt,
      user: token.data.user,
    }
    await options.store.writeSession(session)
    let selectedCompany = token.data.company
    try {
      selectedCompany =
        selectedCompany ??
        (await recoverApprovedCompany({
          accessToken: token.data.accessToken,
          baseUrl,
          fetchImplementation,
          sessionId: token.data.sessionId,
          signal: options.signal,
        }))
      if (selectedCompany) {
        const config = await options.store.readConfig()
        await options.store.writeConfig({
          ...config,
          selectedCompany,
        })
      } else {
        await options.store.clearSelectedCompany()
      }
    } catch (error) {
      await options.store.deleteSession().catch(() => undefined)
      throw error
    }
    return {
      schemaVersion: session.schemaVersion,
      refreshMode: session.refreshMode,
      expiresAt: session.expiresAt,
      user: session.user,
      ...(selectedCompany ? { company: selectedCompany } : {}),
    }
  }
  throw new CliError(
    "auth_request_expired",
    "The browser sign-in request expired. Run 'mandala auth login' again."
  )
}

async function recoverApprovedCompany(input: {
  accessToken: string
  baseUrl: string
  fetchImplementation: typeof fetch
  sessionId: string
  signal?: AbortSignal
}) {
  try {
    const sessionsResponse = await input.fetchImplementation(
      `${input.baseUrl}/api/mandala/cli/sessions`,
      {
        headers: {
          accept: "application/json",
          authorization: `Bearer ${input.accessToken}`,
        },
        signal: input.signal,
      }
    )
    const sessions = cliSessionListResponseSchema.safeParse(
      await sessionsResponse.json().catch(() => null)
    )
    if (!sessionsResponse.ok || !sessions.success) return undefined

    const selectedCompanyId = sessions.data.sessions.find(
      (session) => session.id === input.sessionId
    )?.selectedCompanyId
    if (!selectedCompanyId) return undefined

    const companyResponse = await input.fetchImplementation(
      `${input.baseUrl}/api/mandala/cli/sessions/company`,
      {
        method: "PUT",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${input.accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ companyId: selectedCompanyId }),
        signal: input.signal,
      }
    )
    const company = cliSessionCompanySelectionResponseSchema.safeParse(
      await companyResponse.json().catch(() => null)
    )
    if (!companyResponse.ok || !company.success) return undefined
    return {
      id: company.data.company.id,
      name: company.data.company.name,
    }
  } catch {
    return undefined
  }
}

export class SessionManager implements SessionAccess {
  constructor(
    private readonly store: SecureStore,
    private readonly environment: RuntimeEnvironment,
    private readonly fetchImplementation: typeof fetch = fetch
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

    if (session.refreshMode === "hosted") {
      return this.refreshHostedSession(session)
    }

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

    const refreshed = toStoredSession(data.session, "supabase")
    await this.store.writeSession(refreshed)
    return refreshed.accessToken
  }

  private async refreshHostedSession(session: StoredSession) {
    let response: Awaited<ReturnType<typeof postJson>>
    try {
      response = await postJson(
        this.fetchImplementation,
        `${getApiUrl(this.environment)}/api/mandala/cli/sessions/refresh`,
        { refreshToken: session.refreshToken }
      )
    } catch (error) {
      if (error instanceof CliError) throw error
      throw new CliError(
        "network_error",
        "Mandala could not refresh the saved session."
      )
    }

    const refreshed = cliSessionRefreshResponseSchema.safeParse(response.body)
    if (!response.ok || !refreshed.success) {
      if (response.status === 400 || response.status === 401) {
        await clearInvalidSession(this.store)
        throw new CliError(
          "session_expired",
          "The saved Mandala session expired or was revoked. Sign in again."
        )
      }
      throw new CliError(
        "session_refresh_failed",
        "Mandala could not refresh the saved session."
      )
    }

    const next: StoredSession = {
      schemaVersion: 1,
      refreshMode: "hosted",
      ...(session.cliSessionId ? { cliSessionId: session.cliSessionId } : {}),
      accessToken: refreshed.data.accessToken,
      refreshToken: refreshed.data.refreshToken,
      expiresAt: refreshed.data.expiresAt,
      user: refreshed.data.user,
    }
    await this.store.writeSession(next)
    return next.accessToken
  }
}

export async function revokeHostedCliSession(options: {
  environment: RuntimeEnvironment
  store: SecureStore
  fetchImplementation?: typeof fetch
}) {
  const session = await options.store.readSession()
  if (!session || session.refreshMode !== "hosted" || !session.cliSessionId) {
    return true
  }

  try {
    const accessToken = await new SessionManager(
      options.store,
      options.environment,
      options.fetchImplementation
    ).getAccessToken()
    const response = await (options.fetchImplementation ?? fetch)(
      `${getApiUrl(options.environment)}/api/mandala/cli/sessions`,
      {
        method: "DELETE",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ sessionId: session.cliSessionId }),
      }
    )
    const body = (await response.json().catch(() => null)) as unknown
    return (
      response.ok && cliSessionRevocationResponseSchema.safeParse(body).success
    )
  } catch {
    return false
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
  return (
    hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]"
  )
}

function toStoredSession(
  session: Session,
  refreshMode: "hosted" | "supabase"
): StoredSession {
  const expiresAt =
    session.expires_at ??
    Math.floor(Date.now() / 1_000) + (session.expires_in ?? 0)
  return {
    schemaVersion: 1,
    refreshMode,
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    expiresAt,
    user: {
      id: session.user.id,
      email: session.user.email ?? null,
    },
  }
}

async function postJson(
  fetchImplementation: typeof fetch,
  url: string,
  body: unknown,
  signal?: AbortSignal,
  additionalHeaders: Record<string, string> = {}
) {
  let response: Response
  try {
    response = await fetchImplementation(url, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        ...additionalHeaders,
      },
      body: JSON.stringify(body),
      signal,
    })
  } catch {
    if (signal?.aborted) throw authCancelled()
    throw new CliError(
      "network_error",
      "Mandala could not be reached for browser sign-in."
    )
  }
  return {
    ok: response.ok,
    status: response.status,
    body: (await response.json().catch(() => null)) as unknown,
  }
}

function waitForPoll(milliseconds: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(authCancelled())
      return
    }
    const timeout = setTimeout(() => {
      signal?.removeEventListener("abort", abort)
      resolve()
    }, milliseconds)
    const abort = () => {
      clearTimeout(timeout)
      reject(authCancelled())
    }
    signal?.addEventListener("abort", abort, { once: true })
  })
}

async function openSystemBrowser(url: string) {
  const parsed = new URL(url)
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false
  const command =
    process.platform === "darwin"
      ? { file: "open", args: [parsed.toString()] }
      : process.platform === "win32"
        ? {
            file: "rundll32.exe",
            args: ["url.dll,FileProtocolHandler", parsed.toString()],
          }
        : { file: "xdg-open", args: [parsed.toString()] }
  await new Promise<void>((resolve, reject) => {
    execFile(command.file, command.args, { windowsHide: true }, (error) => {
      if (error) reject(error)
      else resolve()
    })
  })
  return true
}

function deviceAuthorizationError(status: string) {
  if (status === "denied") {
    return new CliError(
      "auth_denied",
      "Browser sign-in was denied. No session was saved."
    )
  }
  if (status === "expired") {
    return new CliError(
      "auth_request_expired",
      "The browser sign-in request expired. Run 'mandala auth login' again."
    )
  }
  if (status === "consumed") {
    return new CliError(
      "auth_request_consumed",
      "That browser sign-in request was already used. Start sign-in again."
    )
  }
  return new CliError(
    "auth_invalid_request",
    "The browser sign-in request is invalid."
  )
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
