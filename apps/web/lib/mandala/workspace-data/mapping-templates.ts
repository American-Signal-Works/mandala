import {
  workspaceCapabilityMappingSpecSchema,
  type WorkspaceCapabilityMappingSpec,
  type WorkspaceMappingExpression,
  type WorkspaceMappingFilter,
} from "@workspace/control-plane"

const literal = (
  value: string | number | boolean | null
): WorkspaceMappingExpression => ({ op: "literal", value, confirmed: true })
const first = (dataset: string, path: string): WorkspaceMappingExpression => ({
  op: "first",
  dataset,
  path,
})
const sum = (
  dataset: string,
  path: string,
  where?: WorkspaceMappingFilter[]
): WorkspaceMappingExpression => ({ op: "sum", dataset, path, where })
const coalesce = (
  ...operands: WorkspaceMappingExpression[]
): WorkspaceMappingExpression => ({
  op: "coalesce",
  operands,
})
const math = (
  op: "add" | "subtract" | "multiply" | "divide" | "max_of" | "min_of",
  ...operands: WorkspaceMappingExpression[]
): WorkspaceMappingExpression => ({ op, operands })
const withinDays = (days: number): WorkspaceMappingFilter => ({
  path: "/$parent/order_date",
  operator: "within_days",
  value: days,
})
const field = (
  name: string,
  expression: WorkspaceMappingExpression,
  classification: "internal" | "confidential" = "confidential"
) => ({
  name,
  expression,
  required: true,
  modelAllowed: true,
  classification,
})
const bounds = {
  maximumInputRows: 9_000,
  maximumOutputRows: 750,
  maximumOutputBytes: 1_048_576,
}

const inventoryDataset = {
  alias: "inventory",
  recordType: "inventory_position",
  entityPath: "/sku",
  maximumFreshnessHours: 72,
  required: true,
} as const
const salesDataset = {
  alias: "sales",
  recordType: "sales_order",
  rowsPath: "/lines",
  entityPath: "/sku",
  maximumFreshnessHours: 72,
  required: true,
} as const

const recentSales = sum("sales", "/quantity", [withinDays(30)])
const trailingSales = sum("sales", "/quantity", [withinDays(90)])

const templates: Record<string, WorkspaceCapabilityMappingSpec> = {
  "commerce.catalog.read@1.0.0": {
    schemaVersion: "mandala.workspace-data/v1",
    capabilityKey: "commerce.catalog.read",
    capabilityVersion: "1.0.0",
    datasets: [
      inventoryDataset,
      {
        alias: "vendors",
        recordType: "product_vendor",
        entityPath: "/sku",
        maximumFreshnessHours: 168,
        required: false,
      },
      {
        alias: "curated",
        recordType: "sku_vendor_map",
        entityPath: "/sku",
        maximumFreshnessHours: 720,
        required: false,
      },
    ],
    output: {
      collection: "products",
      entityKey: "sku",
      fields: [
        field("sku", first("inventory", "/sku"), "internal"),
        field("title", first("inventory", "/product_name"), "internal"),
        field("category", literal("Unclassified"), "internal"),
        field(
          "vendor",
          coalesce(
            first("vendors", "/vendor_name"),
            first("curated", "/vendor"),
            literal("Unmapped")
          )
        ),
      ],
    },
    bounds,
  },
  "commerce.inventory.read@1.0.0": {
    schemaVersion: "mandala.workspace-data/v1",
    capabilityKey: "commerce.inventory.read",
    capabilityVersion: "1.0.0",
    datasets: [inventoryDataset],
    output: {
      collection: "inventory",
      entityKey: "sku",
      fields: [
        field("sku", first("inventory", "/sku"), "internal"),
        field("inventoryOnHand", sum("inventory", "/on_hand")),
        field("inboundUnits", literal(0)),
        field("reorderPoint", {
          op: "max",
          dataset: "inventory",
          path: "/reorder_level",
        }),
        field("safetyStockUnits", literal(0)),
        field(
          "dataFreshnessHours",
          { op: "age_hours", dataset: "inventory" },
          "internal"
        ),
      ],
    },
    signal: {
      id: "inventory-threshold-crossed",
      all: [
        {
          left: "inventoryOnHand",
          operator: "lte",
          right: { field: "reorderPoint" },
        },
        { left: "reorderPoint", operator: "gt", right: { value: 0 } },
        { left: "dataFreshnessHours", operator: "lte", right: { value: 72 } },
      ],
    },
    bounds,
  },
  "commerce.sales.read@1.0.0": {
    schemaVersion: "mandala.workspace-data/v1",
    capabilityKey: "commerce.sales.read",
    capabilityVersion: "1.0.0",
    datasets: [salesDataset],
    output: {
      collection: "sales",
      entityKey: "sku",
      fields: [
        field("sku", first("sales", "/sku"), "internal"),
        field("recent30DaySales", recentSales),
        field("trailing90DaySales", trailingSales),
        field("seasonalIndex", literal(1), "internal"),
        field(
          "recentSpikeMultiplier",
          math(
            "max_of",
            literal(1),
            math(
              "divide",
              math("multiply", recentSales, literal(3)),
              math("max_of", trailingSales, literal(1))
            )
          ),
          "internal"
        ),
      ],
    },
    bounds,
  },
  "commerce.events.read@1.0.0": {
    schemaVersion: "mandala.workspace-data/v1",
    capabilityKey: "commerce.events.read",
    capabilityVersion: "1.0.0",
    datasets: [salesDataset],
    output: {
      collection: "events",
      entityKey: "sku",
      fields: [
        field("id", first("sales", "/$externalId"), "internal"),
        field("sku", first("sales", "/sku"), "internal"),
        field("type", literal("sales_order"), "internal"),
        field("occurredAt", first("sales", "/$parent/order_date"), "internal"),
        field(
          "description",
          literal("A sales order was observed for this product."),
          "internal"
        ),
      ],
    },
    bounds,
  },
  "procurement.open-orders.read@1.0.0": {
    schemaVersion: "mandala.workspace-data/v1",
    capabilityKey: "procurement.open-orders.read",
    capabilityVersion: "1.0.0",
    datasets: [
      salesDataset,
      {
        alias: "orders",
        recordType: "purchase_order",
        rowsPath: "/lines",
        entityPath: "/sku",
        maximumFreshnessHours: 168,
        required: false,
        businessObject: "procurement.purchase-order",
        evidenceRole: "authoritative",
      },
      {
        alias: "tracking",
        recordType: "board_card",
        entityPath: "/sku",
        maximumFreshnessHours: 72,
        required: false,
        businessObject: "procurement.purchase-order",
        evidenceRole: "tracking",
      },
    ],
    output: {
      collection: "purchaseOrders",
      entityKey: "sku",
      fields: [
        field(
          "sku",
          coalesce(first("sales", "/sku"), first("orders", "/sku")),
          "internal"
        ),
        field(
          "duplicateOpenOrderUnits",
          sum("orders", "/quantity", [
            {
              path: "/$parent/fulfillment_status",
              operator: "neq",
              value: "closed",
            },
            {
              path: "/$parent/fulfillment_status",
              operator: "neq",
              value: "fulfilled",
            },
            {
              path: "/$parent/fulfillment_status",
              operator: "neq",
              value: "cancelled",
            },
          ])
        ),
        field("duplicateOpenOrderMatchCount", literal(0), "internal"),
      ],
    },
    normalization: {
      model: "procurement.open-order",
      version: "1.0.0",
    },
    coveragePolicy: {
      mode: "all_relevant_sources",
      requiredRoles: ["authoritative"],
      outputField: "openOrderSourceCoverageComplete",
      incomplete: "block",
    },
    bounds,
  },
  "procurement.vendor-terms.read@1.0.0": {
    schemaVersion: "mandala.workspace-data/v1",
    capabilityKey: "procurement.vendor-terms.read",
    capabilityVersion: "1.0.0",
    datasets: [
      salesDataset,
      {
        alias: "vendors",
        recordType: "product_vendor",
        entityPath: "/sku",
        maximumFreshnessHours: 168,
        required: false,
      },
      {
        alias: "curated",
        recordType: "sku_vendor_map",
        entityPath: "/sku",
        maximumFreshnessHours: 720,
        required: false,
      },
    ],
    output: {
      collection: "vendorTerms",
      entityKey: "sku",
      fields: [
        field("sku", first("sales", "/sku"), "internal"),
        field(
          "vendor",
          coalesce(
            first("vendors", "/vendor_name"),
            first("curated", "/vendor"),
            literal("Unmapped")
          )
        ),
        field("leadTimeDays", literal(14)),
        field("vendorPackSize", literal(1)),
        field("vendorMinimumOrderQuantity", literal(1)),
      ],
    },
    bounds,
  },
}

export function getWorkspaceMappingTemplate(input: {
  capabilityKey: string
  capabilityVersion: string
}): WorkspaceCapabilityMappingSpec | null {
  const template =
    templates[`${input.capabilityKey}@${input.capabilityVersion}`]
  return template
    ? workspaceCapabilityMappingSpecSchema.parse(structuredClone(template))
    : null
}

export function listWorkspaceMappingTemplates(): WorkspaceCapabilityMappingSpec[] {
  return Object.values(templates).map((template) =>
    workspaceCapabilityMappingSpecSchema.parse(structuredClone(template))
  )
}
