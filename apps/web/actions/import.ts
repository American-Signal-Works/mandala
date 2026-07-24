// apps/web/actions/import.ts
"use server"
import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { findConnection } from "@/lib/connections"
import { aggregateFillsToTrades } from "@/lib/connections/ibkr-activity-statement/aggregator"
import type { Json } from "@/lib/supabase/types"

const Result = <T>(data: T) => ({ ok: true as const, data })
const Err = (code: string, message: string) => ({
  ok: false as const,
  error: { code, message },
})

type SupabaseClient = Awaited<ReturnType<typeof createClient>>
type ConnectionFieldSpec = {
  name: string
  type: string
  options?: Array<{ value: string; label: string; color?: string }>
  config?: Record<string, unknown>
  is_system?: boolean
}
type ConnectionCollectionSpec = { name: string; fields: ConnectionFieldSpec[] }

export async function runImport(formData: FormData) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return Err("UNAUTHENTICATED", "Sign in.")

  const file = formData.get("file")
  const connectionId = String(formData.get("connectionId") ?? "")
  const settingsRaw = String(formData.get("settings") ?? "{}")
  if (!(file instanceof File)) return Err("NO_FILE", "Pick a file.")

  const conn = findConnection(connectionId)
  if (!conn)
    return Err("UNKNOWN_CONNECTION", `Connection ${connectionId} not found.`)

  let settings: unknown
  try {
    settings = conn.settingsSchema.parse(JSON.parse(settingsRaw || "{}"))
  } catch (e) {
    return Err("INVALID_SETTINGS", (e as Error).message)
  }

  if (!(await conn.canParse(file))) {
    return Err(
      "UNRECOGNIZED_FILE",
      `This file doesn't look like a ${conn.displayName} export.`
    )
  }

  let parsed: Awaited<ReturnType<typeof conn.parse>>
  try {
    parsed = await conn.parse(file, settings)
  } catch (e) {
    await recordImport(
      supabase,
      user.id,
      conn.id,
      file.name,
      "failed",
      String((e as Error).message ?? e)
    )
    return Err("PARSE_FAILED", String((e as Error).message ?? e))
  }

  // Ensure system collections exist (creates pages + default views on first run).
  const collectionIds = await ensureSystemCollections(supabase, user.id, conn)

  const fillsCollId = collectionIds["Fills"]!
  const tradesCollId = collectionIds["Trades"]!
  const fillsFieldsByName = await loadFieldsByName(supabase, fillsCollId)
  const tradesFieldsByName = await loadFieldsByName(supabase, tradesCollId)

  // Insert fills (with dedup via UNIQUE INDEX on (owner, collection, source_external_id))
  const fillsRows = (parsed.rowsByCollection["Fills"] ?? []).map((r) => {
    const row = r as Record<string, unknown> & { __external_id: string }
    return {
      owner_type: "user",
      owner_id: user.id,
      collection_id: fillsCollId,
      data: mapRowToData(row, fillsFieldsByName) as Json,
      source: `connection:${conn.id}`,
      source_external_id: row.__external_id,
    }
  })

  const { error: fillsErr, count: fillsAdded } = await supabase
    .from("collection_rows")
    .upsert(fillsRows, {
      onConflict: "owner_type,owner_id,collection_id,source_external_id",
      ignoreDuplicates: true,
      count: "exact",
    })
  if (fillsErr) {
    await recordImport(
      supabase,
      user.id,
      conn.id,
      file.name,
      "failed",
      fillsErr.message
    )
    return Err("FILL_INSERT_FAILED", fillsErr.message)
  }

  // Re-aggregate trades — fetch ALL existing fills for the affected symbols, merge with new ones,
  // pass through aggregator, upsert trades.
  const allParsedFills = (parsed.rowsByCollection["Fills"] ?? []).map((r) => {
    const row = r as Record<string, unknown> & { __external_id: string }
    return {
      symbol: String(row.Symbol),
      side: row.Side as "BUY" | "SELL",
      quantity: Number(row.Quantity),
      price: (row.Price as { amount: number }).amount,
      fees: (row.Fees as { amount: number }).amount,
      currency: (row.Price as { currency_code: string }).currency_code,
      executed_at: String(row["Executed at"]),
      source_external_id: row.__external_id,
    }
  })

  const symbols = Array.from(new Set(allParsedFills.map((f) => f.symbol)))
  const symbolFid = fillsFieldsByName["Symbol"]!
  const sideFid = fillsFieldsByName["Side"]!
  const qtyFid = fillsFieldsByName["Quantity"]!
  const priceFid = fillsFieldsByName["Price"]!
  const feesFid = fillsFieldsByName["Fees"]!
  const executedAtFid = fillsFieldsByName["Executed at"]!

  const { data: dbFills } = await supabase
    .from("collection_rows")
    .select("data, source_external_id")
    .eq("collection_id", fillsCollId)
    .eq("owner_type", "user")
    .eq("owner_id", user.id)
    .in(`data->>${symbolFid}`, symbols)

  const existingFills = (dbFills ?? []).map((row) => {
    const data = row.data as Record<string, unknown>
    const price = data[priceFid] as { amount: number; currency_code: string }
    return {
      symbol: data[symbolFid] as string,
      side: data[sideFid] as "BUY" | "SELL",
      quantity: data[qtyFid] as number,
      price: price.amount,
      fees: (data[feesFid] as { amount: number }).amount,
      currency: price.currency_code,
      executed_at: data[executedAtFid] as string,
      source_external_id: row.source_external_id ?? "",
    }
  })

  // Dedupe by source_external_id
  const seen = new Set<string>()
  const merged = [...existingFills, ...allParsedFills].filter((f) => {
    if (seen.has(f.source_external_id)) return false
    seen.add(f.source_external_id)
    return true
  })

  const trades = aggregateFillsToTrades(merged)

  // Build trade rows (upsert by stable identity: source_external_id = symbol|opened_at|side|opening_fill_id)
  const tradeRows = trades.map((t) => {
    const money = (amount: number | null) =>
      amount === null ? null : { amount, currency_code: t.currency_code }
    return {
      owner_type: "user",
      owner_id: user.id,
      collection_id: tradesCollId,
      data: {
        [tradesFieldsByName["Symbol"]!]: t.symbol,
        [tradesFieldsByName["Side"]!]: t.side,
        [tradesFieldsByName["Opened at"]!]: t.opened_at,
        [tradesFieldsByName["Closed at"]!]: t.closed_at,
        [tradesFieldsByName["Hold duration (s)"]!]: t.hold_duration_seconds,
        [tradesFieldsByName["Quantity"]!]: t.total_quantity,
        [tradesFieldsByName["Avg entry price"]!]: money(t.avg_entry_price),
        [tradesFieldsByName["Avg exit price"]!]: money(t.avg_exit_price),
        [tradesFieldsByName["Gross P&L"]!]: money(t.gross_pnl),
        [tradesFieldsByName["Fees"]!]: money(t.fees),
        [tradesFieldsByName["Net P&L"]!]: money(t.net_pnl),
        [tradesFieldsByName["Currency"]!]: t.currency_code,
      } as Json,
      source: `connection:${conn.id}`,
      source_external_id: `${t.symbol}|${t.opened_at}|${t.side}|${t.opening_fill_id}`,
    }
  })

  const { error: tradesErr, count: tradesAdded } = await supabase
    .from("collection_rows")
    .upsert(tradeRows, {
      onConflict: "owner_type,owner_id,collection_id,source_external_id",
      count: "exact",
    })
  if (tradesErr) {
    await recordImport(
      supabase,
      user.id,
      conn.id,
      file.name,
      "partial",
      tradesErr.message
    )
    return Err("TRADES_UPSERT_FAILED", tradesErr.message)
  }

  await recordImport(supabase, user.id, conn.id, file.name, "parsed", null, {
    rows_added: fillsAdded ?? 0,
    rows_skipped_unsupported: parsed.metadata.rowsSkipped,
    pipeline_rows_created: tradesAdded ?? 0,
  })

  revalidatePath("/", "layout")
  return Result({
    fillsCollId,
    tradesCollId,
    fillsAdded: fillsAdded ?? 0,
    tradesAdded: tradesAdded ?? 0,
  })
}

// === Helpers ===

async function ensureSystemCollections(
  supabase: SupabaseClient,
  userId: string,
  conn: { id: string; producedCollections: ConnectionCollectionSpec[] }
): Promise<Record<string, string>> {
  const result: Record<string, string> = {}
  for (const spec of conn.producedCollections) {
    let { data: existing } = await supabase
      .from("collections")
      .select("id")
      .eq("owner_type", "user")
      .eq("owner_id", userId)
      .eq("managed_by_connection", conn.id)
      .eq("name", spec.name)
      .is("deleted_at", null)
      .maybeSingle()

    if (!existing) {
      const { data: created, error: createErr } = await supabase
        .from("collections")
        .insert({
          owner_type: "user",
          owner_id: userId,
          name: spec.name,
          is_system: true,
          managed_by_connection: conn.id,
        })
        .select("id")
        .single()
      if (createErr || !created)
        throw new Error(
          `Failed to create ${spec.name} collection: ${createErr?.message ?? "unknown"}`
        )
      existing = created

      // Insert system fields
      const fieldsRows = spec.fields.map((f, idx) => ({
        owner_type: "user" as const,
        owner_id: userId,
        collection_id: created.id,
        name: f.name,
        type: f.type,
        options: (f.options ?? []) as Json,
        config: (f.config ?? {}) as Json,
        is_system: true,
        sort_index: (idx + 1) * 1000,
      }))
      await supabase.from("collection_fields").insert(fieldsRows)

      // Default view
      await supabase.from("collection_views").insert({
        owner_type: "user",
        owner_id: userId,
        collection_id: created.id,
        name: "Default view",
        type: "list",
        config: { sort: [], filters: [], visibleFields: [] } as unknown as Json,
        is_default: true,
      })

      // Sidebar page entry
      const { data: lastPage } = await supabase
        .from("pages")
        .select("sort_index")
        .eq("owner_type", "user")
        .eq("owner_id", userId)
        .is("deleted_at", null)
        .order("sort_index", { ascending: false })
        .limit(1)
        .maybeSingle()
      const sort_index = (lastPage?.sort_index ?? 0) + 1000

      await supabase.from("pages").insert({
        owner_type: "user",
        owner_id: userId,
        title: spec.name,
        page_type: "collection",
        collection_id: created.id,
        sort_index,
      })
    }
    result[spec.name] = existing.id
  }
  return result
}

async function loadFieldsByName(
  supabase: SupabaseClient,
  collectionId: string
): Promise<Record<string, string>> {
  const { data } = await supabase
    .from("collection_fields")
    .select("id, name")
    .eq("collection_id", collectionId)
  return Object.fromEntries((data ?? []).map((f) => [f.name, f.id]))
}

function mapRowToData(
  row: Record<string, unknown>,
  fieldsByName: Record<string, string>
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [name, id] of Object.entries(fieldsByName)) {
    if (name in row) out[id] = row[name]
  }
  return out
}

async function recordImport(
  supabase: SupabaseClient,
  userId: string,
  connId: string,
  filename: string,
  status: "parsed" | "failed" | "partial",
  errorMessage: string | null,
  counts: Partial<{
    rows_added: number
    rows_skipped_duplicate: number
    rows_skipped_unsupported: number
    pipeline_rows_created: number
    pipeline_rows_updated: number
  }> = {}
) {
  await supabase.from("connection_imports").insert({
    owner_type: "user",
    owner_id: userId,
    connection: connId,
    filename,
    status,
    error_message: errorMessage,
    rows_added: counts.rows_added ?? 0,
    rows_skipped_duplicate: counts.rows_skipped_duplicate ?? 0,
    rows_skipped_unsupported: counts.rows_skipped_unsupported ?? 0,
    pipeline_rows_created: counts.pipeline_rows_created ?? 0,
    pipeline_rows_updated: counts.pipeline_rows_updated ?? 0,
  })
}
