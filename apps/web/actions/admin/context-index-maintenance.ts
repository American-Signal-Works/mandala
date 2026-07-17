import "server-only"

import {
  SupabaseContextIndexRepository,
  type ContextIndexRpcExecutor,
} from "@/lib/mandala/context/indexing"
import { createAdminClient } from "@/lib/supabase/admin"

export async function prepareContextIndexMaintenance() {
  const repository = new SupabaseContextIndexRepository(
    createAdminClient() as unknown as ContextIndexRpcExecutor
  )
  return repository.prepare({
    now: new Date().toISOString(),
    limit: 100,
  })
}
