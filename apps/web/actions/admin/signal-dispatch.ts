import "server-only"

import {
  createAgentSignalExecutor,
  runSignalDispatchBatch,
  SupabaseSignalDispatchRepository,
  type SignalRpcExecutor,
} from "@/lib/mandala/signals"
import { createAdminClient } from "@/lib/supabase/admin"

export async function runSignalDispatchMaintenance() {
  const now = new Date()
  const admin = createAdminClient()
  const repository = new SupabaseSignalDispatchRepository(
    admin as unknown as SignalRpcExecutor
  )
  const preparation = await repository.prepare({
    now: now.toISOString(),
    changeLimit: 500,
    scheduleLimit: 100,
  })
  const batch = await runSignalDispatchBatch({
    repository,
    executor: createAgentSignalExecutor({
      supabase: admin,
      dataSupabase: admin,
    }),
    workerId: `vercel-signal-${process.env.VERCEL_REGION ?? "local"}`,
    limit: 10,
    leaseSeconds: 300,
    concurrency: 2,
    now,
  })
  return { preparation, batch }
}
