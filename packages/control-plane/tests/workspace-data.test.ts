import { describe, expect, it } from "vitest"
import { workspaceCapabilityMappingSpecSchema } from "../src/workspace-data.js"

const fixture = {
  schemaVersion: "mandala.workspace-data/v1",
  capabilityKey: "workspace.records.read",
  capabilityVersion: "1.0.0",
  datasets: [
    {
      alias: "tickets",
      recordType: "support_ticket",
      entityPath: "/ticket_id",
      maximumFreshnessHours: 24,
      required: true,
    },
  ],
  output: {
    collection: "records",
    entityKey: "ticket_id",
    fields: [
      {
        name: "ticket_id",
        expression: { op: "first", dataset: "tickets", path: "/ticket_id" },
        required: true,
        modelAllowed: true,
        classification: "internal",
        format: "non-empty-string",
      },
      {
        name: "severity",
        expression: { op: "first", dataset: "tickets", path: "/severity" },
        required: true,
        modelAllowed: true,
        classification: "internal",
      },
    ],
  },
  signal: {
    id: "high-severity-ticket",
    all: [{ left: "severity", operator: "gte", right: { value: 4 } }],
  },
  bounds: {
    maximumInputRows: 100,
    maximumOutputRows: 20,
    maximumOutputBytes: 65_536,
  },
} as const

describe("workspaceCapabilityMappingSpecSchema", () => {
  it("accepts a differently shaped generic dataset", () => {
    expect(workspaceCapabilityMappingSpecSchema.parse(fixture)).toEqual(fixture)
  })

  it("rejects arbitrary code and unconfirmed literal defaults", () => {
    expect(() =>
      workspaceCapabilityMappingSpecSchema.parse({
        ...fixture,
        output: {
          ...fixture.output,
          fields: [
            ...fixture.output.fields,
            {
              name: "unsafe",
              expression: { op: "javascript", source: "process.exit()" },
              required: true,
              modelAllowed: false,
              classification: "restricted",
            },
          ],
        },
      })
    ).toThrow()
    expect(() =>
      workspaceCapabilityMappingSpecSchema.parse({
        ...fixture,
        output: {
          ...fixture.output,
          fields: [
            ...fixture.output.fields,
            {
              name: "default_value",
              expression: { op: "literal", value: 1, confirmed: false },
              required: true,
              modelAllowed: true,
              classification: "internal",
            },
          ],
        },
      })
    ).toThrow()
  })

  it("rejects undeclared output validation formats", () => {
    expect(() =>
      workspaceCapabilityMappingSpecSchema.parse({
        ...fixture,
        output: {
          ...fixture.output,
          fields: [
            {
              ...fixture.output.fields[0],
              format: "customer-specific-validator",
            },
          ],
        },
      })
    ).toThrow()
  })
})
