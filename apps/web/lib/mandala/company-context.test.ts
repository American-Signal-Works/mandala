import { describe, expect, it } from "vitest"
import type { CompanySummary } from "@workspace/control-plane"
import { resolveActiveCompany, selectActiveCompany } from "./company-context"

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

describe("active company context", () => {
  it("returns a distinct empty state when the user has no companies", () => {
    expect(resolveActiveCompany([])).toEqual({
      status: "no_companies",
      activeCompany: null,
      companies: [],
      permissions: [],
    })
  })

  it("automatically resolves the only accessible company", () => {
    expect(resolveActiveCompany([alphaCompany], "not-a-valid-id")).toEqual({
      status: "resolved",
      activeCompany: alphaCompany,
      companies: [alphaCompany],
      permissions: expect.arrayContaining([
        "membership.manage",
        "workflow.execution.mock",
      ]),
    })
  })

  it("restores a stored company only when it is still accessible", () => {
    expect(resolveActiveCompany(companies, betaCompany.id)).toEqual({
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
  })

  it("requires selection when a multi-company stored value is missing or stale", () => {
    expect(resolveActiveCompany(companies)).toEqual({
      status: "company_selection_required",
      activeCompany: null,
      companies,
      permissions: [],
    })
    expect(
      resolveActiveCompany(companies, "20000000-0000-4000-8000-000000000099")
    ).toEqual({
      status: "company_selection_required",
      activeCompany: null,
      companies,
      permissions: [],
    })
  })

  it("selects only a company from the accessible projection", () => {
    expect(selectActiveCompany(companies, alphaCompany.id)).toEqual({
      status: "resolved",
      activeCompany: alphaCompany,
      companies,
      permissions: expect.arrayContaining([
        "membership.manage",
        "workflow.execution.mock",
      ]),
    })
    expect(
      selectActiveCompany(companies, "20000000-0000-4000-8000-000000000099")
    ).toBeNull()
  })
})
