import Papa from "papaparse"
import { fromZonedTime } from "date-fns-tz"

export type ParsedFill = {
  symbol: string
  side: "BUY" | "SELL"
  quantity: number
  price: number
  fees: number
  currency: string
  executed_at: string // UTC ISO
  source_external_id: string // IBKR TradeID
}

export type ParseSettings = { sourceTimezone: string }

export async function parseActivityStatement(
  file: File,
  settings: ParseSettings
): Promise<{ fills: ParsedFill[]; skippedNonStock: number }> {
  const text = await file.text()
  const parsed = Papa.parse<string[]>(text, { skipEmptyLines: true })
  const rows = parsed.data

  // Find the Trades section header row
  let headerIdx = -1
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    if (r && r[0] === "Trades" && r[1] === "Header") {
      headerIdx = i
      break
    }
  }
  if (headerIdx === -1) throw new Error("NO_TRADES_SECTION")

  const header = rows[headerIdx]!
  const idx = {
    discriminator: header.indexOf("DataDiscriminator"),
    assetCategory: header.indexOf("Asset Category"),
    currency: header.indexOf("Currency"),
    symbol: header.indexOf("Symbol"),
    dateTime: header.indexOf("Date/Time"),
    quantity: header.indexOf("Quantity"),
    price: header.indexOf("T. Price"),
    fee: header.indexOf("Comm/Fee"),
    tradeId: header.indexOf("TradeID"),
  }
  for (const [k, v] of Object.entries(idx)) {
    if (v < 0) throw new Error(`MISSING_COLUMN: ${k}`)
  }

  const fills: ParsedFill[] = []
  let skippedNonStock = 0

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i]
    if (!r) continue
    if (r[0] !== "Trades") break
    if (r[1] === "Header") continue
    if (r[1] !== "Data") continue
    if (r[idx.discriminator] !== "Execution") continue
    if (r[idx.assetCategory] !== "Stocks") {
      skippedNonStock++
      continue
    }

    const symbol = r[idx.symbol]
    if (!symbol) throw new Error(`MISSING_SYMBOL: row ${i + 1}`)

    const qtyRaw = r[idx.quantity]
    if (qtyRaw === undefined || qtyRaw.trim() === "")
      throw new Error(`INVALID_QUANTITY: row ${i + 1}`)
    const qty = Number(qtyRaw)
    if (Number.isNaN(qty)) throw new Error(`INVALID_QUANTITY: row ${i + 1}`)

    const priceRaw = r[idx.price]
    if (priceRaw === undefined || priceRaw.trim() === "")
      throw new Error(`INVALID_PRICE: row ${i + 1}`)
    const price = Number(priceRaw)
    if (Number.isNaN(price)) throw new Error(`INVALID_PRICE: row ${i + 1}`)

    const feeRaw = r[idx.fee]
    if (feeRaw === undefined || feeRaw.trim() === "")
      throw new Error(`INVALID_FEE: row ${i + 1}`)
    const fee = Number(feeRaw)
    if (Number.isNaN(fee)) throw new Error(`INVALID_FEE: row ${i + 1}`)

    const localDate = parseIBKRDate(r[idx.dateTime] ?? "")
    const utcDate = fromZonedTime(localDate, settings.sourceTimezone)

    const rawTradeId = r[idx.tradeId]
    // Real IBKR Activity Statements occasionally omit TradeID for some Execution
    // rows (corporate actions, splits). Synthesize a stable ID rather than
    // collapse all such rows to "" and trip the dedup unique constraint.
    const tradeId =
      rawTradeId && rawTradeId.length > 0
        ? rawTradeId
        : `synth:${symbol}:${utcDate.toISOString()}:${qtyRaw}`

    fills.push({
      symbol,
      side: qty > 0 ? "BUY" : "SELL",
      quantity: Math.abs(qty),
      price,
      fees: Math.abs(fee),
      currency: r[idx.currency] ?? "USD",
      executed_at: utcDate.toISOString(),
      source_external_id: tradeId,
    })
  }

  return { fills, skippedNonStock }
}

function parseIBKRDate(input: string): Date {
  // Format: "2025-04-15, 09:32:14"
  const m = /^(\d{4})-(\d{2})-(\d{2}),\s*(\d{2}):(\d{2}):(\d{2})$/.exec(input)
  if (!m) throw new Error(`UNRECOGNIZED_DATE: ${input}`)
  const [, y, mo, d, h, mi, s] = m
  return new Date(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(h),
    Number(mi),
    Number(s)
  )
}
