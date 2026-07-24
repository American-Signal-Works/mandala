// apps/web/lib/collections/fields.ts
import type { Field, FieldValue } from "./types"

export function defaultValueFor(field: Pick<Field, "type">): FieldValue {
  switch (field.type) {
    case "text":
      return ""
    case "number":
      return null
    case "currency":
      return null
    case "date":
      return null
    case "datetime":
      return null
    case "select":
      return null
    case "multi_select":
      return []
    case "checkbox":
      return false
  }
}

export function normalizeValue(
  field: Pick<Field, "type">,
  value: unknown
): FieldValue {
  if (value === null || value === undefined) return null

  switch (field.type) {
    case "text":
      if (typeof value !== "string") throw new Error("text expects string")
      return value

    case "number": {
      const n = typeof value === "number" ? value : Number(value)
      if (Number.isNaN(n)) throw new Error("number expects a finite number")
      return n
    }

    case "currency": {
      if (typeof value !== "object" || value === null)
        throw new Error("currency expects {amount, currency_code}")
      const v = value as Record<string, unknown>
      if (typeof v.amount !== "number" || typeof v.currency_code !== "string") {
        throw new Error(
          "currency expects {amount: number, currency_code: string}"
        )
      }
      return { amount: v.amount, currency_code: v.currency_code }
    }

    case "date":
    case "datetime": {
      if (typeof value !== "string")
        throw new Error(`${field.type} expects ISO string`)
      const d = new Date(value)
      if (Number.isNaN(d.getTime())) throw new Error("invalid date")
      return field.type === "date"
        ? d.toISOString().slice(0, 10)
        : d.toISOString()
    }

    case "select":
      if (typeof value !== "string") throw new Error("select expects string")
      return value

    case "multi_select":
      if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) {
        throw new Error("multi_select expects string[]")
      }
      return value as string[]

    case "checkbox":
      if (typeof value !== "boolean")
        throw new Error("checkbox expects boolean")
      return value
  }
}
