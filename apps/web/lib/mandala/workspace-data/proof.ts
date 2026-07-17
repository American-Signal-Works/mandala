import { createHash } from "node:crypto"
import type { WorkflowSupabaseClient } from "../workflows"
import { asWorkspaceDatabase } from "./database"

const monitoredTables = [
  table("external_sources", "updated_at"),
  table("external_records", "updated_at"),
  table("external_record_links", "created_at"),
  table("agent_workflows", "updated_at"),
  table("workflow_runs", "started_at"),
  table("workflow_events", "created_at"),
  table("workflow_items", "updated_at"),
  table("workflow_context_packets", "created_at"),
  table("workflow_recommendation_runs", "created_at"),
  table("workflow_evidence_snapshots", "created_at"),
  table("workflow_action_drafts", "updated_at"),
  table("workflow_action_attempts", "created_at"),
  table("workflow_audit_events", "created_at"),
  table("workflow_control_requests", "updated_at"),
  table("agent_execution_receipts", "recorded_at"),
  table("agent_memory_candidates", "updated_at"),
  table("agent_signal_change_windows", "updated_at"),
  table("agent_signal_dispatches", "updated_at"),
  table("agent_signal_dispatch_events", "created_at"),
] as const

export type SandboxFingerprint = {
  digest: string
  tables: string[]
  state: Record<string, { count: number; latest: string | null }>
}

export async function captureSandboxFingerprint(input: {
  supabase: WorkflowSupabaseClient
  companyId: string
}): Promise<SandboxFingerprint> {
  const db = asWorkspaceDatabase(input.supabase)
  const entries = await Promise.all(
    monitoredTables.map(async ({ name, clock }) => {
      const result = await db
        .from<Record<string, string | undefined>>(name)
        .select(`id, ${clock}`, { count: "exact" })
        .eq("company_id", input.companyId)
        .order(clock, { ascending: false })
        .limit(1)
        .maybeSingle()
      if (result.error)
        throw new Error(
          `Sandbox proof could not inspect ${name}: ${result.error.message || "database query failed"}`
        )
      return [
        name,
        {
          count: result.count ?? 0,
          latest: result.data?.[clock] ?? null,
        },
      ] as const
    })
  )
  const state = Object.fromEntries(entries)
  return {
    digest: createHash("sha256").update(JSON.stringify(state)).digest("hex"),
    tables: monitoredTables.map(({ name }) => name),
    state,
  }
}

function table(name: string, clock: string) {
  return { name, clock }
}
