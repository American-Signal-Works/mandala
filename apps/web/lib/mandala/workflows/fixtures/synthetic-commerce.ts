import { createHash } from "node:crypto"
import type { ProcurementSkuSnapshot } from "./procurement"

export const syntheticCommerceProductCount = 1_200
export const syntheticCommerceHistoryDays = 90
export const syntheticCommerceBusinessName = "Mandala Bean Co."

export type SyntheticSalesRecord = {
  sku: string
  date: string
  units: number
  channel: "cafe" | "online" | "wholesale"
}

export type SyntheticBusinessEvent = {
  id: string
  sku: string
  type:
    | "inventory_adjustment"
    | "promotion_started"
    | "supplier_delay"
    | "open_purchase_order"
  occurredAt: string
  description: string
}

export type SyntheticCommerceProduct = ProcurementSkuSnapshot & {
  category: string
  salesSpike: boolean
  inventoryReduced: boolean
}

export type SyntheticCommerceDatasetSummary = {
  businessName: string
  seed: string
  digest: string
  generatedAt: string
  productCount: number
  salesRecordCount: number
  businessEventCount: number
  lowInventoryCount: number
  salesSpikeCount: number
  staleInventoryCount: number
  duplicateOpenOrderCount: number
}

export type SyntheticCommerceDataset = {
  summary: SyntheticCommerceDatasetSummary
  products: SyntheticCommerceProduct[]
  sales: SyntheticSalesRecord[]
  events: SyntheticBusinessEvent[]
}

const categories = [
  "Coffee Beans",
  "Tea",
  "Mugs",
  "Brewing Gear",
  "Filters",
  "Syrups",
  "Accessories",
  "Gift Sets",
] as const
const productNouns = [
  "High Desert Espresso Beans",
  "Moonrise House Blend",
  "Ethiopian Natural Beans",
  "Cardamom Chai",
  "Roasted Oolong Tea",
  "Ceremonial Matcha",
  "Stoneware Cafe Mug",
  "Insulated Travel Mug",
  "Pour-Over Brewer",
  "French Press",
  "Bamboo Coffee Filters",
  "Vanilla Bean Syrup",
  "Hand Grinder",
  "Coffee Scoop",
  "Cold Brew Bottle",
  "Weekend Tasting Gift Set",
] as const
const vendors = [
  "Northstar Coffee Importers",
  "Juniper Tea & Spice",
  "Mesa Ceramic Works",
  "Copper Kettle Supply",
  "Paper Moon Filter Co.",
  "Hearthside Syrup Works",
  "Copper Kettle Supply",
  "Mandala Bean Co. Assembly",
] as const
const channels = ["cafe", "online", "wholesale"] as const

export function generateSyntheticCommerceDataset(input: {
  seed: string
  generatedAt?: Date
  productCount?: number
  historyDays?: number
}): SyntheticCommerceDataset {
  const productCount = Math.max(
    1_000,
    Math.min(input.productCount ?? syntheticCommerceProductCount, 2_500)
  )
  const historyDays = Math.max(
    30,
    Math.min(input.historyDays ?? syntheticCommerceHistoryDays, 180)
  )
  const generatedAt = input.generatedAt ?? new Date()
  const random = seededRandom(input.seed)
  const products: SyntheticCommerceProduct[] = []
  const sales: SyntheticSalesRecord[] = []
  const events: SyntheticBusinessEvent[] = []
  const skuPrefix = createHash("sha256")
    .update(input.seed)
    .digest("hex")
    .slice(0, 6)
    .toUpperCase()

  for (let index = 0; index < productCount; index += 1) {
    const sku = `SYN-${skuPrefix}-${String(index + 1).padStart(4, "0")}`
    const baseDailySales = integer(random, 2, 18)
    const salesSpike = index % 17 === 0 || random() < 0.045
    const inventoryReduced = index % 9 === 0 || random() < 0.08
    const staleInventory = index % 101 === 0 && index !== 0
    const duplicateOpenOrder = index % 67 === 0 && index !== 0
    let recent30DaySales = 0
    let trailing90DaySales = 0

    for (let daysAgo = historyDays - 1; daysAgo >= 0; daysAgo -= 1) {
      const date = new Date(generatedAt)
      date.setUTCDate(date.getUTCDate() - daysAgo)
      const recentSpike = salesSpike && daysAgo < 10 ? 2.2 : 1
      const weekday = date.getUTCDay()
      const weekdayFactor = weekday === 0 || weekday === 6 ? 1.18 : 0.96
      const units = Math.max(
        0,
        Math.round(
          baseDailySales *
            recentSpike *
            weekdayFactor *
            (0.72 + random() * 0.56)
        )
      )
      trailing90DaySales += units
      if (daysAgo < 30) recent30DaySales += units
      sales.push({
        sku,
        date: date.toISOString().slice(0, 10),
        units,
        channel: channels[index % channels.length]!,
      })
    }

    const leadTimeDays = integer(random, 7, 28)
    const reorderPoint = Math.max(
      24,
      Math.round(baseDailySales * leadTimeDays * 0.72)
    )
    const inventoryOnHand = inventoryReduced
      ? integer(random, 0, Math.max(1, Math.floor(reorderPoint * 0.42)))
      : integer(random, reorderPoint + 10, reorderPoint * 3)
    const duplicateOpenOrderUnits = duplicateOpenOrder
      ? integer(random, reorderPoint, reorderPoint * 2)
      : 0
    const recentDaily = recent30DaySales / 30
    const trailingDaily = trailing90DaySales / historyDays
    const recentSpikeMultiplier = roundToTwo(
      Math.max(0.75, recentDaily / Math.max(0.1, trailingDaily))
    )
    const product: SyntheticCommerceProduct = {
      sku,
      title: `${productNouns[index % productNouns.length]} ${index + 1}`,
      category: categories[index % categories.length]!,
      vendor: vendors[index % vendors.length]!,
      inventoryOnHand,
      inboundUnits: index % 13 === 0 ? integer(random, 6, 48) : 0,
      reorderPoint,
      safetyStockUnits: Math.max(12, Math.round(reorderPoint * 0.7)),
      vendorMinimumOrderQuantity: [48, 72, 96, 120][index % 4]!,
      vendorPackSize: [6, 12, 24][index % 3]!,
      leadTimeDays,
      recent30DaySales,
      trailing90DaySales,
      seasonalIndex: roundToTwo(0.9 + random() * 0.35),
      recentSpikeMultiplier,
      dataFreshnessHours: staleInventory ? 120 : integer(random, 1, 18),
      duplicateOpenOrderUnits,
      salesSpike,
      inventoryReduced,
    }
    products.push(product)

    if (inventoryReduced) {
      events.push({
        id: eventId(input.seed, sku, "inventory_adjustment"),
        sku,
        type: "inventory_adjustment",
        occurredAt: offsetDate(generatedAt, -(index % 8)).toISOString(),
        description:
          "Synthetic stock count was reduced to create reorder pressure.",
      })
    }
    if (salesSpike) {
      events.push({
        id: eventId(input.seed, sku, "promotion_started"),
        sku,
        type: "promotion_started",
        occurredAt: offsetDate(generatedAt, -9).toISOString(),
        description: "Synthetic promotion increased recent sales velocity.",
      })
    }
    if (staleInventory) {
      events.push({
        id: eventId(input.seed, sku, "supplier_delay"),
        sku,
        type: "supplier_delay",
        occurredAt: offsetDate(generatedAt, -5).toISOString(),
        description: "Synthetic source freshness is intentionally stale.",
      })
    }
    if (duplicateOpenOrder) {
      events.push({
        id: eventId(input.seed, sku, "open_purchase_order"),
        sku,
        type: "open_purchase_order",
        occurredAt: offsetDate(generatedAt, -3).toISOString(),
        description: "Synthetic open order should block duplicate procurement.",
      })
    }
  }

  const digest = createHash("sha256")
    .update(
      JSON.stringify({
        seed: input.seed,
        products,
        sales,
        events,
      })
    )
    .digest("hex")

  return {
    summary: {
      businessName: syntheticCommerceBusinessName,
      seed: input.seed,
      digest,
      generatedAt: generatedAt.toISOString(),
      productCount: products.length,
      salesRecordCount: sales.length,
      businessEventCount: events.length,
      lowInventoryCount: products.filter(
        (product) =>
          product.inventoryOnHand + product.inboundUnits <= product.reorderPoint
      ).length,
      salesSpikeCount: products.filter((product) => product.salesSpike).length,
      staleInventoryCount: products.filter(
        (product) => product.dataFreshnessHours > 72
      ).length,
      duplicateOpenOrderCount: products.filter(
        (product) => product.duplicateOpenOrderUnits > 0
      ).length,
    },
    products,
    sales,
    events,
  }
}

export function findSyntheticCandidates(
  dataset: SyntheticCommerceDataset,
  input: {
    limit?: number
    minimumSpikeMultiplier?: number
    sort?: "stockout_risk" | "sales_spike" | "largest_gap"
  } = {}
): SyntheticCommerceProduct[] {
  const limit = Math.max(1, Math.min(input.limit ?? 20, 50))
  const minimumSpike = input.minimumSpikeMultiplier ?? 0
  const candidates = dataset.products.filter(
    (product) =>
      product.inventoryOnHand + product.inboundUnits <= product.reorderPoint &&
      product.dataFreshnessHours <= 72 &&
      product.duplicateOpenOrderUnits === 0 &&
      product.recentSpikeMultiplier >= minimumSpike
  )
  const score = (product: SyntheticCommerceProduct) => {
    const gap =
      product.reorderPoint - (product.inventoryOnHand + product.inboundUnits)
    if (input.sort === "sales_spike") return product.recentSpikeMultiplier
    if (input.sort === "largest_gap") return gap
    return gap * Math.max(1, product.recentSpikeMultiplier)
  }
  return candidates
    .sort((left, right) => score(right) - score(left))
    .slice(0, limit)
}

export function syntheticSkuDetail(
  dataset: SyntheticCommerceDataset,
  sku: string
): {
  product: SyntheticCommerceProduct
  recentSales: SyntheticSalesRecord[]
  events: SyntheticBusinessEvent[]
} | null {
  const product = dataset.products.find((candidate) => candidate.sku === sku)
  if (!product) return null
  return {
    product,
    recentSales: dataset.sales
      .filter((record) => record.sku === sku)
      .slice(-14),
    events: dataset.events.filter((event) => event.sku === sku),
  }
}

function seededRandom(seed: string): () => number {
  let state = createHash("sha256").update(seed).digest().readUInt32LE(0)
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0
    return state / 0x1_0000_0000
  }
}

function integer(
  random: () => number,
  minimum: number,
  maximum: number
): number {
  return minimum + Math.floor(random() * (maximum - minimum + 1))
}

function eventId(seed: string, sku: string, type: string): string {
  return createHash("sha256")
    .update(`${seed}:${sku}:${type}`)
    .digest("hex")
    .slice(0, 24)
}

function offsetDate(date: Date, days: number): Date {
  const result = new Date(date)
  result.setUTCDate(result.getUTCDate() + days)
  return result
}

function roundToTwo(value: number): number {
  return Math.round(value * 100) / 100
}
