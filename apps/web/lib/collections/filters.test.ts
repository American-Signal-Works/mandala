// apps/web/lib/collections/filters.test.ts
import { describe, it, expect } from "vitest"
import { buildFilterClause, buildOrderClause } from "./filters"
import type { Field } from "./types"

const fields: Record<string, Field> = {
  symbol: {
    id: "symbol",
    collection_id: "c1",
    name: "Symbol",
    type: "text",
    options: [],
    config: {},
    is_system: true,
    sort_index: 0,
  },
  pnl: {
    id: "pnl",
    collection_id: "c1",
    name: "PnL",
    type: "number",
    options: [],
    config: {},
    is_system: true,
    sort_index: 1,
  },
  date: {
    id: "date",
    collection_id: "c1",
    name: "Date",
    type: "date",
    options: [],
    config: {},
    is_system: true,
    sort_index: 2,
  },
}

describe("buildFilterClause", () => {
  it("eq on text", () => {
    const { sql, params } = buildFilterClause(
      [{ fieldId: "symbol", operator: "eq", value: "AAPL" }],
      fields
    )
    expect(sql).toBe("(data->>'symbol' = $1)")
    expect(params).toEqual(["AAPL"])
  })

  it("gt on number", () => {
    const { sql, params } = buildFilterClause(
      [{ fieldId: "pnl", operator: "gt", value: 100 }],
      fields
    )
    expect(sql).toBe("((data->>'pnl')::numeric > $1)")
    expect(params).toEqual([100])
  })

  it("contains on text", () => {
    const { sql, params } = buildFilterClause(
      [{ fieldId: "symbol", operator: "contains", value: "AA" }],
      fields
    )
    expect(sql).toBe("(data->>'symbol' ILIKE $1)")
    expect(params).toEqual(["%AA%"])
  })

  it("AND-joins multiple filters with sequential params", () => {
    const { sql, params } = buildFilterClause(
      [
        { fieldId: "symbol", operator: "eq", value: "AAPL" },
        { fieldId: "pnl", operator: "gt", value: 0 },
      ],
      fields
    )
    expect(sql).toBe(
      "(data->>'symbol' = $1) AND ((data->>'pnl')::numeric > $2)"
    )
    expect(params).toEqual(["AAPL", 0])
  })
})

describe("buildOrderClause", () => {
  it("orders by text asc", () => {
    expect(
      buildOrderClause([{ fieldId: "symbol", direction: "asc" }], fields)
    ).toBe("ORDER BY data->>'symbol' ASC NULLS LAST")
  })
  it("orders by number desc", () => {
    expect(
      buildOrderClause([{ fieldId: "pnl", direction: "desc" }], fields)
    ).toBe("ORDER BY (data->>'pnl')::numeric DESC NULLS LAST")
  })
  it("returns empty string when no sorts", () => {
    expect(buildOrderClause([], fields)).toBe("")
  })
})
