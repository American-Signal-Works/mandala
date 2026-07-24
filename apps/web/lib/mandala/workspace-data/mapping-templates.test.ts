import { describe, expect, it } from "vitest"
import {
  getWorkspaceMappingTemplate,
  listWorkspaceMappingTemplates,
} from "./mapping-templates"

describe("workspace mapping templates", () => {
  it("are declarative, generic-provider specs without customer or source adapters", () => {
    const templates = listWorkspaceMappingTemplates()
    expect(templates).toHaveLength(6)
    const serialized = JSON.stringify(templates).toLowerCase()
    expect(serialized).not.toContain("dirt king")
    expect(serialized).not.toContain("alba")
    expect(serialized).not.toContain("shiphero")
    expect(serialized).not.toContain("trello")
    expect(serialized).not.toContain("javascript")
    expect(
      templates.every(
        ({ schemaVersion }) => schemaVersion === "mandala.workspace-data/v1"
      )
    ).toBe(true)
  })

  it("maps real sales orders to bounded business-event evidence", () => {
    const template = getWorkspaceMappingTemplate({
      capabilityKey: "commerce.events.read",
      capabilityVersion: "1.0.0",
    })

    expect(template).toMatchObject({
      capabilityKey: "commerce.events.read",
      capabilityVersion: "1.0.0",
      datasets: [
        {
          alias: "sales",
          recordType: "sales_order",
          rowsPath: "/lines",
          entityPath: "/sku",
        },
      ],
      output: {
        collection: "events",
        entityKey: "sku",
        fields: [
          { name: "id", expression: { path: "/$externalId" } },
          { name: "sku", expression: { path: "/sku" } },
          {
            name: "type",
            expression: { value: "sales_order", confirmed: true },
          },
          {
            name: "occurredAt",
            expression: { path: "/$parent/order_date" },
          },
          {
            name: "description",
            expression: {
              value: "A sales order was observed for this product.",
              confirmed: true,
            },
          },
        ],
      },
    })
  })
})
