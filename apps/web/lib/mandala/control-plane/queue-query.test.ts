import { describe, expect, it } from "vitest"
import {
  DEFAULT_ACTIONABLE_STATUSES,
  parseQueueSearchParams,
  queueCursorBinding,
} from "./queue-query"

const companyId = "20000000-0000-0000-0000-000000000001"
const invalidQueries: Array<Record<string, string>> = [
  { status: "unknown" },
  { search: "bad\u0000query" },
  { limit: "101" },
  { sort: "title:asc" },
  { statuses: "active", status: "blocked" },
  { itemTypes: "" },
]

describe("queue query grammar", () => {
  it("defaults to the actionable statuses and a deterministic priority sort", () => {
    const parsed = parseQueueSearchParams(new URLSearchParams({ companyId }))

    expect(parsed).toEqual({
      success: true,
      data: expect.objectContaining({
        statuses: [...DEFAULT_ACTIONABLE_STATUSES].sort(),
        sort: { key: "priority", direction: "desc" },
        limit: 50,
      }),
    })
  })

  it("normalizes all AND-combined filters and legacy singular aliases", () => {
    const parsed = parseQueueSearchParams(
      new URLSearchParams({
        companyId,
        search: "  SKU-123 / Vendor  ",
        status: "approved,active,active",
        itemTypes: "stock_review,po_review",
        priorities: "50,10",
        sourceType: "fixture",
        ownerRoles: "approver,admin",
        assigneeId: "10000000-0000-0000-0000-000000000001",
        sort: "updatedAt:asc",
        limit: "25",
      })
    )

    expect(parsed).toEqual({
      success: true,
      data: {
        companyId,
        search: "SKU-123 / Vendor",
        statuses: ["active", "approved"],
        itemTypes: ["po_review", "stock_review"],
        priorities: [10, 50],
        sourceTypes: ["fixture"],
        ownerRoles: ["admin", "approver"],
        assigneeIds: ["10000000-0000-0000-0000-000000000001"],
        sort: { key: "updatedAt", direction: "asc" },
        limit: 25,
      },
    })
  })

  it.each(invalidQueries)(
    "rejects unsupported or ambiguous input %#",
    (query) => {
      expect(
        parseQueueSearchParams(new URLSearchParams({ companyId, ...query }))
          .success
      ).toBe(false)
    }
  )

  it("does not bind the encoded cursor into its own query hash", () => {
    const parsed = parseQueueSearchParams(
      new URLSearchParams({ companyId, cursor: "opaque" })
    )
    expect(parsed.success).toBe(true)
    if (!parsed.success) return

    expect(queueCursorBinding(parsed.data)).not.toHaveProperty("cursor")
  })
})
