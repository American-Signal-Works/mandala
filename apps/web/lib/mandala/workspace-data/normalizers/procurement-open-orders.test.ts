import { describe, expect, it } from "vitest"
import type { WorkspaceExternalRecord } from "../provider"
import {
  normalizeProcurementOpenOrderObjects,
  normalizeProcurementOpenOrders,
} from "./procurement-open-orders"

describe("procurement open-order normalization", () => {
  it("finds a ShipHero-only purchase order", () => {
    const result = normalizeProcurementOpenOrders([
      { role: "authoritative", records: [purchaseOrder()] },
    ])

    expect(result.get("SKU-1")).toEqual([
      expect.objectContaining({ quantity: 12, roles: ["authoritative"] }),
    ])
  })

  it("finds a Trello-only procurement card", () => {
    const result = normalizeProcurementOpenOrders([
      {
        role: "tracking",
        records: [trackingCard({ payload: { order_quantity: 8 } })],
      },
    ])

    expect(result.get("SKU-1")).toEqual([
      expect.objectContaining({ quantity: 8, roles: ["tracking"] }),
    ])
  })

  it("ignores a generic Trello card that merely contains a SKU", () => {
    const result = normalizeProcurementOpenOrders([
      {
        role: "tracking",
        records: [
          trackingCard({
            payload: {
              purchase_order_number: null,
              list_name: "Engineering Backlog",
            },
          }),
        ],
      },
    ])

    expect(result.size).toBe(0)
  })

  it("does not treat a generic order number as procurement evidence", () => {
    const result = normalizeProcurementOpenOrderObjects([
      {
        role: "tracking",
        records: [
          trackingCard({
            payload: {
              purchase_order_number: null,
              order_number: "TO-42",
              order_type: "TO",
              list_name: "Transfer Orders to be Picked",
            },
          }),
        ],
      },
    ])

    expect(result).toEqual([])
  })

  it("deduplicates one PO represented by two sources and retains both citations", () => {
    const result = normalizeProcurementOpenOrders([
      { role: "authoritative", records: [purchaseOrder()] },
      { role: "tracking", records: [trackingCard()] },
    ])

    expect(result.get("SKU-1")).toEqual([
      expect.objectContaining({
        quantity: 12,
        roles: ["authoritative", "tracking"],
        sources: [
          expect.objectContaining({ sourceKey: "shiphero" }),
          expect.objectContaining({ sourceKey: "trello" }),
        ],
      }),
    ])
  })

  it("counts one business PO across multiple SKUs and sources", () => {
    const result = normalizeProcurementOpenOrderObjects([
      {
        role: "authoritative",
        records: [
          purchaseOrder({
            payload: {
              lines: [
                { sku: "SKU-1", quantity: 12 },
                { sku: "SKU-2", quantity: 4 },
              ],
            },
          }),
        ],
      },
      { role: "tracking", records: [trackingCard()] },
    ])

    expect(result).toEqual([
      expect.objectContaining({
        key: "po:PO-42",
        roles: ["authoritative", "tracking"],
      }),
    ])
  })

  it("returns no match for closed operational and tracking records", () => {
    const result = normalizeProcurementOpenOrders([
      {
        role: "authoritative",
        records: [
          purchaseOrder({ payload: { fulfillment_status: "fulfilled" } }),
        ],
      },
      {
        role: "tracking",
        records: [trackingCard({ payload: { closed: true } })],
      },
    ])

    expect(result.size).toBe(0)
  })

  it("does not treat a received Trello card as an open PO", () => {
    const result = normalizeProcurementOpenOrderObjects([
      {
        role: "tracking",
        records: [
          trackingCard({ payload: { list_name: "Purchase Order Received" } }),
        ],
      },
    ])

    expect(result).toEqual([])
  })
})

function purchaseOrder(
  overrides: Partial<WorkspaceExternalRecord> = {}
): WorkspaceExternalRecord {
  const { payload, ...recordOverrides } = overrides
  return {
    id: "po-record",
    companyId: "company",
    sourceId: "shiphero-source",
    sourceKey: "shiphero",
    recordType: "purchase_order",
    externalId: "PO-42",
    payload: {
      purchase_order_number: "PO-42",
      fulfillment_status: "pending",
      lines: [{ sku: "SKU-1", quantity: 12 }],
      ...payload,
    },
    pulledAt: "2026-07-17T18:00:00.000Z",
    ...recordOverrides,
  }
}

function trackingCard(
  overrides: Partial<WorkspaceExternalRecord> = {}
): WorkspaceExternalRecord {
  const { payload, ...recordOverrides } = overrides
  return {
    id: "card-record",
    companyId: "company",
    sourceId: "trello-source",
    sourceKey: "trello",
    recordType: "board_card",
    externalId: "CARD-42",
    payload: {
      sku: "SKU-1",
      purchase_order_number: "PO-42",
      closed: false,
      list_name: "Purchase Order Creation",
      ...payload,
    },
    pulledAt: "2026-07-17T18:00:00.000Z",
    ...recordOverrides,
  }
}
