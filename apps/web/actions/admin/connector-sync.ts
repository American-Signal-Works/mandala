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
  for (const factory of [createShipheroAdapterFromEnvironment, createTrelloAdapterFromEnvironment]) {
    try {
      adapters.push(factory())
    } catch (error) {
      skipped.push(error instanceof Error ? error.message : "adapter_unavailable")
    }
  }
  if (!adapters.length) {
    return { claimed: false, skippedAdapters: skipped }
  }

  const store = new SupabaseConnectorSyncStore(createAdminClient())
  const batch = await runConnectorSyncBatch({
    store,
    adapters,
    options: {
      kinds: adapters.map((adapter) => adapter.kind),
      leaseSeconds: 240,
      maxApiCalls: 6,
    },
  })
  return { ...batch, skippedAdapters: skipped.length ? skipped : undefined }
}
