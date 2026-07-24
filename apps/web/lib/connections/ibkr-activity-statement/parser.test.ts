import { describe, it, expect } from "vitest"
import { parseActivityStatement } from "./parser"

const SAMPLE_CSV = `Statement,Header,Field Name,Field Value
Statement,Data,BrokerName,Interactive Brokers
Trades,Header,DataDiscriminator,Asset Category,Currency,Symbol,Date/Time,Quantity,T. Price,Comm/Fee,TradeID
Trades,Data,Order,Stocks,USD,AAPL,"2025-04-15, 09:30:00",100,182.45,-1.00,0
Trades,Data,Execution,Stocks,USD,AAPL,"2025-04-15, 09:30:01",100,182.45,-1.00,12345
Trades,Data,Execution,Stocks,USD,AAPL,"2025-04-15, 14:00:01",-100,184.10,-1.00,12346
Trades,SubTotal,,Stocks,USD,AAPL,,,0,165.00,-2.00,
Trades,Total,,,USD,,,,,165.00,-2.00,
Open Positions,Header,Asset Category,Symbol,Quantity
Open Positions,Data,Stocks,AAPL,0
`

describe("parseActivityStatement", () => {
  it("extracts executions only (skips Order, SubTotal, Total)", async () => {
    const file = new File([SAMPLE_CSV], "activity.csv", { type: "text/csv" })
    const result = await parseActivityStatement(file, {
      sourceTimezone: "America/New_York",
    })
    expect(result.fills).toHaveLength(2)
    expect(result.fills[0]).toMatchObject({
      symbol: "AAPL",
      side: "BUY",
      quantity: 100,
      price: 182.45,
      currency: "USD",
      source_external_id: "12345",
    })
    expect(result.fills[1]).toMatchObject({
      side: "SELL",
      quantity: 100,
      source_external_id: "12346",
    })
  })

  it("converts source-tz datetimes to UTC ISO", async () => {
    const file = new File([SAMPLE_CSV], "activity.csv", { type: "text/csv" })
    const result = await parseActivityStatement(file, {
      sourceTimezone: "America/New_York",
    })
    // 2025-04-15 09:30:01 in America/New_York is EDT (UTC-4) → 13:30:01 UTC
    expect(result.fills[0]!.executed_at).toBe("2025-04-15T13:30:01.000Z")
  })

  it("returns NO_TRADES_SECTION error when missing", async () => {
    const file = new File(
      [
        "Statement,Header,Field Name,Field Value\nStatement,Data,BrokerName,IBKR\n",
      ],
      "broken.csv",
      { type: "text/csv" }
    )
    await expect(
      parseActivityStatement(file, { sourceTimezone: "America/New_York" })
    ).rejects.toThrow(/NO_TRADES_SECTION/)
  })

  it("skips non-stock asset categories and counts them", async () => {
    const csv = SAMPLE_CSV.replace(/Stocks,USD,AAPL/g, (match, offset) =>
      offset > 200 ? "Options,USD,AAPL  240419C00170000" : match
    )
    const file = new File([csv], "options.csv", { type: "text/csv" })
    const r = await parseActivityStatement(file, {
      sourceTimezone: "America/New_York",
    })
    expect(r.skippedNonStock).toBeGreaterThan(0)
  })

  it("rejects rows with non-numeric T. Price (no silent NaN)", async () => {
    const csv = `Trades,Header,DataDiscriminator,Asset Category,Currency,Symbol,Date/Time,Quantity,T. Price,Comm/Fee,TradeID
Trades,Data,Execution,Stocks,USD,AAPL,"2025-04-15, 09:30:01",100,,-1.00,12345
`
    const file = new File([csv], "bad-price.csv", { type: "text/csv" })
    await expect(
      parseActivityStatement(file, { sourceTimezone: "America/New_York" })
    ).rejects.toThrow(/INVALID_PRICE/)
  })

  it("rejects rows with non-numeric Comm/Fee", async () => {
    const csv = `Trades,Header,DataDiscriminator,Asset Category,Currency,Symbol,Date/Time,Quantity,T. Price,Comm/Fee,TradeID
Trades,Data,Execution,Stocks,USD,AAPL,"2025-04-15, 09:30:01",100,182.45,n/a,12345
`
    const file = new File([csv], "bad-fee.csv", { type: "text/csv" })
    await expect(
      parseActivityStatement(file, { sourceTimezone: "America/New_York" })
    ).rejects.toThrow(/INVALID_FEE/)
  })

  it("rejects rows missing the symbol", async () => {
    const csv = `Trades,Header,DataDiscriminator,Asset Category,Currency,Symbol,Date/Time,Quantity,T. Price,Comm/Fee,TradeID
Trades,Data,Execution,Stocks,USD,,"2025-04-15, 09:30:01",100,182.45,-1.00,12345
`
    const file = new File([csv], "no-symbol.csv", { type: "text/csv" })
    await expect(
      parseActivityStatement(file, { sourceTimezone: "America/New_York" })
    ).rejects.toThrow(/MISSING_SYMBOL/)
  })

  it("synthesizes a stable ID when TradeID is empty (so dedup never collapses two rows)", async () => {
    const csv = `Trades,Header,DataDiscriminator,Asset Category,Currency,Symbol,Date/Time,Quantity,T. Price,Comm/Fee,TradeID
Trades,Data,Execution,Stocks,USD,AAPL,"2025-04-15, 09:30:01",100,182.45,-1.00,
Trades,Data,Execution,Stocks,USD,AAPL,"2025-04-15, 14:00:01",-100,184.10,-1.00,
`
    const file = new File([csv], "no-tradeid.csv", { type: "text/csv" })
    const r = await parseActivityStatement(file, {
      sourceTimezone: "America/New_York",
    })
    expect(r.fills).toHaveLength(2)
    expect(r.fills[0]!.source_external_id).toMatch(/^synth:/)
    expect(r.fills[1]!.source_external_id).toMatch(/^synth:/)
    expect(r.fills[0]!.source_external_id).not.toBe(
      r.fills[1]!.source_external_id
    )
  })
})
