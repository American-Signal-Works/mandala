// apps/web/lib/connections/types.ts
import type { ZodType } from "zod"

export type RawRow = Record<string, unknown>

export type CollectionFieldSpec = {
  name: string
  type:
    | "text"
    | "number"
    | "currency"
    | "date"
    | "datetime"
    | "select"
    | "multi_select"
    | "checkbox"
  options?: Array<{ value: string; label: string; color?: string }>
  config?: Record<string, unknown>
  is_system?: boolean
}

export type ConnectionCollectionSpec = {
  name: string // e.g., 'Fills', 'Trades'
  fields: CollectionFieldSpec[]
}

export type ParseResult = {
  rowsByCollection: Record<string, RawRow[]> // keyed by collection name
  metadata: {
    rowCount: number
    rowsSkipped: number
  }
}

export type Connection<S = unknown> = {
  id: string
  displayName: string
  description: string
  settingsSchema: ZodType<S>
  defaultSettings: S
  producedCollections: ConnectionCollectionSpec[]
  canParse(file: File): Promise<boolean>
  parse(file: File, settings: S): Promise<ParseResult>
  postProcess?(ctx: {
    ownerType: string
    ownerId: string
  }): Promise<{ rowsCreated: number; rowsUpdated: number }>
}
