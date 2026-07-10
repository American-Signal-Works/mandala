import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  ControlPlaneQueryError,
  getWorkflowItemDetail,
  listAccessibleCompanies,
  listWorkflowItems,
} from "@/lib/mandala/control-plane/queries"
import { authenticateRequest } from "@/lib/supabase/request"
import { GET as listCompanies } from "./companies/route"
import { GET as listItems } from "./workflows/items/route"
import { GET as inspectItem } from "./workflows/items/[itemId]/route"

vi.mock("@/lib/supabase/request", () => ({ authenticateRequest: vi.fn() }))
vi.mock("@/lib/mandala/control-plane/queries", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/lib/mandala/control-plane/queries")>()
  return {
    ...original,
    listAccessibleCompanies: vi.fn(),
    listWorkflowItems: vi.fn(),
    getWorkflowItemDetail: vi.fn(),
  }
})

const companyId = "20000000-0000-0000-0000-000000000001"
const itemId = "33000000-0000-0000-0000-000000000001"
const auth = {
  authMode: "bearer",
  supabase: {},
  user: { id: "10000000-0000-0000-0000-000000000001" },
}

describe("Mandala control-plane read routes", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateRequest).mockResolvedValue(auth as never)
  })

  it("lists only the authenticated user's company projection", async () => {
    vi.mocked(listAccessibleCompanies).mockResolvedValue([
      {
        id: companyId,
        name: "Fixture Company",
        role: "owner",
        updatedAt: "2026-07-09T12:00:00Z",
      },
    ])

    const response = await listCompanies(
      new Request("http://localhost/api/mandala/companies")
    )

    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    await expect(response.json()).resolves.toEqual({
      companies: [
        {
          id: companyId,
          name: "Fixture Company",
          role: "owner",
          updatedAt: "2026-07-09T12:00:00Z",
        },
      ],
    })
    expect(listAccessibleCompanies).toHaveBeenCalledWith({
      supabase: auth.supabase,
      userId: auth.user.id,
    })
  })

  it("validates and forwards bounded item-list filters", async () => {
    vi.mocked(listWorkflowItems).mockResolvedValue([])

    const response = await listItems(
      new Request(
        `http://localhost/api/mandala/workflows/items?companyId=${companyId}&status=active,approved&limit=25`
      )
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ items: [] })
    expect(listWorkflowItems).toHaveBeenCalledWith({
      supabase: auth.supabase,
      companyId,
      statuses: ["active", "approved"],
      limit: 25,
    })
  })

  it("rejects invalid item-list input before querying", async () => {
    const response = await listItems(
      new Request(
        `http://localhost/api/mandala/workflows/items?companyId=${companyId}&status=unknown`
      )
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: "invalid_request" })
    expect(listWorkflowItems).not.toHaveBeenCalled()
  })

  it("returns item detail and maps tenant-safe absence to 404", async () => {
    const detail = {
      item: {
        id: itemId,
        workflowRunId: "31000000-0000-0000-0000-000000000001",
        itemType: "example_review",
        title: "Review example",
        status: "active",
        priority: 50,
        resolutionState: {},
        createdAt: "2026-07-09T12:00:00.000Z",
        updatedAt: "2026-07-09T12:00:00.000Z",
      },
      contextPacket: null,
      recommendation: null,
      evidence: null,
      draft: null,
      decision: null,
      attempt: null,
      auditEvents: [],
    }
    vi.mocked(getWorkflowItemDetail).mockResolvedValueOnce(detail as never)

    const success = await inspectItem(
      new Request(
        `http://localhost/api/mandala/workflows/items/${itemId}?companyId=${companyId}`
      ),
      { params: Promise.resolve({ itemId }) }
    )
    expect(success.status).toBe(200)
    await expect(success.json()).resolves.toEqual(detail)

    vi.mocked(getWorkflowItemDetail).mockRejectedValueOnce(
      new ControlPlaneQueryError("item_not_found")
    )
    const missing = await inspectItem(
      new Request(
        `http://localhost/api/mandala/workflows/items/${itemId}?companyId=${companyId}`
      ),
      { params: Promise.resolve({ itemId }) }
    )
    expect(missing.status).toBe(404)
    await expect(missing.json()).resolves.toEqual({ error: "item_not_found" })
  })

  it("requires authentication for every read route", async () => {
    vi.mocked(authenticateRequest).mockResolvedValue(null)

    const responses = await Promise.all([
      listCompanies(new Request("http://localhost/api/mandala/companies")),
      listItems(
        new Request(
          `http://localhost/api/mandala/workflows/items?companyId=${companyId}`
        )
      ),
      inspectItem(
        new Request(
          `http://localhost/api/mandala/workflows/items/${itemId}?companyId=${companyId}`
        ),
        { params: Promise.resolve({ itemId }) }
      ),
    ])

    expect(responses.map((response) => response.status)).toEqual([
      401, 401, 401,
    ])
  })
})
