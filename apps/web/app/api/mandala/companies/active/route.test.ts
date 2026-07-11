import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import type { CompanySummary } from "@workspace/control-plane"
import { listAccessibleCompanies } from "@/lib/mandala/control-plane/queries"
import { ACTIVE_COMPANY_COOKIE } from "@/lib/mandala/company-context"
import { authenticateRequest } from "@/lib/supabase/request"
import { GET, PUT } from "./route"

vi.mock("@/lib/supabase/request", () => ({ authenticateRequest: vi.fn() }))
vi.mock("@/lib/mandala/control-plane/queries", () => ({
  listAccessibleCompanies: vi.fn(),
}))

const alphaCompany = {
  id: "20000000-0000-4000-8000-000000000001",
  name: "Alpha Company",
  role: "owner",
  updatedAt: "2026-07-09T12:00:00Z",
} satisfies CompanySummary
const betaCompany = {
  id: "20000000-0000-4000-8000-000000000002",
  name: "Beta Company",
  role: "member",
  updatedAt: "2026-07-09T12:00:00Z",
} satisfies CompanySummary
const companies: CompanySummary[] = [alphaCompany, betaCompany]
const auth = {
  authMode: "cookie" as const,
  supabase: {},
  user: { id: "10000000-0000-4000-8000-000000000001" },
}

describe("active company route", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateRequest).mockResolvedValue(auth as never)
    vi.mocked(listAccessibleCompanies).mockResolvedValue(companies)
  })

  it("requires authentication", async () => {
    vi.mocked(authenticateRequest).mockResolvedValue(null)

    const response = await GET(request())

    expect(response.status).toBe(401)
    expect(listAccessibleCompanies).not.toHaveBeenCalled()
  })

  it("auto-selects and persists the only accessible company", async () => {
    vi.mocked(listAccessibleCompanies).mockResolvedValue([alphaCompany])

    const response = await GET(request())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      status: "resolved",
      activeCompany: alphaCompany,
      companies: [alphaCompany],
      permissions: expect.arrayContaining([
        "membership.manage",
        "workflow.execution.mock",
      ]),
    })
    expect(response.cookies.get(ACTIVE_COMPANY_COOKIE)?.value).toBe(
      alphaCompany.id
    )
    expect(response.headers.get("set-cookie")).toContain("HttpOnly")
    expect(response.headers.get("set-cookie")).toContain("SameSite=lax")
  })

  it("marks the active-company cookie secure on HTTPS", async () => {
    vi.mocked(listAccessibleCompanies).mockResolvedValue([alphaCompany])

    const response = await GET(request(undefined, "https:"))

    expect(response.headers.get("set-cookie")).toContain("Secure")
  })

  it("restores a valid company for a multi-company user", async () => {
    const response = await GET(request(betaCompany.id))

    await expect(response.json()).resolves.toEqual({
      status: "resolved",
      activeCompany: betaCompany,
      companies,
      permissions: [
        "company.context.read",
        "policy.read",
        "workflow.read",
        "workflow.run",
      ],
    })
    expect(response.cookies.get(ACTIVE_COMPANY_COOKIE)?.value).toBe(
      betaCompany.id
    )
  })

  it("clears a stale value and requires a choice from authorized companies", async () => {
    const response = await GET(request("20000000-0000-4000-8000-000000000099"))

    await expect(response.json()).resolves.toEqual({
      status: "company_selection_required",
      activeCompany: null,
      companies,
      permissions: [],
    })
    expect(response.cookies.get(ACTIVE_COMPANY_COOKIE)?.value).toBe("")
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0")
  })

  it("returns a distinct zero-company state and clears stale context", async () => {
    vi.mocked(listAccessibleCompanies).mockResolvedValue([])

    const response = await GET(request(alphaCompany.id))

    await expect(response.json()).resolves.toEqual({
      status: "no_companies",
      activeCompany: null,
      companies: [],
      permissions: [],
    })
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0")
  })

  it("ignores browser cookie context for bearer-authenticated requests", async () => {
    vi.mocked(authenticateRequest).mockResolvedValue({
      ...auth,
      authMode: "bearer",
    } as never)

    const response = await GET(request(alphaCompany.id))

    await expect(response.json()).resolves.toMatchObject({
      status: "company_selection_required",
      activeCompany: null,
      permissions: [],
    })
    expect(response.headers.get("set-cookie")).toBeNull()
  })

  it("selects and persists an accessible company for cookie auth", async () => {
    const response = await PUT(selectionRequest(betaCompany.id))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      status: "resolved",
      activeCompany: betaCompany,
      companies,
      permissions: [
        "company.context.read",
        "policy.read",
        "workflow.read",
        "workflow.run",
      ],
    })
    expect(response.cookies.get(ACTIVE_COMPANY_COOKIE)?.value).toBe(
      betaCompany.id
    )
    expect(listAccessibleCompanies).toHaveBeenCalledWith({
      supabase: auth.supabase,
      userId: auth.user.id,
    })
  })

  it("rejects invalid and inaccessible selections without setting a cookie", async () => {
    const invalid = await PUT(selectionRequest("not-a-uuid"))
    expect(invalid.status).toBe(400)
    await expect(invalid.json()).resolves.toEqual({ error: "invalid_request" })
    expect(listAccessibleCompanies).not.toHaveBeenCalled()

    const inaccessible = await PUT(
      selectionRequest("20000000-0000-4000-8000-000000000099")
    )
    expect(inaccessible.status).toBe(404)
    await expect(inaccessible.json()).resolves.toEqual({
      error: "company_not_accessible",
    })
    expect(inaccessible.headers.get("set-cookie")).toBeNull()
  })

  it("does not create web session state from bearer authentication", async () => {
    vi.mocked(authenticateRequest).mockResolvedValue({
      ...auth,
      authMode: "bearer",
    } as never)

    const response = await PUT(selectionRequest(alphaCompany.id))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: "cookie_auth_required",
    })
    expect(listAccessibleCompanies).not.toHaveBeenCalled()
  })

  it("maps company lookup failures without leaking provider details", async () => {
    vi.mocked(listAccessibleCompanies).mockRejectedValue(
      new Error("sensitive provider payload")
    )

    const response = await GET(request())

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      error: "company_context_failed",
    })
  })
})

function request(companyId?: string, protocol = "http:") {
  const headers = new Headers()
  if (companyId) {
    headers.set("cookie", `${ACTIVE_COMPANY_COOKIE}=${companyId}`)
  }
  return new NextRequest(
    `${protocol}//localhost/api/mandala/companies/active`,
    {
      headers,
    }
  )
}

function selectionRequest(companyId: string) {
  return new NextRequest("http://localhost/api/mandala/companies/active", {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost",
    },
    body: JSON.stringify({ companyId }),
  })
}
