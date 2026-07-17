import {
  connectorPullResultSchema,
  connectorWorkerOptionsSchema,
  type ConnectorAdapter,
  type ConnectorSyncBatchResult,
  type ConnectorSyncStore,
  type ConnectorWorkerOptions,
} from "./types"

// One bounded slice of connector work per invocation: claim at most one due
// source, pull at most `maxApiCalls` external requests, write only changed
// rows, persist the resume cursor. A full source cycle spreads across many
// cron ticks by design — the route's maxDuration must never be the thing
// that ends a slice.

export async function runConnectorSyncBatch(input: {
  store: ConnectorSyncStore
  adapters: ConnectorAdapter[]
  options: ConnectorWorkerOptions
  now?: Date
}): Promise<ConnectorSyncBatchResult> {
  const options = connectorWorkerOptionsSchema.parse(input.options)
  const now = input.now ?? new Date()
  const adaptersBySourceKey = new Map(
    input.adapters.map((adapter) => [adapter.sourceKey, adapter])
  )

  const source = await input.store.claimDueSource({
    now,
    sourceKeys: options.sourceKeys.filter((sourceKey) =>
      adaptersBySourceKey.has(sourceKey)
    ),
    leaseSeconds: options.leaseSeconds,
  })
  if (!source) return { claimed: false }

  const adapter = adaptersBySourceKey.get(source.sourceKey)
  if (!adapter) {
    await input.store.failSync({
      source,
      error: `no_adapter_for_source:${source.sourceKey}`,
      now,
    })
    return {
      claimed: true,
      sourceKey: source.sourceKey,
      kind: source.kind,
      error: "no_adapter",
    }
  }

  try {
    const pull = connectorPullResultSchema.parse(
      await adapter.pull({
        cursor: source.sync.cursor,
        config: source.config,
        watermarks: source.sync.watermarks,
        budget: { maxApiCalls: options.maxApiCalls },
        now,
      })
    )

    const outcome = await input.store.upsertRecords({
      source,
      records: pull.records,
      pulledAt: now.toISOString(),
    })

    if (pull.nextCursor) {
      await input.store.saveCursor({ source, cursor: pull.nextCursor })
    } else {
      await input.store.completeSync({
        source,
        now,
        watermarks: pull.watermarks,
      })
    }

    return {
      claimed: true,
      sourceKey: source.sourceKey,
      kind: source.kind,
      phase: pull.nextCursor?.phase ?? null,
      records: pull.records.length,
      written: outcome.written,
      skipped: outcome.skipped,
      apiCalls: pull.apiCalls,
      completed: pull.nextCursor === null,
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "unknown_connector_error"
    await input.store.failSync({ source, error: message, now })
    return {
      claimed: true,
      sourceKey: source.sourceKey,
      kind: source.kind,
      completed: false,
      error: message,
    }
  }
}
