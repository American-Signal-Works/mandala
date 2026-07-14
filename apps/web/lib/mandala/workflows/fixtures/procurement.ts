export type ProcurementFixtureScenarioId =
  | "clean_reorder"
  | "sales_spike_warning"
  | "duplicate_open_order"
  | "stale_inventory"
  | "no_action"
  | "edit_reorder"
  | "reject_reorder"
  | "synthetic_agent_run"

export type StaticProcurementFixtureScenarioId = Exclude<
  ProcurementFixtureScenarioId,
  "synthetic_agent_run"
>

export type ProcurementSkuSnapshot = {
  sku: string
  title: string
  vendor: string
  inventoryOnHand: number
  inboundUnits: number
  reorderPoint: number
  safetyStockUnits: number
  vendorMinimumOrderQuantity: number
  vendorPackSize: number
  leadTimeDays: number
  recent30DaySales: number
  trailing90DaySales: number
  seasonalIndex: number
  recentSpikeMultiplier: number
  dataFreshnessHours: number
  duplicateOpenOrderUnits: number
}

export type ProcurementFixtureScenario = {
  id: ProcurementFixtureScenarioId
  title: string
  sourceSnapshotId: string
  runReason: string
  expectedReviewDecision?: "edit" | "reject"
  sku: ProcurementSkuSnapshot
}

export const procurementFixtureScenarios: Record<
  StaticProcurementFixtureScenarioId,
  ProcurementFixtureScenario
> = {
  clean_reorder: {
    id: "clean_reorder",
    title: "Clean reorder recommendation",
    sourceSnapshotId: "inventory-snapshot-2026-07-09-clean",
    runReason: "Inventory below reorder point with fresh source data.",
    sku: {
      sku: "MDL-TEA-001",
      title: "Mandala Breakfast Tea",
      vendor: "Fixture Tea Supply",
      inventoryOnHand: 18,
      inboundUnits: 0,
      reorderPoint: 40,
      safetyStockUnits: 35,
      vendorMinimumOrderQuantity: 120,
      vendorPackSize: 24,
      leadTimeDays: 14,
      recent30DaySales: 210,
      trailing90DaySales: 480,
      seasonalIndex: 1.18,
      recentSpikeMultiplier: 1.08,
      dataFreshnessHours: 4,
      duplicateOpenOrderUnits: 0,
    },
  },
  sales_spike_warning: {
    id: "sales_spike_warning",
    title: "Reorder with sales spike warning",
    sourceSnapshotId: "inventory-snapshot-2026-07-09-spike",
    runReason:
      "Inventory below reorder point and recent sales velocity is unusually high.",
    sku: {
      sku: "MDL-CHAI-002",
      title: "Mandala Cardamom Chai",
      vendor: "Fixture Tea Supply",
      inventoryOnHand: 12,
      inboundUnits: 24,
      reorderPoint: 54,
      safetyStockUnits: 45,
      vendorMinimumOrderQuantity: 96,
      vendorPackSize: 24,
      leadTimeDays: 21,
      recent30DaySales: 330,
      trailing90DaySales: 540,
      seasonalIndex: 1.22,
      recentSpikeMultiplier: 1.9,
      dataFreshnessHours: 5,
      duplicateOpenOrderUnits: 0,
    },
  },
  duplicate_open_order: {
    id: "duplicate_open_order",
    title: "Duplicate open order risk",
    sourceSnapshotId: "inventory-snapshot-2026-07-09-duplicate",
    runReason:
      "Inventory is low but an existing open order covers projected need.",
    sku: {
      sku: "MDL-COCOA-003",
      title: "Mandala Drinking Cocoa",
      vendor: "Fixture Cocoa Works",
      inventoryOnHand: 16,
      inboundUnits: 0,
      reorderPoint: 48,
      safetyStockUnits: 40,
      vendorMinimumOrderQuantity: 80,
      vendorPackSize: 20,
      leadTimeDays: 18,
      recent30DaySales: 180,
      trailing90DaySales: 420,
      seasonalIndex: 1.05,
      recentSpikeMultiplier: 1.02,
      dataFreshnessHours: 6,
      duplicateOpenOrderUnits: 140,
    },
  },
  stale_inventory: {
    id: "stale_inventory",
    title: "Stale inventory data",
    sourceSnapshotId: "inventory-snapshot-2026-07-02-stale",
    runReason:
      "Inventory is below reorder point but source data is too stale to recommend execution.",
    sku: {
      sku: "MDL-HONEY-004",
      title: "Mandala Wildflower Honey",
      vendor: "Fixture Apiary",
      inventoryOnHand: 8,
      inboundUnits: 0,
      reorderPoint: 36,
      safetyStockUnits: 30,
      vendorMinimumOrderQuantity: 72,
      vendorPackSize: 12,
      leadTimeDays: 15,
      recent30DaySales: 150,
      trailing90DaySales: 390,
      seasonalIndex: 1.12,
      recentSpikeMultiplier: 1.04,
      dataFreshnessHours: 176,
      duplicateOpenOrderUnits: 0,
    },
  },
  no_action: {
    id: "no_action",
    title: "Inventory above reorder point",
    sourceSnapshotId: "inventory-snapshot-2026-07-09-no-action",
    runReason:
      "Inventory is above reorder point, so the event should be suppressed.",
    sku: {
      sku: "MDL-JAM-005",
      title: "Mandala Berry Jam",
      vendor: "Fixture Preserves",
      inventoryOnHand: 220,
      inboundUnits: 0,
      reorderPoint: 80,
      safetyStockUnits: 60,
      vendorMinimumOrderQuantity: 96,
      vendorPackSize: 24,
      leadTimeDays: 12,
      recent30DaySales: 75,
      trailing90DaySales: 210,
      seasonalIndex: 1,
      recentSpikeMultiplier: 0.98,
      dataFreshnessHours: 3,
      duplicateOpenOrderUnits: 0,
    },
  },
  edit_reorder: {
    id: "edit_reorder",
    title: "Reorder requiring a quantity edit",
    sourceSnapshotId: "inventory-snapshot-2026-07-09-edit",
    runReason:
      "Inventory is low and the fixture expects a reviewer to edit the proposed quantity.",
    expectedReviewDecision: "edit",
    sku: {
      sku: "MDL-MATCHA-006",
      title: "Mandala Ceremonial Matcha",
      vendor: "Fixture Tea Supply",
      inventoryOnHand: 9,
      inboundUnits: 0,
      reorderPoint: 36,
      safetyStockUnits: 30,
      vendorMinimumOrderQuantity: 72,
      vendorPackSize: 12,
      leadTimeDays: 14,
      recent30DaySales: 150,
      trailing90DaySales: 390,
      seasonalIndex: 1.08,
      recentSpikeMultiplier: 1.04,
      dataFreshnessHours: 3,
      duplicateOpenOrderUnits: 0,
    },
  },
  reject_reorder: {
    id: "reject_reorder",
    title: "Reorder requiring rejection",
    sourceSnapshotId: "inventory-snapshot-2026-07-09-reject",
    runReason:
      "Inventory is low and the fixture expects the reviewer to reject the proposed action.",
    expectedReviewDecision: "reject",
    sku: {
      sku: "MDL-OOLONG-007",
      title: "Mandala Roasted Oolong",
      vendor: "Fixture Tea Supply",
      inventoryOnHand: 14,
      inboundUnits: 0,
      reorderPoint: 42,
      safetyStockUnits: 36,
      vendorMinimumOrderQuantity: 84,
      vendorPackSize: 12,
      leadTimeDays: 16,
      recent30DaySales: 165,
      trailing90DaySales: 450,
      seasonalIndex: 1.05,
      recentSpikeMultiplier: 1.02,
      dataFreshnessHours: 4,
      duplicateOpenOrderUnits: 0,
    },
  },
}

export function getProcurementFixtureScenario<
  ScenarioId extends StaticProcurementFixtureScenarioId,
>(id: ScenarioId): ProcurementFixtureScenario & { id: ScenarioId } {
  return procurementFixtureScenarios[id] as ProcurementFixtureScenario & {
    id: ScenarioId
  }
}
