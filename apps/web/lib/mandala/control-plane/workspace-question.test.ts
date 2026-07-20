import { describe, expect, it } from "vitest"
import type {
  WorkspaceDataStore,
  WorkspaceExternalRecord,
  WorkspaceSourceCoverage,
} from "../workspace-data/provider"
import {
  answerLargestPastDatedOpenPurchaseOrder,
  answerOpenPurchaseOrderCount,
  isLargestPastDatedOpenPurchaseOrderQuestion,
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

  it("recognizes a largest late open-PO question without treating an approval as one", () => {
    expect(
      isLargestPastDatedOpenPurchaseOrderQuestion(
        "What's the biggest PO we have open that is late?"
      )
    ).toBe(true)
    expect(
      isLargestPastDatedOpenPurchaseOrderQuestion("approve the biggest open PO")
    ).toBe(false)
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

  it("identifies the largest open PO with a past PO date and explains the date limitation", async () => {
    const answer = await answerLargestPastDatedOpenPurchaseOrder(
      companyId,
      store({
        purchase_order: [
          purchaseOrder("A-1", {
            vendor_name: "Small Supply",
            po_date: "2026-05-01T00:00:00.000Z",
            total_price: "1200",
          }),
          purchaseOrder("A-2", {
            vendor_name: "Large Supply",
            po_date: "2026-05-20T00:00:00.000Z",
            total_price: "78950",
          }),
          purchaseOrder("A-3", {
            vendor_name: "Future Supply",
            po_date: "2026-08-01T00:00:00.000Z",
            total_price: "99999",
          }),
        ],
        board_card: [],
      }),
      new Date("2026-07-18T00:00:00.000Z")
    )

    expect(answer).toBe(
      "The largest open ShipHero PO with a past PO date is A-2 for $78,950 from Large Supply. Its PO date is May 20, 2026. ShipHero does not provide a separate due-date field in these records, so this proves the PO date is past, not that the vendor is contractually late."
    )
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

function purchaseOrder(
  reference: string,
  payload: Record<string, unknown> = {}
): WorkspaceExternalRecord {
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
      ...payload,
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
