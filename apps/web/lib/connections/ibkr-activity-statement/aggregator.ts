import type { ParsedFill } from "./parser"

export type AggregatedTrade = {
  symbol: string
  side: "LONG" | "SHORT"
  opened_at: string
  // null for trades still open at end of imported data — gets upgraded
  // to a real timestamp when a closing fill arrives in a later import.
  closed_at: string | null
  hold_duration_seconds: number | null
  total_quantity: number
  avg_entry_price: number
  avg_exit_price: number | null
  gross_pnl: number | null
  fees: number
  net_pnl: number | null
  currency_code: string
  opening_fill_id: string
}

const EPSILON = 1e-6

type WorkingTrade = {
  symbol: string
  side: "LONG" | "SHORT"
  opened_at: string
  fills: {
    side: "BUY" | "SELL"
    quantity: number
    price: number
    fees: number
    executed_at: string
    id: string
  }[]
}

export function aggregateFillsToTrades(fills: ParsedFill[]): AggregatedTrade[] {
  // Group by symbol
  const bySymbol = new Map<string, ParsedFill[]>()
  for (const f of fills) {
    if (!bySymbol.has(f.symbol)) bySymbol.set(f.symbol, [])
    bySymbol.get(f.symbol)!.push(f)
  }
  // Sort each group chronologically
  for (const [, list] of bySymbol) {
    list.sort((a, b) => a.executed_at.localeCompare(b.executed_at))
  }

  const out: AggregatedTrade[] = []
  for (const [symbol, list] of bySymbol) {
    let position = 0
    let current: WorkingTrade | null = null
    let currency = "USD"

    function open(side: "LONG" | "SHORT", openFill: ParsedFill) {
      current = {
        symbol,
        side,
        opened_at: openFill.executed_at,
        fills: [
          {
            side: openFill.side,
            quantity: openFill.quantity,
            price: openFill.price,
            fees: openFill.fees,
            executed_at: openFill.executed_at,
            id: openFill.source_external_id,
          },
        ],
      }
      currency = openFill.currency
    }

    function close(closingFill: {
      quantity: number
      price: number
      fees: number
      side: "BUY" | "SELL"
      executed_at: string
      id: string
    }) {
      if (!current) return
      current.fills.push(closingFill)
      out.push(finalizeTrade(current, currency))
      current = null
    }

    function signedQty(f: { side: "BUY" | "SELL"; quantity: number }) {
      return f.side === "BUY" ? f.quantity : -f.quantity
    }

    for (const f of list) {
      if (Math.abs(position) < EPSILON) {
        open(f.side === "BUY" ? "LONG" : "SHORT", f)
        position = signedQty(f)
        continue
      }

      const sameDir =
        (position > 0 && f.side === "BUY") ||
        (position < 0 && f.side === "SELL")
      if (sameDir) {
        // Scale-in
        current!.fills.push({
          side: f.side,
          quantity: f.quantity,
          price: f.price,
          fees: f.fees,
          executed_at: f.executed_at,
          id: f.source_external_id,
        })
        position += signedQty(f)
        continue
      }

      const newPos = position + signedQty(f)
      if (Math.abs(newPos) < EPSILON) {
        // Exact close
        close({
          side: f.side,
          quantity: f.quantity,
          price: f.price,
          fees: f.fees,
          executed_at: f.executed_at,
          id: f.source_external_id,
        })
        position = 0
      } else if (Math.sign(newPos) === Math.sign(position)) {
        // Partial close, still in same direction
        current!.fills.push({
          side: f.side,
          quantity: f.quantity,
          price: f.price,
          fees: f.fees,
          executed_at: f.executed_at,
          id: f.source_external_id,
        })
        position = newPos
      } else {
        // FLIP — split fill into closing portion and opening portion
        const closingQty = Math.abs(position)
        const leftoverQty = Math.abs(newPos)
        const totalQty = closingQty + leftoverQty
        const closeFees = f.fees * (closingQty / totalQty)
        const openFees = f.fees * (leftoverQty / totalQty)
        close({
          side: f.side,
          quantity: closingQty,
          price: f.price,
          fees: closeFees,
          executed_at: f.executed_at,
          id: `${f.source_external_id}_close`,
        })
        // Open new opposite trade with leftover qty
        open(f.side === "BUY" ? "LONG" : "SHORT", {
          ...f,
          quantity: leftoverQty,
          fees: openFees,
          source_external_id: `${f.source_external_id}_open`,
        })
        position = signedQty({ side: f.side, quantity: leftoverQty })
      }
    }

    // If the symbol ends with an open position, emit it as an open trade so
    // the user's Trades collection reflects their current portfolio. The
    // upsert key (symbol|opened_at|side|opening_fill_id) is stable, so a
    // later re-import that includes the closing fill will UPDATE this row
    // in place rather than create a duplicate.
    if (current !== null) {
      out.push(finalizeOpenTrade(current, currency))
    }
  }

  out.sort((a, b) =>
    (a.closed_at ?? "9999").localeCompare(b.closed_at ?? "9999")
  )
  return out
}

function finalizeOpenTrade(t: WorkingTrade, currency: string): AggregatedTrade {
  // Open trade — only entry-side data is known. Exit/P&L fields are null
  // until a closing fill lands in a later import.
  const opens = t.fills
  const openQty = opens.reduce((a, f) => a + f.quantity, 0)
  const avgEntry = opens.reduce((a, f) => a + f.price * f.quantity, 0) / openQty
  const fees = opens.reduce((a, f) => a + f.fees, 0)

  return {
    symbol: t.symbol,
    side: t.side,
    opened_at: t.opened_at,
    closed_at: null,
    hold_duration_seconds: null,
    total_quantity: openQty,
    avg_entry_price: avgEntry,
    avg_exit_price: null,
    gross_pnl: null,
    fees,
    net_pnl: null,
    currency_code: currency,
    opening_fill_id: t.fills[0]!.id,
  }
}

function finalizeTrade(t: WorkingTrade, currency: string): AggregatedTrade {
  const isLong = t.side === "LONG"
  const opens = t.fills.filter((f) =>
    isLong ? f.side === "BUY" : f.side === "SELL"
  )
  const closes = t.fills.filter((f) =>
    isLong ? f.side === "SELL" : f.side === "BUY"
  )

  const openQty = opens.reduce((a, f) => a + f.quantity, 0)
  const closeQty = closes.reduce((a, f) => a + f.quantity, 0)
  const totalQty = Math.min(openQty, closeQty)

  const avgEntry = opens.reduce((a, f) => a + f.price * f.quantity, 0) / openQty
  const avgExit =
    closes.reduce((a, f) => a + f.price * f.quantity, 0) / closeQty

  const grossPnl = (avgExit - avgEntry) * totalQty * (isLong ? 1 : -1)
  const fees = t.fills.reduce((a, f) => a + f.fees, 0)
  const netPnl = grossPnl - fees

  const closedAt = closes[closes.length - 1]!.executed_at
  const openedAt = t.opened_at
  const hold =
    (new Date(closedAt).getTime() - new Date(openedAt).getTime()) / 1000

  return {
    symbol: t.symbol,
    side: t.side,
    opened_at: openedAt,
    closed_at: closedAt,
    hold_duration_seconds: Math.round(hold),
    total_quantity: totalQty,
    avg_entry_price: avgEntry,
    avg_exit_price: avgExit,
    gross_pnl: grossPnl,
    fees,
    net_pnl: netPnl,
    currency_code: currency,
    opening_fill_id: t.fills[0]!.id,
  }
}
