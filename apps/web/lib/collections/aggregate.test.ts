// apps/web/lib/collections/aggregate.test.ts
import { describe, it, expect } from "vitest"
import { aggregateRows } from "./collection"
import type { Field, Row } from "./types"

const fields: Record<string, Field> = {
  symbol: {
    id: "symbol",
    collection_id: "c",
    name: "Symbol",
    type: "text",
    options: [],
    config: {},
    is_system: true,
    sort_index: 0,
  },
  pnl: {
    id: "pnl",
    collection_id: "c",
    name: "PnL",
    type: "number",
    options: [],
    config: {},
    is_system: true,
    sort_index: 1,
  },
}

const rows: Row[] = [
  {
    id: "1",
    collection_id: "c",
    data: { symbol: "AAPL", pnl: 100 },
    source: "user",
    source_external_id: null,
    created_at: "",
    updated_at: "",
  },
  {
    id: "2",
    collection_id: "c",
    data: { symbol: "AAPL", pnl: -50 },
    source: "user",
    source_external_id: null,
    created_at: "",
    updated_at: "",
  },
  {
    id: "3",
    collection_id: "c",
    data: { symbol: "MSFT", pnl: 200 },
    source: "user",
    source_external_id: null,
    created_at: "",
    updated_at: "",
  },
]

describe("aggregateRows", () => {
  it("counts rows", () => {
    expect(aggregateRows(rows, fields, { metric: { kind: "count" } })).toEqual({
      value: 3,
    })
  })
  it("sums a numeric field", () => {
    expect(
      aggregateRows(rows, fields, { metric: { kind: "sum", fieldId: "pnl" } })
    ).toEqual({ value: 250 })
  })
  it("averages a numeric field", () => {
    expect(
      aggregateRows(rows, fields, { metric: { kind: "avg", fieldId: "pnl" } })
    ).toEqual({ value: 250 / 3 })
  })
  it("min/max", () => {
    expect(
      aggregateRows(rows, fields, { metric: { kind: "min", fieldId: "pnl" } })
    ).toEqual({ value: -50 })
    expect(
      aggregateRows(rows, fields, { metric: { kind: "max", fieldId: "pnl" } })
    ).toEqual({ value: 200 })
  })
  it("groups by symbol summing pnl", () => {
    const result = aggregateRows(rows, fields, {
      metric: { kind: "sum", fieldId: "pnl" },
      groupBy: ["symbol"],
    })
    expect(result).toEqual({
      groups: [
        { key: { symbol: "AAPL" }, value: 50 },
        { key: { symbol: "MSFT" }, value: 200 },
      ],
    })
  })
})

describe("aggregateRows currency handling", () => {
  const currencyFields: Record<string, Field> = {
    pnl: {
      id: "pnl",
      collection_id: "c",
      name: "PnL",
      type: "currency",
      options: [],
      config: {},
      is_system: true,
      sort_index: 0,
    },
    symbol: {
      id: "symbol",
      collection_id: "c",
      name: "Symbol",
      type: "text",
      options: [],
      config: {},
      is_system: true,
      sort_index: 1,
    },
  }

  const currencyRows: Row[] = [
    {
      id: "1",
      collection_id: "c",
      data: { pnl: { amount: 100, currency_code: "USD" }, symbol: "AAPL" },
      source: "user",
      source_external_id: null,
      created_at: "",
      updated_at: "",
    },
    {
      id: "2",
      collection_id: "c",
      data: { pnl: { amount: -50, currency_code: "USD" }, symbol: "AAPL" },
      source: "user",
      source_external_id: null,
      created_at: "",
      updated_at: "",
    },
    {
      id: "3",
      collection_id: "c",
      data: { pnl: { amount: 200, currency_code: "USD" }, symbol: "MSFT" },
      source: "user",
      source_external_id: null,
      created_at: "",
      updated_at: "",
    },
  ]

  it("sums currency amounts", () => {
    expect(
      aggregateRows(currencyRows, currencyFields, {
        metric: { kind: "sum", fieldId: "pnl" },
      })
    ).toEqual({ value: 250 })
  })

  it("avg of currency", () => {
    expect(
      aggregateRows(currencyRows, currencyFields, {
        metric: { kind: "avg", fieldId: "pnl" },
      })
    ).toEqual({ value: 250 / 3 })
  })

  it("min/max of currency", () => {
    expect(
      aggregateRows(currencyRows, currencyFields, {
        metric: { kind: "min", fieldId: "pnl" },
      })
    ).toEqual({ value: -50 })
    expect(
      aggregateRows(currencyRows, currencyFields, {
        metric: { kind: "max", fieldId: "pnl" },
      })
    ).toEqual({ value: 200 })
  })

  it("groups currency sums by symbol", () => {
    const result = aggregateRows(currencyRows, currencyFields, {
      metric: { kind: "sum", fieldId: "pnl" },
      groupBy: ["symbol"],
    })
    expect(result).toEqual({
      groups: [
        { key: { symbol: "AAPL" }, value: 50 },
        { key: { symbol: "MSFT" }, value: 200 },
      ],
    })
  })
})
