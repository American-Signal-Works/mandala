import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  ContextWorkspaceSettingsError,
  getContextWorkspaceStatus,
  setContextWorkspaceConfiguration,
} from "@/lib/mandala/context"
import { getCompanyMembership } from "@/lib/mandala/workflows"
import { authenticateRequest } from "@/lib/supabase/request"
import { GET, PATCH } from "./route"

vi.mock("@/lib/mandala/context", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/mandala/context")>()),
  getContextWorkspaceStatus: vi.fn(),
  setContextWorkspaceConfiguration: vi.fn(),
}))
vi.mock("@/lib/mandala/workflows", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/mandala/workflows")>()),
  getCompanyMembership: vi.fn(),
}))
vi.mock("@/lib/supabase/request", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase/request")>()),
  authenticateRequest: vi.fn(),
}))

const companyId = "20000000-0000-4000-8000-000000000001"
const otherCompanyId = "20000000-0000-4000-8000-000000000002"
const auth = {
  authMode: "bearer",
  supabase: {},
  user: { id: "10000000-0000-4000-8000-000000000001" },
  cliSession: {
    managed: true,
    sessionId: "50000000-0000-4000-8000-000000000001",
    selectedCompanyId: companyId,
    scopes: ["workspace:control"],
  },
}
const status = {
  schemaVersion: 1 as const,
  companyId,
  provider: "off" as const,
  sandboxEnabled: true,
  readiness: "disabled" as const,
  configurationVersion: 1,
  updatedAt: "2026-07-16T20:00:00.000Z",
  providerStatus: {
    operational: false,
    status: "disabled" as const,
    detailCode: "context_off" as const,
  },
  indexingCoverage: {
    status: "unavailable" as const,
    eligibleRecordCount: null,
    indexedRecordCount: null,
    percent: null,
  },
  synchronization: {
    status: "unavailable" as const,
    lagSeconds: null,
    lastSynchronizedAt: null,
    recentErrorCount: null,
  },
}

describe("Context workspace settings route", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateRequest).mockResolvedValue(auth as never)
    vi.mocked(getCompanyMembership).mockResolvedValue({ role: "owner" })
    vi.mocked(getContextWorkspaceStatus).mockResolvedValue(status)
    vi.mocked(setContextWorkspaceConfiguration).mockResolvedValue(status)
  })

  it("reads server-derived status for the browser-approved workspace", async () => {
    const response = await GET(
      new Request(
        `http://localhost/api/mandala/context/settings?companyId=${companyId}`
      )
    )

    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    await expect(response.json()).resolves.toEqual(status)
    expect(authenticateRequest).toHaveBeenCalledWith(expect.any(Request), {
      allowManagedCli: true,
    })
    expect(getCompanyMembership).toHaveBeenCalledWith({
      supabase: auth.supabase,
      companyId,
      userId: auth.user.id,
    })
  })

  it("blocks a managed CLI from another workspace or without control scope", async () => {
    for (const cliSession of [
      { ...auth.cliSession, selectedCompanyId: otherCompanyId },
      { ...auth.cliSession, scopes: ["workspace:read"] },
    ]) {
      vi.mocked(authenticateRequest).mockResolvedValueOnce({
        ...auth,
        cliSession,
      } as never)
      const response = await GET(
        new Request(
          `http://localhost/api/mandala/context/settings?companyId=${companyId}`
        )
      )
      expect(response.status).toBe(403)
    }
    expect(getContextWorkspaceStatus).not.toHaveBeenCalled()
  })

  it("allows active members to read but only owner/admin to mutate", async () => {
    vi.mocked(getCompanyMembership).mockResolvedValue({ role: "member" })
    const read = await GET(
      new Request(
        `http://localhost/api/mandala/context/settings?companyId=${companyId}`
      )
    )
    expect(read.status).toBe(200)

    const write = await PATCH(
      patchRequest({
        companyId,
        sandboxEnabled: false,
        expectedConfigurationVersion: 1,
        reason: "Disable Sandbox after an explicit operational review.",
      })
    )
    expect(write.status).toBe(403)
    expect(setContextWorkspaceConfiguration).not.toHaveBeenCalled()
  })

  it("rejects client readiness and unknown fields before mutation", async () => {
    const response = await PATCH(
      patchRequest({
        companyId,
        provider: "supermemory",
        readiness: "ready",
        providerCredential: "not-accepted",
        expectedConfigurationVersion: 1,
        reason: "The server must derive provider readiness.",
      })
    )
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: "invalid_request",
    })
    expect(getCompanyMembership).not.toHaveBeenCalled()
    expect(setContextWorkspaceConfiguration).not.toHaveBeenCalled()
  })

  it("forwards only the strict admin mutation and maps stale writes", async () => {
    const body = {
      companyId,
      provider: "supermemory",
      expectedConfigurationVersion: 1,
      reason: "Prepare Context without enabling provider operations.",
    }
    const success = await PATCH(patchRequest(body))
    expect(success.status).toBe(200)
    expect(setContextWorkspaceConfiguration).toHaveBeenCalledWith({
      supabase: auth.supabase,
      request: body,
    })

    vi.mocked(setContextWorkspaceConfiguration).mockRejectedValueOnce(
      new ContextWorkspaceSettingsError(
        "stale_context_workspace_configuration",
        "40001"
      )
    )
    const stale = await PATCH(patchRequest(body))
    expect(stale.status).toBe(409)
    await expect(stale.json()).resolves.toEqual({
      error: "stale_context_workspace_configuration",
    })
  })

  it("returns bounded authentication and membership failures", async () => {
    vi.mocked(authenticateRequest).mockResolvedValueOnce(null)
    const unauthorized = await GET(
      new Request(
        `http://localhost/api/mandala/context/settings?companyId=${companyId}`
      )
    )
    expect(unauthorized.status).toBe(401)

    vi.mocked(getCompanyMembership).mockResolvedValueOnce(null)
    const forbidden = await GET(
      new Request(
        `http://localhost/api/mandala/context/settings?companyId=${companyId}`
      )
    )
    expect(forbidden.status).toBe(403)
  })
})

function patchRequest(body: unknown): Request {
  return new Request("http://localhost/api/mandala/context/settings", {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost",
    },
    body: JSON.stringify(body),
  })
}
