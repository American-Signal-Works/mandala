import { z } from "zod"

// A single normalized record destined for public.external_records. The
// (recordType, externalId) pair must be stable across pulls — it is the
// upsert identity within a source, and unstable ids create duplicate rows
// plus needless context-index churn.
export const connectorRecordSchema = z.object({
  recordType: z.string().min(1),
  externalId: z.string().min(1),
  payload: z.record(z.string(), z.unknown()),
})
export type ConnectorRecord = z.infer<typeof connectorRecordSchema>

// Serializable resume point stored in external_sources.config.sync.cursor.
// A non-null cursor means "this cycle is mid-flight; continue on the next
// tick". Shape beyond `phase` is adapter-owned.
export const connectorCursorSchema = z
  .object({ phase: z.string().min(1) })
  .passthrough()
export type ConnectorCursor = z.infer<typeof connectorCursorSchema>

export const connectorSyncConfigSchema = z
  .object({
    enabled: z.boolean().default(true),
    intervalMinutes: z.number().int().min(5).max(10080).default(720),
    cursor: connectorCursorSchema.nullable().default(null),
    leaseExpiresAt: z.string().nullable().default(null),
    // Adapter watermarks (e.g. newest sales order date already synced) merged
    // in by completeSync; adapters read them for incremental pulls.
    watermarks: z.record(z.string(), z.string()).default({}),
  })
  .passthrough()
export type ConnectorSyncConfig = z.infer<typeof connectorSyncConfigSchema>

export type ConnectorPullInput = {
  cursor: ConnectorCursor | null
  config: Record<string, unknown>
  watermarks: Record<string, string>
  budget: { maxApiCalls: number }
  now: Date
}

export type ConnectorPullResult = {
  records: ConnectorRecord[]
  // null = this sync cycle is complete; non-null = continue next tick.
  nextCursor: ConnectorCursor | null
  apiCalls: number
  // Only read on cycle completion (nextCursor === null).
  watermarks?: Record<string, string>
}

export interface ConnectorAdapter {
  readonly kind: string
  pull(input: ConnectorPullInput): Promise<ConnectorPullResult>
}

export type SyncableSource = {
  id: string
  companyId: string
  sourceKey: string
  kind: string
  config: Record<string, unknown>
  sync: ConnectorSyncConfig
  lastSyncedAt: string | null
}

export type UpsertOutcome = { written: number; skipped: number }

export interface ConnectorSyncStore {
  claimDueSource(input: { now: Date; kinds: string[]; leaseSeconds: number }): Promise<SyncableSource | null>
  upsertRecords(input: {
    source: SyncableSource
    records: ConnectorRecord[]
    pulledAt: string
  }): Promise<UpsertOutcome>
  saveCursor(input: { source: SyncableSource; cursor: ConnectorCursor }): Promise<void>
  completeSync(input: {
    source: SyncableSource
    now: Date
    watermarks?: Record<string, string>
  }): Promise<void>
  failSync(input: { source: SyncableSource; error: string; now: Date }): Promise<void>
}

export const connectorWorkerOptionsSchema = z.object({
  kinds: z.array(z.string().min(1)).min(1),
  leaseSeconds: z.number().int().min(30).max(900).default(240),
  maxApiCalls: z.number().int().min(1).max(20).default(6),
})
export type ConnectorWorkerOptions = z.infer<typeof connectorWorkerOptionsSchema>

export type ConnectorSyncBatchResult = {
  claimed: boolean
  sourceKey?: string
  kind?: string
  phase?: string | null
  records?: number
  written?: number
  skipped?: number
  apiCalls?: number
  completed?: boolean
  error?: string
}
