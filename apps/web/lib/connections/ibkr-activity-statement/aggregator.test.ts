import { describe, it, expect } from "vitest"
import { aggregateFillsToTrades } from "./aggregator"
import type { ParsedFill } from "./parser"

function fill(over: Partial<ParsedFill>): ParsedFill {
  return {
    symbol: "AAPL",
    side: "BUY",
    quantity: 100,
    price: 100,
    fees: 1,
    currency: "USD",
    executed_at: "2025-01-01T10:00:00.000Z",
    source_external_id: "x",
    ...over,
  }
}

describe("aggregateFillsToTrades", () => {
  it("simple long round-trip", () => {
    const trades = aggregateFillsToTrades([
      fill({
        side: "BUY",
        quantity: 100,
        price: 100,
        executed_at: "2025-01-01T10:00:00.000Z",
        source_external_id: "1",
      }),
      fill({
        side: "SELL",
        quantity: 100,
        price: 110,
        executed_at: "2025-01-01T15:00:00.000Z",
        source_external_id: "2",
      }),
    ])
    expect(trades).toHaveLength(1)
    expect(trades[0]).toMatchObject({
      symbol: "AAPL",
      side: "LONG",
      total_quantity: 100,
      avg_entry_price: 100,
      avg_exit_price: 110,
      gross_pnl: 1000,
      net_pnl: 998, // 1000 - (1 + 1) fees
      currency_code: "USD",
      opening_fill_id: "1",
    })
  })

  it("scale-in then full close — weighted-average entry price", () => {
    const trades = aggregateFillsToTrades([
      fill({
        side: "BUY",
        quantity: 50,
        price: 100,
        executed_at: "2025-01-01T10:00:00.000Z",
        source_external_id: "1",
      }),
      fill({
        side: "BUY",
        quantity: 50,
        price: 102,
        executed_at: "2025-01-01T11:00:00.000Z",
        source_external_id: "2",
      }),
      fill({
        side: "SELL",
        quantity: 100,
        price: 110,
        executed_at: "2025-01-01T15:00:00.000Z",
        source_external_id: "3",
      }),
    ])
    expect(trades).toHaveLength(1)
    expect(trades[0]!.avg_entry_price).toBe(101) // (50*100 + 50*102) / 100
    expect(trades[0]!.gross_pnl).toBe(900) // (110 - 101) * 100
  })

  it("position flip (long → short via one large sell)", () => {
    const trades = aggregateFillsToTrades([
      fill({
        side: "BUY",
        quantity: 100,
        price: 100,
        executed_at: "2025-01-01T10:00:00.000Z",
        source_external_id: "1",
      }),
      fill({
        side: "SELL",
        quantity: 200,
        price: 110,
        executed_at: "2025-01-01T11:00:00.000Z",
        source_external_id: "2",
      }),
      fill({
        side: "BUY",
        quantity: 100,
        price: 105,
        executed_at: "2025-01-01T12:00:00.000Z",
        source_external_id: "3",
      }),
    ])
    expect(trades).toHaveLength(2)
    expect(trades[0]!.side).toBe("LONG")
    expect(trades[0]!.gross_pnl).toBe(1000) // (110-100)*100
    expect(trades[1]!.side).toBe("SHORT")
    expect(trades[1]!.gross_pnl).toBe(500) // (110-105)*100  — short profits when price falls
  })

  it("short round-trip", () => {
    const trades = aggregateFillsToTrades([
      fill({
        side: "SELL",
        quantity: 100,
        price: 110,
        executed_at: "2025-01-01T10:00:00.000Z",
        source_external_id: "1",
      }),
      fill({
        side: "BUY",
        quantity: 100,
        price: 100,
        executed_at: "2025-01-01T11:00:00.000Z",
        source_external_id: "2",
      }),
    ])
    expect(trades).toHaveLength(1)
    expect(trades[0]!.side).toBe("SHORT")
    expect(trades[0]!.gross_pnl).toBe(1000)
  })

  it("dangling open position emitted as open trade", () => {
    const trades = aggregateFillsToTrades([
      fill({
        side: "BUY",
        quantity: 100,
        price: 100,
        executed_at: "2025-01-01T10:00:00.000Z",
        source_external_id: "1",
      }),
    ])
    expect(trades).toHaveLength(1)
    expect(trades[0]).toMatchObject({
      symbol: "AAPL",
      side: "LONG",
      opened_at: "2025-01-01T10:00:00.000Z",
      closed_at: null,
      hold_duration_seconds: null,
      total_quantity: 100,
      avg_entry_price: 100,
      avg_exit_price: null,
      gross_pnl: null,
      fees: 1,
      net_pnl: null,
      opening_fill_id: "1",
    })
  })

  it("scale-in still open emits one open trade with weighted-average entry", () => {
    const trades = aggregateFillsToTrades([
      fill({
        side: "BUY",
        quantity: 50,
        price: 100,
        executed_at: "2025-01-01T10:00:00.000Z",
        source_external_id: "1",
      }),
      fill({
        side: "BUY",
        quantity: 50,
        price: 102,
        executed_at: "2025-01-01T11:00:00.000Z",
        source_external_id: "2",
      }),
    ])
    expect(trades).toHaveLength(1)
    expect(trades[0]!.closed_at).toBeNull()
    expect(trades[0]!.total_quantity).toBe(100)
    expect(trades[0]!.avg_entry_price).toBe(101)
    expect(trades[0]!.fees).toBe(2)
  })
})
