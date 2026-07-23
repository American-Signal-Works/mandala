import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  claimCliDeviceAuthorization,
  completeCliDeviceAuthorization,
  createCliDeviceAuthorization,
  decideCliDeviceAuthorization,
  inspectCliDeviceAuthorization,
  inspectCliSessionRefresh,
  issueSupabaseCliActorSession,
  loadCliSessions,
  releaseCliDeviceAuthorization,
  revokeIssuedCliActorSession,
  rotateCliSessionCredentials,
  selectCliSessionCompany,
  revokeCliSession as revokeCliSessionRpc,
} from "@/actions/admin/cli-auth"
import { getAuthSessionId } from "@/lib/mandala/cli-auth"
import { listAccessibleCompanies } from "@/lib/mandala/control-plane/queries"
import { authenticateRequest } from "@/lib/supabase/request"
import { POST as createDeviceAuthorization } from "./device-authorizations/route"
import { POST as decideDeviceAuthorization } from "./device-authorizations/decision/route"
import { POST as inspectDeviceAuthorization } from "./device-authorizations/inspect/route"
import { POST as exchangeDeviceAuthorization } from "./device-authorizations/token/route"
import { POST as refreshCliSession } from "./sessions/refresh/route"
import { PUT as selectCliCompany } from "./sessions/company/route"
import {
  DELETE as revokeCliSessionRoute,
  GET as listCliSessions,
} from "./sessions/route"
import { POST as bootstrapBrowserAuthorization } from "./device-authorizations/bootstrap/route"

vi.mock("@/actions/admin/cli-auth", () => ({
  claimCliDeviceAuthorization: vi.fn(),
  completeCliDeviceAuthorization: vi.fn(),
  createCliDeviceAuthorization: vi.fn(),
  decideCliDeviceAuthorization: vi.fn(),
  inspectCliDeviceAuthorization: vi.fn(),
  inspectCliSessionRefresh: vi.fn(),
  issueSupabaseCliActorSession: vi.fn(),
  loadCliSessions: vi.fn(),
  releaseCliDeviceAuthorization: vi.fn(),
  revokeAllCliSessions: vi.fn(),
  revokeCliSession: vi.fn(),
  revokeIssuedCliActorSession: vi.fn(),
  rotateCliSessionCredentials: vi.fn(),
  selectCliSessionCompany: vi.fn(),
}))
vi.mock("@/lib/supabase/request", () => ({ authenticateRequest: vi.fn() }))
vi.mock("@/lib/mandala/control-plane/queries", () => ({
  listAccessibleCompanies: vi.fn(),
}))
vi.mock("@/lib/mandala/cli-auth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/mandala/cli-auth")>(
    "@/lib/mandala/cli-auth"
  )
  return { ...actual, getAuthSessionId: vi.fn() }
})

const userId = "10000000-0000-4000-8000-000000000001"
const companyId = "20000000-0000-4000-8000-000000000001"
const authorizationId = "30000000-0000-4000-8000-000000000001"
const exchangeNonce = "40000000-0000-4000-8000-000000000001"
const actorAuthSessionId = "50000000-0000-4000-8000-000000000001"
const cliSessionId = "60000000-0000-4000-8000-000000000001"

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://mandala.md")
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key")
  vi.mocked(revokeIssuedCliActorSession).mockResolvedValue(undefined)
})

describe("hosted CLI HTTP boundaries", () => {
  it("creates a code-free browser handoff while persisting only token hashes", async () => {
    vi.mocked(createCliDeviceAuthorization).mockResolvedValue({
      data: { intervalSeconds: 5 },
      error: null,
    } as never)

    const response = await createDeviceAuthorization(
      request("/api/mandala/cli/device-authorizations", {
        clientName: "Mandala CLI",
        clientVersion: "0.0.0",
        clientPlatform: "darwin-arm64",
        requestedScopes: ["workspace:control"],
      })
    )
    const body = (await response.json()) as {
      deviceCode: string
      verificationUri: string
    }

    expect(response.status).toBe(201)
    expect(response.headers.get("cache-control")).toContain("no-store")
    const verificationUrl = new URL(body.verificationUri)
    expect(verificationUrl.pathname).toBe("/cli/authorize")
    const browserToken = new URLSearchParams(verificationUrl.hash.slice(1)).get(
      "request"
    )
    expect(browserToken).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(browserToken).not.toBe(body.deviceCode)
    const rpcInput = vi.mocked(createCliDeviceAuthorization).mock.calls[0]?.[0]
    if (!rpcInput) throw new Error("Expected a device authorization RPC")
    expect(rpcInput.p_device_code_hash).toMatch(/^[a-f0-9]{64}$/)
    expect(rpcInput.p_browser_token_hash).toMatch(/^[a-f0-9]{64}$/)
    expect(rpcInput.p_device_code_hash).not.toBe(body.deviceCode)
    expect(body).not.toHaveProperty("userCode")
    expect(JSON.stringify(rpcInput)).not.toContain(browserToken)
  })

  it("moves the browser token into an HttpOnly cookie and cleans the URL", async () => {
    const browserToken = "b".repeat(43)
    const response = await bootstrapBrowserAuthorization(
      request("/api/mandala/cli/device-authorizations/bootstrap", {
        browserToken,
      })
    )

    expect(response.status).toBe(201)
    const responseBody = await response.json()
    expect(responseBody).toEqual({ ready: true })
    expect(response.headers.get("set-cookie")).toContain(
      `mandala-cli-authorization=${browserToken}`
    )
    expect(response.headers.get("set-cookie")).toContain("HttpOnly")
    expect(response.headers.get("set-cookie")).toContain("SameSite=lax")
    expect(response.headers.get("set-cookie")).toContain("Max-Age=600")
    expect(response.headers.get("referrer-policy")).toBe("no-referrer")
    expect(JSON.stringify(responseBody)).not.toContain(browserToken)
  })

  it("rejects cross-origin browser bootstrap attempts", async () => {
    const response = await bootstrapBrowserAuthorization(
      new Request(
        "https://mandala.md/api/mandala/cli/device-authorizations/bootstrap",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "https://attacker.example",
          },
          body: JSON.stringify({ browserToken: "b".repeat(43) }),
        }
      )
    )

    expect(response.status).toBe(403)
    expect(response.headers.get("set-cookie")).toBeNull()
  })

  it("requires browser cookie authentication for approval decisions", async () => {
    vi.mocked(authenticateRequest).mockResolvedValue(null)

    const response = await decideDeviceAuthorization(
      request("/api/mandala/cli/device-authorizations/decision", {
        decision: "approve",
      })
    )

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: "unauthorized" })
  })

  it("does not allow bearer API sessions to approve browser requests", async () => {
    vi.mocked(authenticateRequest).mockResolvedValue({
      authMode: "bearer",
      supabase: {},
      user: { id: userId },
    } as never)

    const response = await decideDeviceAuthorization(
      request(
        "/api/mandala/cli/device-authorizations/decision",
        { decision: "approve" },
        "POST",
        { cookie: `mandala-cli-authorization=${"b".repeat(43)}` }
      )
    )

    expect(response.status).toBe(401)
  })

  it("rejects a browser token supplied in the approval body", async () => {
    vi.mocked(authenticateRequest).mockResolvedValue({
      authMode: "cookie",
      supabase: { rpc: vi.fn() },
      user: { id: userId },
    } as never)

    const response = await decideDeviceAuthorization(
      request(
        "/api/mandala/cli/device-authorizations/decision",
        {
          browserToken: "b".repeat(43),
          decision: "approve",
          companyId,
        },
        "POST",
        { cookie: `mandala-cli-authorization=${"b".repeat(43)}` }
      )
    )

    expect(response.status).toBe(400)
  })

  it("binds approval to the HttpOnly browser cookie and clears it", async () => {
    vi.mocked(decideCliDeviceAuthorization).mockResolvedValue({
      data: {
        status: "approved",
      },
      error: null,
    } as never)
    vi.mocked(authenticateRequest).mockResolvedValue({
      authMode: "cookie",
      supabase: {},
      user: { id: userId },
    } as never)

    const response = await decideDeviceAuthorization(
      request(
        "/api/mandala/cli/device-authorizations/decision",
        { decision: "approve" },
        "POST",
        { cookie: `mandala-cli-authorization=${"b".repeat(43)}` }
      )
    )

    expect(response.status).toBe(200)
    expect(decideCliDeviceAuthorization).toHaveBeenCalledWith(
      expect.objectContaining({
        p_actor_user_id: userId,
        p_browser_token_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
        p_subject_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
        p_decision: "approve",
        p_company_id: null,
      })
    )
    expect(response.headers.get("set-cookie")).toContain(
      "mandala-cli-authorization="
    )
    expect(response.headers.get("set-cookie")).toContain(
      "Expires=Thu, 01 Jan 1970"
    )
  })

  it("accepts the UTC-offset timestamp returned by the inspection RPC", async () => {
    vi.mocked(inspectCliDeviceAuthorization).mockResolvedValue({
      data: {
        authorizationId,
        status: "pending",
        clientName: "Mandala CLI",
        clientVersion: "0.0.0",
        clientPlatform: "darwin-arm64",
        requestedScopes: ["workspace:control"],
        expiresAt: "2026-07-16T17:49:11.204+00:00",
        selectedCompanyId: null,
      },
      error: null,
    } as never)
    vi.mocked(authenticateRequest).mockResolvedValue({
      authMode: "cookie",
      supabase: {},
      user: { id: userId },
    } as never)

    const response = await inspectDeviceAuthorization(
      request("/api/mandala/cli/device-authorizations/inspect", {}, "POST", {
        cookie: `mandala-cli-authorization=${"b".repeat(43)}`,
      })
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      authorizationId,
      status: "pending",
      expiresAt: "2026-07-16T17:49:11.204+00:00",
    })
    expect(inspectCliDeviceAuthorization).toHaveBeenCalledWith(
      expect.objectContaining({
        p_actor_user_id: userId,
        p_browser_token_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
        p_subject_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
      })
    )
  })

  it("returns a safe rate-limit response from the combined server inspection", async () => {
    vi.mocked(inspectCliDeviceAuthorization).mockResolvedValue({
      data: { error: "rate_limited" },
      error: null,
    } as never)
    vi.mocked(authenticateRequest).mockResolvedValue({
      authMode: "cookie",
      supabase: {},
      user: { id: userId },
    } as never)

    const response = await inspectDeviceAuthorization(
      request("/api/mandala/cli/device-authorizations/inspect", {}, "POST", {
        cookie: `mandala-cli-authorization=${"b".repeat(43)}`,
      })
    )

    expect(response.status).toBe(429)
    await expect(response.json()).resolves.toEqual({ error: "rate_limited" })
  })

  it("issues credentials only after claim and completion both succeed", async () => {
    vi.mocked(claimCliDeviceAuthorization).mockResolvedValue({
      data: exchangeReady(),
      error: null,
    } as never)
    vi.mocked(completeCliDeviceAuthorization).mockResolvedValue({
      data: { sessionId: cliSessionId, companyId: null },
      error: null,
    } as never)
    vi.mocked(issueSupabaseCliActorSession).mockResolvedValue(
      actorSession() as never
    )
    vi.mocked(getAuthSessionId).mockResolvedValue(actorAuthSessionId)

    const response = await exchangeDeviceAuthorization(
      request("/api/mandala/cli/device-authorizations/token", {
        deviceCode: "d".repeat(43),
      })
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toMatchObject({
      status: "authorized",
      sessionId: cliSessionId,
    })
    expect(body).not.toHaveProperty("company")
    expect(body.accessToken).toMatch(/^mdl_cli_at_[A-Za-z0-9_-]{43}$/)
    expect(body.refreshToken).toMatch(/^mdl_cli_rt_[A-Za-z0-9_-]{43}$/)
    expect(completeCliDeviceAuthorization).toHaveBeenCalledWith(
      expect.objectContaining({
        p_authorization_id: authorizationId,
        p_exchange_nonce: exchangeNonce,
        p_access_token_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
        p_refresh_token_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
        p_access_expires_at: expect.any(String),
        p_refresh_expires_at: expect.any(String),
        p_actor_auth_session_id: actorAuthSessionId,
        p_actor_session_ciphertext: expect.stringMatching(/^v1\./),
      })
    )
    expect(JSON.stringify(body)).not.toContain("internal-actor-access-token")
  })

  it("revokes partial credentials and releases the claim when completion fails", async () => {
    vi.mocked(claimCliDeviceAuthorization).mockResolvedValue({
      data: exchangeReady(),
      error: null,
    } as never)
    vi.mocked(completeCliDeviceAuthorization).mockResolvedValue({
      data: null,
      error: new Error("complete failed"),
    } as never)
    vi.mocked(releaseCliDeviceAuthorization).mockResolvedValue({
      data: null,
      error: null,
    } as never)
    vi.mocked(issueSupabaseCliActorSession).mockResolvedValue(
      actorSession() as never
    )
    vi.mocked(getAuthSessionId).mockResolvedValue(actorAuthSessionId)

    const response = await exchangeDeviceAuthorization(
      request("/api/mandala/cli/device-authorizations/token", {
        deviceCode: "d".repeat(43),
      })
    )

    expect(response.status).toBe(500)
    expect(revokeIssuedCliActorSession).toHaveBeenCalledWith(
      "internal-actor-access-token"
    )
    expect(releaseCliDeviceAuthorization).toHaveBeenCalledWith({
      p_authorization_id: authorizationId,
      p_exchange_nonce: exchangeNonce,
    })
    expect(JSON.stringify(await response.json())).not.toContain("mdl_cli_")
  })

  it("binds a workspace only after the authenticated CLI selects it", async () => {
    vi.mocked(authenticateRequest).mockResolvedValue({
      authMode: "bearer",
      supabase: {},
      user: { id: userId },
      cliSession: {
        managed: true,
        sessionId: cliSessionId,
        selectedCompanyId: null,
        scopes: ["workspace:control"],
      },
    } as never)
    vi.mocked(selectCliSessionCompany).mockResolvedValue({
      data: {
        company: {
          id: companyId,
          name: "Example Company",
          role: "owner",
        },
      },
      error: null,
    } as never)

    const response = await selectCliCompany(
      request("/api/mandala/cli/sessions/company", { companyId }, "PUT")
    )

    expect(response.status).toBe(200)
    expect(selectCliSessionCompany).toHaveBeenCalledWith({
      p_actor_user_id: userId,
      p_cli_session_id: cliSessionId,
      p_company_id: companyId,
    })
    await expect(response.json()).resolves.toEqual({
      company: { id: companyId, name: "Example Company", role: "owner" },
    })
  })

  it("lets a local bearer session select an accessible workspace locally", async () => {
    const supabase = {}
    vi.mocked(authenticateRequest).mockResolvedValue({
      authMode: "bearer",
      supabase,
      user: { id: userId },
    } as never)
    vi.mocked(listAccessibleCompanies).mockResolvedValue([
      {
        id: companyId,
        name: "Example Company",
        role: "owner",
        updatedAt: "2026-07-23T20:00:00.000Z",
      },
    ])

    const response = await selectCliCompany(
      request("/api/mandala/cli/sessions/company", { companyId }, "PUT")
    )

    expect(response.status).toBe(200)
    expect(listAccessibleCompanies).toHaveBeenCalledWith({
      supabase,
      userId,
    })
    expect(selectCliSessionCompany).not.toHaveBeenCalled()
    await expect(response.json()).resolves.toEqual({
      company: { id: companyId, name: "Example Company", role: "owner" },
    })
  })

  it("denies an inaccessible workspace to a local bearer session", async () => {
    vi.mocked(authenticateRequest).mockResolvedValue({
      authMode: "bearer",
      supabase: {},
      user: { id: userId },
    } as never)
    vi.mocked(listAccessibleCompanies).mockResolvedValue([])

    const response = await selectCliCompany(
      request("/api/mandala/cli/sessions/company", { companyId }, "PUT")
    )

    expect(response.status).toBe(403)
    expect(selectCliSessionCompany).not.toHaveBeenCalled()
    await expect(response.json()).resolves.toEqual({
      error: "company_not_accessible",
    })
  })

  it("keeps cookie sessions outside the CLI workspace-selection route", async () => {
    vi.mocked(authenticateRequest).mockResolvedValue({
      authMode: "cookie",
      supabase: {},
      user: { id: userId },
    } as never)

    const response = await selectCliCompany(
      request("/api/mandala/cli/sessions/company", { companyId }, "PUT")
    )

    expect(response.status).toBe(401)
    expect(listAccessibleCompanies).not.toHaveBeenCalled()
    expect(selectCliSessionCompany).not.toHaveBeenCalled()
  })

  it("revokes only the requested CLI session", async () => {
    vi.mocked(revokeCliSessionRpc).mockResolvedValue({
      data: { sessionId: cliSessionId, revoked: true },
      error: null,
    } as never)
    vi.mocked(authenticateRequest).mockResolvedValue({
      authMode: "bearer",
      supabase: {},
      user: { id: userId },
      cliSession: {
        managed: true,
        sessionId: cliSessionId,
        selectedCompanyId: companyId,
        scopes: ["workspace:control"],
      },
    } as never)

    const response = await revokeCliSessionRoute(
      request(
        "/api/mandala/cli/sessions",
        { sessionId: cliSessionId },
        "DELETE"
      )
    )

    expect(response.status).toBe(200)
    expect(revokeCliSessionRpc).toHaveBeenCalledWith({
      p_actor_user_id: userId,
      p_cli_session_id: cliSessionId,
    })
  })

  it("does not let a managed CLI revoke another or every CLI session", async () => {
    vi.mocked(authenticateRequest).mockResolvedValue({
      authMode: "bearer",
      supabase: {},
      user: { id: userId },
      cliSession: {
        managed: true,
        sessionId: cliSessionId,
        selectedCompanyId: companyId,
        scopes: ["workspace:control"],
      },
    } as never)

    const other = await revokeCliSessionRoute(
      request(
        "/api/mandala/cli/sessions",
        { sessionId: authorizationId },
        "DELETE"
      )
    )
    const all = await revokeCliSessionRoute(
      request("/api/mandala/cli/sessions", { all: true }, "DELETE")
    )

    expect(other.status).toBe(403)
    expect(all.status).toBe(403)
    expect(revokeCliSessionRpc).not.toHaveBeenCalled()
  })

  it("shows a managed CLI only its own installed session", async () => {
    vi.mocked(authenticateRequest).mockResolvedValue({
      authMode: "bearer",
      supabase: {},
      user: { id: userId },
      cliSession: {
        managed: true,
        sessionId: cliSessionId,
        selectedCompanyId: companyId,
        scopes: ["workspace:control"],
      },
    } as never)
    vi.mocked(loadCliSessions).mockResolvedValue({
      data: [cliSessionRow(cliSessionId), cliSessionRow(authorizationId)],
      error: null,
    } as never)

    const response = await listCliSessions(
      new Request("https://mandala.md/api/mandala/cli/sessions")
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      sessions: [{ id: cliSessionId }],
    })
  })

  it("rotates API-only credentials and the encrypted server actor session", async () => {
    vi.mocked(inspectCliSessionRefresh).mockResolvedValue({
      data: { sessionId: cliSessionId, userId },
      error: null,
    } as never)
    vi.mocked(issueSupabaseCliActorSession).mockResolvedValue(
      actorSession() as never
    )
    vi.mocked(getAuthSessionId).mockResolvedValue(actorAuthSessionId)
    vi.mocked(rotateCliSessionCredentials).mockResolvedValue({
      data: {
        sessionId: cliSessionId,
        userId,
        email: "user@example.com",
      },
      error: null,
    } as never)

    const response = await refreshCliSession(
      request("/api/mandala/cli/sessions/refresh", {
        refreshToken: `mdl_cli_rt_${"r".repeat(43)}`,
      })
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.accessToken).toMatch(/^mdl_cli_at_[A-Za-z0-9_-]{43}$/)
    expect(body.refreshToken).toMatch(/^mdl_cli_rt_[A-Za-z0-9_-]{43}$/)
    expect(rotateCliSessionCredentials).toHaveBeenCalledWith(
      expect.objectContaining({
        p_refresh_token_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
        p_next_access_token_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
        p_next_refresh_token_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
        p_actor_auth_session_id: actorAuthSessionId,
        p_actor_session_ciphertext: expect.stringMatching(/^v1\./),
      })
    )
  })

  it("revokes a newly issued actor session when opaque rotation fails", async () => {
    vi.mocked(inspectCliSessionRefresh).mockResolvedValue({
      data: { sessionId: cliSessionId, userId },
      error: null,
    } as never)
    vi.mocked(issueSupabaseCliActorSession).mockResolvedValue(
      actorSession() as never
    )
    vi.mocked(getAuthSessionId).mockResolvedValue(actorAuthSessionId)
    vi.mocked(rotateCliSessionCredentials).mockResolvedValue({
      data: { error: "invalid_refresh_token" },
      error: null,
    } as never)

    const response = await refreshCliSession(
      request("/api/mandala/cli/sessions/refresh", {
        refreshToken: `mdl_cli_rt_${"r".repeat(43)}`,
      })
    )

    expect(response.status).toBe(401)
    expect(revokeIssuedCliActorSession).toHaveBeenCalledWith(
      "internal-actor-access-token"
    )
  })
})

function request(
  path: string,
  body: unknown,
  method = "POST",
  additionalHeaders: Record<string, string> = {}
) {
  return new Request(`https://mandala.md${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      origin: "https://mandala.md",
      ...additionalHeaders,
    },
    body: JSON.stringify(body),
  })
}

function exchangeReady() {
  return {
    status: "exchange_ready",
    authorizationId,
    exchangeNonce,
    userId,
    companyId: null,
    requestedScopes: ["workspace:control"],
    clientName: "Mandala CLI",
    clientVersion: "0.0.0",
    clientPlatform: "darwin-arm64",
  }
}

function cliSessionRow(id: string) {
  return {
    id,
    selected_company_id: companyId,
    scopes: ["workspace:control"],
    client_name: "Mandala CLI",
    client_version: "0.0.0",
    client_platform: "darwin-arm64",
    created_at: "2026-07-16T17:49:11.204+00:00",
    last_used_at: "2026-07-16T17:49:11.204+00:00",
    revoked_at: null,
  }
}

function actorSession() {
  return {
    access_token: "internal-actor-access-token",
    refresh_token: "internal-actor-refresh-token",
    expires_at: Math.floor(Date.now() / 1_000) + 3_600,
    expires_in: 3_600,
    token_type: "bearer",
    user: { id: userId, email: "user@example.com" },
  }
}
