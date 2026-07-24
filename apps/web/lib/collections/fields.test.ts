// apps/web/lib/collections/fields.test.ts
import { describe, it, expect } from "vitest"
import { defaultValueFor, normalizeValue } from "./fields"

describe("defaultValueFor", () => {
  it("text → empty string", () => {
    expect(defaultValueFor({ type: "text" })).toBe("")
  })
  it("checkbox → false", () => {
    expect(defaultValueFor({ type: "checkbox" })).toBe(false)
  })
  it("multi_select → empty array", () => {
    expect(defaultValueFor({ type: "multi_select" })).toEqual([])
  })
  it("currency → null (user must enter explicitly)", () => {
    expect(defaultValueFor({ type: "currency" })).toBeNull()
  })
})

describe("normalizeValue", () => {
  it("number coerces string to number", () => {
    expect(normalizeValue({ type: "number" }, "12.5")).toBe(12.5)
  })
  it("number rejects NaN", () => {
    expect(() => normalizeValue({ type: "number" }, "not-a-number")).toThrow()
  })
  it("currency requires amount + currency_code", () => {
    expect(
      normalizeValue(
        { type: "currency" },
        {
          amount: 100,
          currency_code: "USD",
        }
      )
    ).toEqual({ amount: 100, currency_code: "USD" })
    expect(() =>
      normalizeValue({ type: "currency" }, { amount: 100 })
    ).toThrow()
  })
  it("checkbox accepts boolean only", () => {
    expect(normalizeValue({ type: "checkbox" }, true)).toBe(true)
    expect(() => normalizeValue({ type: "checkbox" }, "yes")).toThrow()
  })
})
