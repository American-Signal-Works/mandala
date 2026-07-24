// apps/web/lib/collections/filters.ts
import type { Field, Filter, Sort } from "./types"

const NUMERIC_TYPES = new Set(["number", "currency"])
const DATETIME_TYPES = new Set(["date", "datetime"])

function fieldExpr(field: Field): string {
  if (NUMERIC_TYPES.has(field.type)) {
    if (field.type === "currency")
      return `(data->'${field.id}'->>'amount')::numeric`
    return `(data->>'${field.id}')::numeric`
  }
  if (DATETIME_TYPES.has(field.type)) {
    return `(data->>'${field.id}')::timestamptz`
  }
  return `data->>'${field.id}'`
}

export function buildFilterClause(
  filters: Filter[],
  fields: Record<string, Field>
): { sql: string; params: unknown[] } {
  if (filters.length === 0) return { sql: "", params: [] }
  const params: unknown[] = []
  const clauses = filters.map((f) => {
    const field = fields[f.fieldId]
    if (!field) throw new Error(`unknown field: ${f.fieldId}`)
    const expr = fieldExpr(field)
    const push = (v: unknown) => {
      params.push(v)
      return params.length
    }
    switch (f.operator) {
      case "eq":
        return `(${expr} = $${push(f.value)})`
      case "neq":
        return `(${expr} <> $${push(f.value)})`
      case "gt":
        return `(${expr} > $${push(f.value)})`
      case "gte":
        return `(${expr} >= $${push(f.value)})`
      case "lt":
        return `(${expr} < $${push(f.value)})`
      case "lte":
        return `(${expr} <= $${push(f.value)})`
      case "contains":
        return `(${expr} ILIKE $${push(`%${f.value}%`)})`
      case "starts_with":
        return `(${expr} ILIKE $${push(`${f.value}%`)})`
      case "is_empty":
        return `(${expr} IS NULL)`
      case "is_not_empty":
        return `(${expr} IS NOT NULL)`
      case "in":
        return `(${expr} = ANY($${push(f.value)}))`
      case "not_in":
        return `(${expr} <> ALL($${push(f.value)}))`
    }
  })
  return { sql: clauses.join(" AND "), params }
}

export function buildOrderClause(
  sorts: Sort[],
  fields: Record<string, Field>
): string {
  if (sorts.length === 0) return ""
  const parts = sorts.map((s) => {
    const field = fields[s.fieldId]
    if (!field) throw new Error(`unknown field: ${s.fieldId}`)
    const expr = fieldExpr(field)
    const dir = s.direction.toUpperCase()
    return `${expr} ${dir} NULLS LAST`
  })
  return `ORDER BY ${parts.join(", ")}`
}
