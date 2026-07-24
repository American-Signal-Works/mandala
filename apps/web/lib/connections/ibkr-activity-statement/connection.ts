// apps/web/lib/connections/ibkr-activity-statement/connection.ts
import { z } from "zod"
import type { Connection, ConnectionCollectionSpec } from "../types"
import { parseActivityStatement } from "./parser"

const FILLS_FIELDS: ConnectionCollectionSpec["fields"] = [
  { name: "Symbol", type: "text", is_system: true },
  {
    name: "Side",
    type: "select",
    options: [
      { value: "BUY", label: "Buy" },
      { value: "SELL", label: "Sell" },
    ],
    is_system: true,
  },
  { name: "Quantity", type: "number", is_system: true },
  { name: "Price", type: "currency", is_system: true },
  { name: "Fees", type: "currency", is_system: true },
  { name: "Executed at", type: "datetime", is_system: true },
]

const TRADES_FIELDS: ConnectionCollectionSpec["fields"] = [
  { name: "Symbol", type: "text", is_system: true },
  {
    name: "Side",
    type: "select",
    options: [
      { value: "LONG", label: "Long" },
      { value: "SHORT", label: "Short" },
    ],
    is_system: true,
  },
  { name: "Opened at", type: "datetime", is_system: true },
  { name: "Closed at", type: "datetime", is_system: true },
  { name: "Hold duration (s)", type: "number", is_system: true },
  { name: "Quantity", type: "number", is_system: true },
  { name: "Avg entry price", type: "currency", is_system: true },
  { name: "Avg exit price", type: "currency", is_system: true },
  { name: "Gross P&L", type: "currency", is_system: true },
  { name: "Fees", type: "currency", is_system: true },
  { name: "Net P&L", type: "currency", is_system: true },
  { name: "Currency", type: "text", is_system: true },
]

const SettingsSchema = z.object({ sourceTimezone: z.string() })
type Settings = z.infer<typeof SettingsSchema>

export const ibkrActivityStatement: Connection<Settings> = {
  id: "ibkr-activity-statement",
  displayName: "Interactive Brokers — Activity Statement",
  description:
    "Import your IBKR Activity Statement CSV. Produces Fills (raw executions) and Trades (round-trip aggregated) collections.",
  settingsSchema: SettingsSchema,
  defaultSettings: { sourceTimezone: "America/New_York" },
  producedCollections: [
    { name: "Fills", fields: FILLS_FIELDS },
    { name: "Trades", fields: TRADES_FIELDS },
  ],

  async canParse(file: File) {
    // Cheap check: read first 8KB, look for "Trades,Header"
    const head = await file.slice(0, 8192).text()
    return head.includes("Trades,Header")
  },

  async parse(file, settings) {
    const result = await parseActivityStatement(file, settings)
    const fillsRows = result.fills.map((f) => ({
      Symbol: f.symbol,
      Side: f.side,
      Quantity: f.quantity,
      Price: { amount: f.price, currency_code: f.currency },
      Fees: { amount: f.fees, currency_code: f.currency },
      "Executed at": f.executed_at,
      __external_id: f.source_external_id,
    }))
    return {
      rowsByCollection: { Fills: fillsRows },
      metadata: {
        rowCount: fillsRows.length,
        rowsSkipped: result.skippedNonStock,
      },
    }
  },

  // postProcess (round-trip aggregator) is run inline by the import Server Action,
  // not here — it needs DB access to upsert into the Trades collection.
}
