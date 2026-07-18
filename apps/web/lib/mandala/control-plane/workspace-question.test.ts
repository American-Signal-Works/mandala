import { describe, expect, it } from "vitest"
import type {
  WorkspaceDataStore,
  WorkspaceExternalRecord,
  WorkspaceSourceCoverage,
} from "../workspace-data/provider"
import {
  answerOpenPurchaseOrderCount,
  isOpenPurchaseOrderCountQuestion,
} from "./workspace-question"

const companyId = "20000000-0000-0000-0000-000000000001"

describe("workspace questions", () => {
  it("recognizes a natural open-PO count question", () => {
    expect(
      isOpenPurchaseOrderCountQuestion("how many open POs do we have")
    ).toBe(true)
    expect(isOpenPurchaseOrderCountQuestion("approve the open PO")).toBe(false)
  })

  it("answers from authoritative records and reports unmatched tracking evidence", async () => {
    const answer = await answerOpenPurchaseOrderCount(
      companyId,
      store({
        purchase_order: [purchaseOrder("PO-1"), purchaseOrder("PO-2")],
        board_card: [trackingCard("PO-1"), trackingCard("PO-3")],
      })
    )

    expect(answer).toBe(
      "ShipHero shows 2 open POs. I also checked Trello: 1 open procurement tracking card is not deterministically linked to an authoritative PO, and 1 matches the same PO."
    )
  })

  it("refuses a definitive zero when a relevant source is unavailable", async () => {
    const answer = await answerOpenPurchaseOrderCount(
      companyId,
      store({ purchase_order: [], board_card: [] }, { tracking: "unavailable" })
    )

    expect(answer).toContain("can’t safely give an open-PO count")
    expect(answer).toContain("Trello is unavailable")
  })
})

function store(
  records: Record<string, WorkspaceExternalRecord[]>,
  statuses: Partial<
    Record<"authoritative" | "tracking", WorkspaceSourceCoverage["status"]>
  > = {}
): WorkspaceDataStore {
  return {
    resolveMapping: async () => {
      throw new Error("not used")
    },
    loadRecords: async ({ recordType }) => records[recordType] ?? [],
    inspectCoverage: async ({ evidenceRole, recordType }) => {
      const role = evidenceRole ?? "authoritative"
      const sourceKey = role === "tracking" ? "trello" : "shiphero"
      return [
        {
          sourceId: `${sourceKey}-source`,
          sourceKey,
          recordType,
          evidenceRole: role,
          status: statuses[role as "authoritative" | "tracking"] ?? "checked",
          recordCount: records[recordType]?.length ?? 0,
          checkedAt: "2026-07-18T16:00:00.000Z",
          freshestObservedAt: "2026-07-18T15:00:00.000Z",
        },
      ]
    },
  }
}

function purchaseOrder(reference: string): WorkspaceExternalRecord {
  return {
    id: `shiphero-${reference}`,
    companyId,
    sourceId: "shiphero-source",
    sourceKey: "shiphero",
    recordType: "purchase_order",
    externalId: reference,
    payload: {
      po_number: reference,
      fulfillment_status: "pending",
      lines: [{ sku: `SKU-${reference}`, quantity: 1 }],
    },
    pulledAt: "2026-07-18T15:00:00.000Z",
  }
}

function trackingCard(reference: string): WorkspaceExternalRecord {
  return {
    id: `trello-${reference}`,
    companyId,
    sourceId: "trello-source",
    sourceKey: "trello",
    recordType: "board_card",
    externalId: reference,
    payload: {
      order_number: reference,
      sku: `SKU-${reference}`,
      list_name: "Purchase Order Confirmed",
      closed: false,
    },
    pulledAt: "2026-07-18T15:00:00.000Z",
  }
}
