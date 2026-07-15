import { describe, expect, it } from "vitest"
import { createBoundedJsonSchemaValidator } from "./json-schema"

describe("bounded action JSON schemas", () => {
  it("checks required fields, primitive types, bounds, and unknown fields", () => {
    const validate = createBoundedJsonSchemaValidator({
      type: "object",
      required: ["sku", "quantity"],
      additionalProperties: false,
      properties: {
        sku: { type: "string", minLength: 1 },
        quantity: { type: "integer", minimum: 1, maximum: 100 },
      },
    })

    expect(validate({ sku: "SKU-1", quantity: 12 })).toBe(true)
    expect(validate({ sku: "SKU-1", quantity: 0 })).toBe(false)
    expect(validate({ sku: "SKU-1", quantity: 12, secret: "no" })).toBe(false)
  })

  it("fails closed for unsupported schema keywords", () => {
    expect(createBoundedJsonSchemaValidator({ oneOf: [] })({})).toBe(false)
  })

  it("supports constants used by registered capability schemas", () => {
    const validate = createBoundedJsonSchemaValidator({
      type: "object",
      required: ["committed"],
      properties: { committed: { const: false } },
      additionalProperties: false,
    })

    expect(validate({ committed: false })).toBe(true)
    expect(validate({ committed: true })).toBe(false)
  })
})
