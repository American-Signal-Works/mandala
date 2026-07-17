import { createHash } from "node:crypto"
import type {
  CapabilityCatalog,
  CapabilityDefinition,
  CapabilityOperation,
  ConnectorDefinition,
} from "./schema"
import {
  capabilityCatalogSchema,
  capabilityDefinitionSchema,
  connectorDefinitionSchema,
  jsonSchemaDocumentSchema,
} from "./schema"

type JsonSchemaDocument = ReturnType<typeof jsonSchemaDocumentSchema.parse>

const emptyInput = objectSchema({})
const productCollection = objectSchema({
  products: arrayField("object"),
})
const inventoryCollection = objectSchema({
  inventory: arrayField("object"),
})
const salesCollection = objectSchema({
  sales: arrayField("object"),
})
const eventCollection = objectSchema({
  events: arrayField("object"),
})
const purchaseOrderCollection = objectSchema({
  purchaseOrders: arrayField("object"),
})
const vendorTermsCollection = objectSchema({
  vendorTerms: arrayField("object"),
})
const purchaseOrderDraftInput = objectSchema({
  vendor: stringField(),
  lines: arrayField("object"),
  mode: enumField(["mock"]),
})
const purchaseOrderDraftOutput = objectSchema({
  draftId: stringField(),
  status: enumField(["pending_review"]),
})
const mockExecutionInput = objectSchema({
  draftId: stringField(),
  approvalToken: stringField(),
  mode: enumField(["mock"]),
})
const mockExecutionOutput = objectSchema({
  attemptId: stringField(),
  status: enumField(["succeeded", "failed"]),
})

export const syntheticCommerceCapabilityDefinitions: CapabilityDefinition[] = [
  capability({
    key: "commerce.catalog.read",
    name: "Read product catalog",
    description: "Read the synthetic commerce product catalog.",
    kind: "dataset",
    operations: ["read"],
    inputSchema: emptyInput,
    outputSchema: productCollection,
    modelFields: [
      "products[].sku",
      "products[].title",
      "products[].category",
      "products[].vendor",
      "products[].vendorPackSize",
      "products[].vendorMinimumOrderQuantity",
      "products[].leadTimeDays",
    ],
  }),
  capability({
    key: "commerce.inventory.read",
    name: "Read inventory",
    description: "Read current and inbound inventory by product.",
    kind: "dataset",
    operations: ["read"],
    inputSchema: emptyInput,
    outputSchema: inventoryCollection,
    modelFields: [
      "inventory[].sku",
      "inventory[].inventoryOnHand",
      "inventory[].inboundUnits",
      "inventory[].reorderPoint",
      "inventory[].safetyStockUnits",
      "inventory[].dataFreshnessHours",
    ],
  }),
  capability({
    key: "commerce.sales.read",
    name: "Read sales",
    description: "Read bounded historical sales by product.",
    kind: "dataset",
    operations: ["read"],
    inputSchema: emptyInput,
    outputSchema: salesCollection,
    modelFields: [
      "sales[].sku",
      "sales[].date",
      "sales[].units",
      "sales[].channel",
    ],
  }),
  capability({
    key: "commerce.events.read",
    name: "Read business events",
    description:
      "Read bounded synthetic promotions, adjustments, supplier delays, and order events.",
    kind: "dataset",
    operations: ["read"],
    inputSchema: emptyInput,
    outputSchema: eventCollection,
    modelFields: [
      "events[].id",
      "events[].sku",
      "events[].type",
      "events[].occurredAt",
      "events[].description",
    ],
  }),
  capability({
    key: "procurement.open-orders.read",
    name: "Read open purchase orders",
    description: "Read open purchase orders for duplicate checks.",
    kind: "dataset",
    operations: ["read"],
    inputSchema: emptyInput,
    outputSchema: purchaseOrderCollection,
    modelFields: [
      "purchaseOrders[].sku",
      "purchaseOrders[].quantity",
      "purchaseOrders[].status",
      "purchaseOrders[].expectedAt",
      "purchaseOrders[].duplicateOpenOrderMatchCount",
      "purchaseOrders[].openOrderSourceCoverageComplete",
    ],
  }),
  capability({
    key: "procurement.vendor-terms.read",
    name: "Read vendor terms",
    description: "Read vendor lead time, pack size, and minimum-order terms.",
    kind: "dataset",
    operations: ["read"],
    inputSchema: emptyInput,
    outputSchema: vendorTermsCollection,
    modelFields: [
      "vendorTerms[].sku",
      "vendorTerms[].vendor",
      "vendorTerms[].leadTimeDays",
      "vendorTerms[].packSize",
      "vendorTerms[].minimumOrderQuantity",
    ],
  }),
  capability({
    key: "procurement.purchase-order.create-draft",
    name: "Create purchase-order draft",
    description: "Propose a mock purchase-order draft for human review.",
    kind: "action",
    operations: ["propose"],
    inputSchema: purchaseOrderDraftInput,
    outputSchema: purchaseOrderDraftOutput,
  }),
  capability({
    key: "procurement.purchase-order.mock-execute",
    name: "Execute approved mock purchase order",
    description:
      "Execute an approved purchase-order draft without an external write.",
    kind: "action",
    operations: ["execute"],
    inputSchema: mockExecutionInput,
    outputSchema: mockExecutionOutput,
  }),
]

export const syntheticCommerceConnectorDefinition: ConnectorDefinition =
  connectorDefinitionSchema.parse({
    schemaVersion: "1",
    key: "mandala.synthetic-commerce",
    version: "1.0.0",
    name: "Synthetic Commerce",
    description:
      "Mandala Bean Co. test data and mock procurement capabilities.",
    capabilities: syntheticCommerceCapabilityDefinitions.map((definition) => ({
      capabilityKey: definition.key,
      capabilityVersion: definition.version,
      operations: definition.operations,
      schemaDigest: definition.schemaDigest,
      ...(definition.key === "procurement.open-orders.read"
        ? {
            evidenceRoles: [
              {
                businessObject: "procurement.purchase-order",
                role: "authoritative" as const,
                recordTypes: ["purchase_order"],
              },
            ],
          }
        : {}),
    })),
  })

export const syntheticCommerceCapabilityCatalog: CapabilityCatalog =
  capabilityCatalogSchema.parse({
    schemaVersion: "1",
    capabilities: syntheticCommerceCapabilityDefinitions,
    connectors: [syntheticCommerceConnectorDefinition],
  })

export function capabilitySchemaDigest(input: {
  inputSchema: JsonSchemaDocument
  outputSchema: JsonSchemaDocument
}): string {
  return createHash("sha256").update(stableJson(input)).digest("hex")
}

function capability(input: {
  key: string
  name: string
  description: string
  kind: "dataset" | "action"
  operations: CapabilityOperation[]
  inputSchema: JsonSchemaDocument
  outputSchema: JsonSchemaDocument
  modelFields?: string[]
}): CapabilityDefinition {
  const { modelFields = [], ...definition } = input
  return capabilityDefinitionSchema.parse({
    schemaVersion: "1",
    version: "1.0.0",
    ...definition,
    modelEgress: {
      defaultClassification: "restricted",
      fields: modelFields.map((path) => ({
        path,
        classification: "internal",
        modelAllowed: true,
      })),
    },
    schemaDigest: capabilitySchemaDigest(definition),
  })
}

function objectSchema(
  properties: Record<string, Record<string, unknown>>
): JsonSchemaDocument {
  return jsonSchemaDocumentSchema.parse({
    type: "object",
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  })
}

function stringField(): Record<string, unknown> {
  return { type: "string" }
}

function arrayField(itemType: string): Record<string, unknown> {
  return { type: "array", items: { type: itemType } }
}

function enumField(values: string[]): Record<string, unknown> {
  return { type: "string", enum: values }
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${stableJson(nested)}`)
      .join(",")}}`
  }
  return JSON.stringify(value)
}
