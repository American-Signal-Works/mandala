import "server-only"

import {
  createShipheroAdapterFromEnvironment,
  createTrelloAdapterFromEnvironment,
  runConnectorSyncBatch,
  SupabaseConnectorSyncStore,
  type ConnectorAdapter,
} from "@/lib/mandala/connectors"
import { createAdminClient } from "@/lib/supabase/admin"

// Cron-invoked connector sync slice. Adapters whose credentials are not
// configured in this environment are skipped rather than fatal, so a
// deployment with only Trello creds still syncs Trello.

export async function runConnectorSync() {
  const adapters: ConnectorAdapter[] = []
  const skipped: string[] = []
  for (const { sourceKey, factory } of [
    {
      sourceKey: "shiphero",
      factory: createShipheroAdapterFromEnvironment,
    },
    { sourceKey: "trello", factory: createTrelloAdapterFromEnvironment },
  ]) {
    try {
      adapters.push(factory())
    } catch (error) {
      const safeError =
        error instanceof Error ? error.message : "adapter_unavailable"
      skipped.push(safeError)
      // Keep an unavailable adapter registered so a connected source records
      // an actionable sync error instead of looking healthy-but-idle forever.
      adapters.push({
        sourceKey,
        pull: async () => {
          throw new Error(safeError)
        },
      })
    }
  }

  const store = new SupabaseConnectorSyncStore(createAdminClient())
  const batch = await runConnectorSyncBatch({
    store,
    adapters,
    options: {
      sourceKeys: adapters.map((adapter) => adapter.sourceKey),
      leaseSeconds: 240,
      // Three calls keeps a worst-case retrying slice inside the route's
      // 60-second ceiling while still allowing a Trello metadata+cards pull.
      maxApiCalls: 3,
    },
  })
  return { ...batch, skippedAdapters: skipped.length ? skipped : undefined }
}
