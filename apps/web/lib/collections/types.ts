// apps/web/lib/collections/types.ts
export type FieldType =
  | "text"
  | "number"
  | "currency"
  | "date"
  | "datetime"
  | "select"
  | "multi_select"
  | "checkbox"

export type SelectOption = { value: string; label: string; color?: string }

export type FieldConfig = {
  precision?: number // number/currency
  format?: "decimal" | "percent" // number
  defaultCurrency?: string // currency — used as default when adding rows
}

export type Field = {
  id: string
  collection_id: string
  name: string
  type: FieldType
  options: SelectOption[]
  config: FieldConfig
  is_system: boolean
  sort_index: number
}

export type FieldValue =
  | string // text, date, datetime (ISO), select
  | number // number
  | boolean // checkbox
  | string[] // multi_select
  | { amount: number; currency_code: string } // currency
  | null

export type Row = {
  id: string
  collection_id: string
  data: Record<string, FieldValue> // keyed by field.id
  source: "user" | `connection:${string}`
  source_external_id: string | null
  created_at: string
  updated_at: string
}

export type FilterOperator =
  | "eq"
  | "neq"
  | "contains"
  | "starts_with"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "is_empty"
  | "is_not_empty"
  | "in"
  | "not_in"

export type Filter = {
  fieldId: string
  operator: FilterOperator
  value?: FieldValue
}

export type Sort = { fieldId: string; direction: "asc" | "desc" }

export type ViewConfig = {
  sort: Sort[]
  filters: Filter[]
  visibleFields: string[] // field IDs in order; if empty, show all
}
