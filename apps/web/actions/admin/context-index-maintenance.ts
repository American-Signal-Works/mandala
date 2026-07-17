import "server-only"

import {
  createContextIndexProviderResolver,
  runContextIndexBatch,
  SupabaseContextIndexRepository,
  type ContextIndexRpcExecutor,
} from "@/lib/mandala/context/indexing"
import { createSupermemoryIndexProviderFromEnvironment } from "@/lib/mandala/context/supermemory-provider"
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

export async function runContextIndexMaintenance() {
  const now = new Date()
  const admin = createAdminClient()
  const repository = new SupabaseContextIndexRepository(
    admin as unknown as ContextIndexRpcExecutor
  )
  const provider = createSupermemoryIndexProviderFromEnvironment({
    now: () => now,
  })
  const healthReservation = await admin.rpc(
    "reserve_context_provider_health_v1",
    { p_now: now.toISOString() }
  )
  const healthReserved = healthReservation.data as
    | { reserved?: unknown }
    | null
  if (healthReservation.error || healthReserved?.reserved !== true) {
    throw new Error("context_provider_rate_limited")
  }
  // This scope only produces a tenant-shaped container tag. The list call is
  // bounded to one item and proves the configured provider credential works
  // before any tenant write can be claimed.
  const health = await provider.health({
    companyId: "00000000-0000-4000-8000-000000000000",
    workspaceScopeId: "00000000-0000-4000-8000-000000000000",
  })
  const healthRecord = await admin.rpc("record_context_provider_health_v1", {
    p_status: health.status,
    p_detail_code: health.detailCode ?? "provider_health_unknown",
    p_now: health.checkedAt,
  })
  if (healthRecord.error || health.status !== "healthy") {
    throw new Error("context_provider_not_operational")
  }
  const preparation = await repository.prepare({
    now: now.toISOString(),
    limit: 100,
  })
  const batch = await runContextIndexBatch({
    repository,
    resolveProvider: createContextIndexProviderResolver([provider]),
    workerId: `vercel-context-index-${process.env.VERCEL_REGION ?? "local"}`,
    limit: 3,
    leaseSeconds: 120,
    concurrency: 1,
    now,
  })
  return { preparation, batch, providerOperational: health.status === "healthy" }
}
