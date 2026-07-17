import { describe, expect, it } from "vitest"
import {
  sandboxSessionRequestSchema,
  sandboxSessionResponseSchema,
} from "../src/sandbox.js"

const response = {
  schemaVersion: 1,
  mode: "sandbox",
  ephemeral: true,
  companyId: "a2000000-0000-4000-8000-000000000001",
  sessionId: "a5000000-0000-4000-8000-000000000001",
  createdAt: "2026-07-16T04:00:00.000Z",
  dataAnchorAt: "2026-07-15",
  recordCount: 6,
  candidateCount: 1,
  sources: [
    {
      id: "a3000000-0000-4000-8000-000000000001",
      key: "shiphero",
      kind: "inventory_platform",
      name: "ShipHero",
      syncStatus: "idle",
      lastSyncedAt: "2026-07-16T04:00:00.000Z",
      recordCount: 4,
      freshestRecordAt: "2026-07-16T04:00:00.000Z",
      stale: false,
    },
  ],
  candidates: [
    {
      availableActions: ["approve", "edit", "request_rework", "reject"],
      sku: "SKU-REAL",
      productName: "Real Product",
      inventory: {
        onHand: 12,
        allocated: 2,
        available: -6,
        backorder: 2,
        reorderLevel: 20,
        reorderAmount: 30,
        pulledAt: "2026-07-16T04:00:00.000Z",
      },
      recentSalesUnits: 7,
      openPurchaseOrders: { count: 1, units: 5 },
      vendor: {
        name: "Real Vendor",
        vendorSku: "V-SKU-REAL",
        unitCost: 4,
        mappingConfidence: 0.98,
        mappingConfirmed: true,
      },
      trello: { openCardCount: 1, currentList: "Purchase Order Creation" },
      recommendation: {
        status: "ready_for_review",
        quantity: 25,
        reasons: ["Inventory is below its reorder level."],
        warnings: [],
      },
      sources: ["inventory_position", "sales_order"],
    },
  ],
}

describe("real-data Sandbox contracts", () => {
  it("defaults to a bounded candidate limit", () => {
    expect(
      sandboxSessionRequestSchema.parse({ companyId: response.companyId })
    ).toEqual({ companyId: response.companyId, candidateLimit: 25 })
    expect(() =>
      sandboxSessionRequestSchema.parse({
        companyId: response.companyId,
        candidateLimit: 101,
      })
    ).toThrow()
  })

  it("accepts the safe real-data projection", () => {
    expect(sandboxSessionResponseSchema.parse(response)).toEqual(response)
  })

  it("rejects unrestricted connector payload fields", () => {
    expect(
      sandboxSessionResponseSchema.safeParse({
        ...response,
        unrestrictedPayload: { warehouseId: "private" },
      }).success
    ).toBe(false)
  })
})
