// apps/web/lib/collections/collection.ts
import { createClient as createServerSupabase } from "@/lib/supabase/server"
import type { Field, Filter, Row, Sort } from "./types"

export class Collection {
  constructor(
    public readonly id: string,
    public readonly name: string,
    public readonly fields: Field[],
    public readonly managedByConnection: string | null = null,
    public readonly isSystem: boolean = false
  ) {}

  static async load(collectionId: string): Promise<Collection> {
    const supabase = await createServerSupabase()
    const [{ data: meta }, { data: fields }] = await Promise.all([
      supabase
        .from("collections")
        .select("id, name, managed_by_connection, is_system")
        .eq("id", collectionId)
        .single(),
      supabase
        .from("collection_fields")
        .select("*")
        .eq("collection_id", collectionId)
        .order("sort_index"),
    ])
    if (!meta) throw new Error("Collection not found")
    return new Collection(
      meta.id,
      meta.name,
      (fields ?? []) as unknown as Field[],
      meta.managed_by_connection ?? null,
      meta.is_system ?? false
    )
  }

  fieldsById(): Record<string, Field> {
    return Object.fromEntries(this.fields.map((f) => [f.id, f]))
  }

  async list(
    opts: {
      filters?: Filter[]
      sort?: Sort[]
      limit?: number
      offset?: number
    } = {}
  ): Promise<Row[]> {
    const supabase = await createServerSupabase()
    let query = supabase
      .from("collection_rows")
      .select("*")
      .eq("collection_id", this.id)
    if (opts.limit) query = query.limit(opts.limit)
    if (opts.offset)
      query = query.range(opts.offset, opts.offset + (opts.limit ?? 100) - 1)
    const { data, error } = await query
    if (error) throw new Error(error.message)

    const fieldsById = this.fieldsById()
    let rows = (data ?? []) as unknown as Row[]

    if (opts.filters?.length) {
      rows = applyFiltersInJS(rows, opts.filters, fieldsById)
    }
    if (opts.sort?.length) {
      rows = applySortInJS(rows, opts.sort, fieldsById)
    }
    return rows
  }

  async count(opts: { filters?: Filter[] } = {}): Promise<number> {
    const rows = await this.list({ filters: opts.filters })
    return rows.length
  }

  async getRow(rowId: string): Promise<Row | null> {
    const supabase = await createServerSupabase()
    const { data, error } = await supabase
      .from("collection_rows")
      .select("*")
      .eq("id", rowId)
      .eq("collection_id", this.id)
      .maybeSingle()
    if (error) throw new Error(error.message)
    return (data ?? null) as unknown as Row | null
  }

  async aggregate(spec: AggregateSpec): Promise<AggregateResult> {
    const rows = await this.list({ filters: spec.filters })
    const fieldsById = this.fieldsById()
    return aggregateRows(rows, fieldsById, spec)
  }
}

function applyFiltersInJS(
  rows: Row[],
  filters: Filter[],
  fields: Record<string, Field>
): Row[] {
  return rows.filter((row) =>
    filters.every((f) => {
      const field = fields[f.fieldId]
      if (!field) return false
      const v = row.data[f.fieldId]
      switch (f.operator) {
        case "eq":
          return v === f.value
        case "neq":
          return v !== f.value
        case "gt":
          return (
            typeof v === "number" && typeof f.value === "number" && v > f.value
          )
        case "gte":
          return (
            typeof v === "number" && typeof f.value === "number" && v >= f.value
          )
        case "lt":
          return (
            typeof v === "number" && typeof f.value === "number" && v < f.value
          )
        case "lte":
          return (
            typeof v === "number" && typeof f.value === "number" && v <= f.value
          )
        case "contains":
          return (
            typeof v === "string" &&
            typeof f.value === "string" &&
            v.toLowerCase().includes(f.value.toLowerCase())
          )
        case "starts_with":
          return (
            typeof v === "string" &&
            typeof f.value === "string" &&
            v.toLowerCase().startsWith(f.value.toLowerCase())
          )
        case "is_empty":
          return (
            v === null ||
            v === undefined ||
            v === "" ||
            (Array.isArray(v) && v.length === 0)
          )
        case "is_not_empty":
          return !(
            v === null ||
            v === undefined ||
            v === "" ||
            (Array.isArray(v) && v.length === 0)
          )
        case "in":
          return Array.isArray(f.value) && f.value.includes(v as string)
        case "not_in":
          return Array.isArray(f.value) && !f.value.includes(v as string)
      }
    })
  )
}

function applySortInJS(
  rows: Row[],
  sorts: Sort[],
  _fields: Record<string, Field>
): Row[] {
  void _fields

  return [...rows].sort((a, b) => {
    for (const s of sorts) {
      const av = a.data[s.fieldId]
      const bv = b.data[s.fieldId]
      const cmp = compareValues(av, bv)
      if (cmp !== 0) return s.direction === "asc" ? cmp : -cmp
    }
    return 0
  })
}

function compareValues(a: unknown, b: unknown): number {
  if (a === b) return 0
  if (a === null || a === undefined) return 1
  if (b === null || b === undefined) return -1
  if (typeof a === "number" && typeof b === "number") return a - b
  return String(a).localeCompare(String(b))
}

// === Aggregation (added in Plan 3) ===

export type AggregateMetric =
  | { kind: "count" }
  | { kind: "sum"; fieldId: string }
  | { kind: "avg"; fieldId: string }
  | { kind: "min"; fieldId: string }
  | { kind: "max"; fieldId: string }

export type AggregateSpec = {
  metric: AggregateMetric
  filters?: Filter[]
  groupBy?: string[]
}

export type AggregateResult =
  | { value: number }
  | { groups: Array<{ key: Record<string, string>; value: number }> }

export function aggregateRows(
  rows: Row[],
  _fields: Record<string, Field>,
  spec: AggregateSpec
): AggregateResult {
  void _fields

  function metricFor(group: Row[]): number {
    if (spec.metric.kind === "count") return group.length
    const fid = spec.metric.fieldId
    const values = group
      .map((r) => {
        const v = r.data[fid]
        if (typeof v === "number") return v
        // Currency field stores { amount, currency_code } — extract the amount.
        if (
          v &&
          typeof v === "object" &&
          !Array.isArray(v) &&
          typeof (v as { amount: unknown }).amount === "number"
        ) {
          return (v as { amount: number }).amount
        }
        return null
      })
      .filter((v): v is number => v !== null)
    if (values.length === 0) return 0
    switch (spec.metric.kind) {
      case "sum":
        return values.reduce((a, b) => a + b, 0)
      case "avg":
        return values.reduce((a, b) => a + b, 0) / values.length
      case "min":
        return Math.min(...values)
      case "max":
        return Math.max(...values)
    }
  }

  if (!spec.groupBy || spec.groupBy.length === 0) {
    return { value: metricFor(rows) }
  }

  const buckets = new Map<
    string,
    { key: Record<string, string>; rows: Row[] }
  >()
  for (const row of rows) {
    const key: Record<string, string> = {}
    for (const fid of spec.groupBy) key[fid] = String(row.data[fid] ?? "")
    const k = JSON.stringify(key)
    if (!buckets.has(k)) buckets.set(k, { key, rows: [] })
    buckets.get(k)!.rows.push(row)
  }

  const groupBy = spec.groupBy
  const groups = Array.from(buckets.values())
    .map((b) => ({ key: b.key, value: metricFor(b.rows) }))
    .sort((a, b) => {
      const f = groupBy[0]!
      return String(a.key[f] ?? "").localeCompare(String(b.key[f] ?? ""))
    })

  return { groups }
}
