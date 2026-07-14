import { describe, expect, it } from "vitest"
import {
  findSyntheticCandidates,
  generateSyntheticCommerceDataset,
  syntheticSkuDetail,
} from "./synthetic-commerce"

describe("synthetic commerce dataset", () => {
  it("generates a reproducible dataset with at least one thousand products", () => {
    const first = generateSyntheticCommerceDataset({
      seed: "stable-test-seed",
      generatedAt: new Date("2026-07-12T12:00:00.000Z"),
    })
    const second = generateSyntheticCommerceDataset({
      seed: "stable-test-seed",
      generatedAt: new Date("2026-07-12T12:00:00.000Z"),
    })

    expect(first.summary).toEqual(second.summary)
    expect(first.summary.productCount).toBe(1_200)
    expect(first.summary.salesRecordCount).toBe(108_000)
    expect(first.summary.businessEventCount).toBeGreaterThan(100)
    expect(first.summary.lowInventoryCount).toBeGreaterThan(100)
    expect(first.summary.salesSpikeCount).toBeGreaterThan(50)
    expect(first.summary.digest).toHaveLength(64)
  })

  it("offers safe bounded candidate search and detailed sales evidence", () => {
    const dataset = generateSyntheticCommerceDataset({ seed: "candidate-test" })
    const candidates = findSyntheticCandidates(dataset, {
      limit: 10,
      sort: "sales_spike",
    })

    expect(candidates).toHaveLength(10)
    expect(
      candidates.every(
        (candidate) =>
          candidate.inventoryOnHand + candidate.inboundUnits <=
            candidate.reorderPoint &&
          candidate.dataFreshnessHours <= 72 &&
          candidate.duplicateOpenOrderUnits === 0
      )
    ).toBe(true)
    const detail = syntheticSkuDetail(dataset, candidates[0]!.sku)
    expect(detail?.recentSales).toHaveLength(14)
    expect(detail?.product.sku).toBe(candidates[0]!.sku)
  })
})
