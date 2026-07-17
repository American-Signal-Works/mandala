import { randomUUID } from "node:crypto"
import { createClient, type User } from "@supabase/supabase-js"
// @ts-expect-error -- pg is an existing runtime dependency without bundled declarations.
import { Pool } from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type {
  ContextIndexDocument,
  ContextIndexOperationResult,
  ContextIndexProvider,
} from "@workspace/control-plane"
import type { Database } from "@/lib/supabase/types"
import {
  SupabaseContextIndexRepository,
  createContextIndexProviderResolver,
  runContextIndexBatch,
  type ContextIndexRpcExecutor,
} from "."

// The dedicated package script owns this local-only opt-in switch.
// eslint-disable-next-line turbo/no-undeclared-env-vars
const optedIn = process.env.RUN_CONTEXT_INDEX_LOCAL_E2E === "1"
const localDescribe = describe.skipIf(!optedIn)

localDescribe("Context index worker local Supabase E2E", () => {
  const local = localSupabaseEnvironment()
  const admin = createClient<Database>(local.url, local.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const actor = createClient<Database>(local.url, local.anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const repository = new SupabaseContextIndexRepository(
    admin as unknown as ContextIndexRpcExecutor
  )
  const provider = new LocalFakeIndexProvider()
  const database = new Pool({ connectionString: local.databaseUrl })
  const resolveProvider = createContextIndexProviderResolver([provider])
  const sourceId = randomUUID()
  const recordId = randomUUID()
  const email = `context-index-e2e-${randomUUID()}@example.test`
  const password = `Context-index-e2e-${randomUUID()}!`
  let companyId: string | null = null
  let user: User | null = null

  beforeAll(async () => {
    // Recover only fixtures created by an interrupted prior run. Canonical
    // records must go first because their local trigger records deletion while
    // the owning company still exists.
    await database.query(
      `DELETE FROM public.external_records record
       USING public.companies company, auth.users actor
       WHERE record.company_id = company.id
         AND company.created_by = actor.id
         AND actor.email LIKE 'context-index-e2e-%@example.test'`
    )
    await database.query(
      `DELETE FROM public.companies company
       USING auth.users actor
       WHERE company.created_by = actor.id
         AND actor.email LIKE 'context-index-e2e-%@example.test'`
    )
    await database.query(
      `DELETE FROM auth.users
       WHERE email LIKE 'context-index-e2e-%@example.test'`
    )

    const created = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    })
    if (created.error || !created.data.user) {
      throw new Error(`context_index_e2e_user_failed:${created.error?.message}`)
    }
    user = created.data.user
    const signedIn = await actor.auth.signInWithPassword({ email, password })
    if (signedIn.error) {
      throw new Error(
        `context_index_e2e_sign_in_failed:${signedIn.error.message}`
      )
    }
    const company = await actor.rpc("create_company_with_owner", {
      p_name: `Context Index E2E ${randomUUID().slice(0, 8)}`,
    })
    if (
      company.error ||
      !company.data ||
      typeof company.data !== "object" ||
      Array.isArray(company.data) ||
      typeof company.data.id !== "string"
    ) {
      throw new Error(
        `context_index_e2e_company_failed:${company.error?.message}`
      )
    }
    companyId = company.data.id

    await requireSuccess(
      admin.from("external_sources").insert({
        id: sourceId,
        company_id: companyId,
        source_key: "local_e2e",
        kind: "service",
        name: "Local Context E2E",
      }),
      "source"
    )
    await requireSuccess(
      actor.rpc("publish_context_indexing_policy_v1", {
        p_company_id: companyId,
        p_source_key: "local_e2e",
        p_record_type: "test_record",
        p_expected_current_version: 0,
        p_indexing_enabled: true,
        p_approved_field_paths: ["/reference", "/summary"],
        p_maximum_content_bytes: 65_536,
        p_classification: "internal",
        p_retention_days: 30,
        p_projection_version: 1,
        p_reason: "Local-only fake provider verification.",
      }),
      "policy"
    )
    await database.query(
      `UPDATE public.context_workspace_settings
       SET provider = 'supermemory', readiness = 'ready'
       WHERE company_id = $1`,
      [companyId]
    )
    await database.query(
      `UPDATE public.context_index_operation_controls
       SET worker_enabled = true,
           canary_record_limit = 10,
           requests_per_minute = 10,
           daily_operation_cap = 10,
           daily_cost_cap_microunits = 10000,
           estimated_operation_cost_microunits = 100
       WHERE company_id = $1`,
      [companyId]
    )
    await requireSuccess(
      admin.from("external_records").insert({
        id: recordId,
        company_id: companyId,
        source_id: sourceId,
        record_type: "test_record",
        external_id: "local-e2e-1",
        payload: {
          reference: "local-e2e-1",
          summary: "bounded provider content",
          secret: "must never be projected",
        },
      }),
      "record"
    )
  }, 30_000)

  afterAll(async () => {
    const errors: string[] = []
    if (companyId) {
      try {
        await database.query(
          "DELETE FROM public.external_records WHERE company_id = $1",
          [companyId]
        )
        await database.query("DELETE FROM public.companies WHERE id = $1", [
          companyId,
        ])
      } catch (error) {
        errors.push(
          error instanceof Error ? error.message : "database_cleanup_failed"
        )
      }
    }
    if (user) {
      const cleanup = await admin.auth.admin.deleteUser(user.id)
      if (cleanup.error) errors.push(cleanup.error.message)
    }
    await actor.auth.signOut()
    await database.end()
    if (errors.length > 0) {
      throw new Error(`context_index_e2e_cleanup_failed:${errors.join("|")}`)
    }
  }, 30_000)

  it("indexes and deletes through the real lease/RPC path with a fake provider", async () => {
    if (!companyId) throw new Error("context_index_e2e_company_missing")
    const indexed = await runContextIndexBatch({
      repository,
      resolveProvider,
      workerId: "local-context-index-e2e",
      limit: 1,
      concurrency: 1,
    })
    expect(indexed).toMatchObject({ claimed: 1, completed: 1 })
    expect(provider.added).toHaveLength(1)
    expect(provider.added[0]?.content).toContain("bounded provider content")
    expect(provider.added[0]?.content).not.toContain("must never be projected")

    const ledgerAfterAdd = await database.query(
      `SELECT status, provider_document_id
       FROM public.context_index_ledger
       WHERE company_id = $1 AND canonical_record_id = $2`,
      [companyId, recordId]
    )
    expect(ledgerAfterAdd.rows).toHaveLength(1)
    expect(ledgerAfterAdd.rows[0]).toMatchObject({
      status: "indexed",
      provider_document_id: `fake-${recordId}`,
    })

    await requireSuccess(
      admin.from("external_records").delete().eq("id", recordId),
      "record_delete"
    )
    const deleted = await runContextIndexBatch({
      repository,
      resolveProvider,
      workerId: "local-context-index-e2e",
      limit: 1,
      concurrency: 1,
    })
    expect(deleted).toMatchObject({ claimed: 1, completed: 1 })
    expect(provider.deleted).toEqual([`fake-${recordId}`])

    const tombstone = await database.query(
      `SELECT confirmed_at
       FROM public.context_index_tombstones
       WHERE company_id = $1 AND canonical_record_id = $2`,
      [companyId, recordId]
    )
    expect(tombstone.rows).toHaveLength(1)
    expect(tombstone.rows[0]?.confirmed_at).not.toBeNull()
  }, 20_000)

  it("cleans up a provider add accepted while its canonical record is deleted", async () => {
    if (!companyId) throw new Error("context_index_e2e_company_missing")
    const racedRecordId = randomUUID()
    await insertRecord({
      admin,
      companyId,
      sourceId,
      recordId: racedRecordId,
      externalId: "local-e2e-orphan-race",
      summary: "deleted while provider add is in flight",
    })
    provider.beforeAddReturn = async (document) => {
      expect(document.canonicalRecordId).toBe(racedRecordId)
      await requireSuccess(
        admin.from("external_records").delete().eq("id", racedRecordId),
        "raced_record_delete"
      )
    }

    const accepted = await runContextIndexBatch({
      repository,
      resolveProvider,
      workerId: "local-context-index-orphan-race",
      limit: 1,
      concurrency: 1,
    })
    expect(accepted).toMatchObject({ claimed: 1, completed: 1 })

    const providerDocumentId = `fake-${racedRecordId}`
    const cleanupEvidence = await database.query(
      `SELECT
         ledger.provider_document_id,
         tombstone.confirmed_at,
         cleanup.delivery_state
       FROM public.context_index_ledger ledger
       JOIN public.context_index_tombstones tombstone
         ON tombstone.company_id = ledger.company_id
        AND tombstone.provider = ledger.provider
        AND tombstone.canonical_record_id = ledger.canonical_record_id
       JOIN public.context_index_outbox cleanup
         ON cleanup.id = tombstone.delete_outbox_id
       WHERE ledger.company_id = $1
         AND ledger.canonical_record_id = $2
         AND cleanup.operation = 'delete'`,
      [companyId, racedRecordId]
    )
    expect(cleanupEvidence.rows).toHaveLength(1)
    expect(cleanupEvidence.rows[0]).toMatchObject({
      provider_document_id: providerDocumentId,
      confirmed_at: null,
      delivery_state: "pending",
    })

    const cleaned = await runContextIndexBatch({
      repository,
      resolveProvider,
      workerId: "local-context-index-orphan-cleanup",
      limit: 1,
      concurrency: 1,
    })
    expect(cleaned).toMatchObject({ claimed: 1, completed: 1 })
    expect(provider.deleted).toContain(providerDocumentId)

    const confirmed = await database.query(
      `SELECT confirmed_at
       FROM public.context_index_tombstones
       WHERE company_id = $1 AND canonical_record_id = $2`,
      [companyId, racedRecordId]
    )
    expect(confirmed.rows[0]?.confirmed_at).not.toBeNull()
  }, 20_000)

  it("deletes indexed provider content when its policy is disabled", async () => {
    if (!companyId) throw new Error("context_index_e2e_company_missing")
    const disabledRecordId = randomUUID()
    await insertRecord({
      admin,
      companyId,
      sourceId,
      recordId: disabledRecordId,
      externalId: "local-e2e-policy-disable",
      summary: "must be removed after policy disable",
    })
    const indexed = await runContextIndexBatch({
      repository,
      resolveProvider,
      workerId: "local-context-index-policy-add",
      limit: 1,
      concurrency: 1,
    })
    expect(indexed).toMatchObject({ claimed: 1, completed: 1 })

    await requireSuccess(
      actor.rpc("publish_context_indexing_policy_v1", {
        p_company_id: companyId,
        p_source_key: "local_e2e",
        p_record_type: "test_record",
        p_expected_current_version: 1,
        p_indexing_enabled: false,
        p_approved_field_paths: [],
        p_maximum_content_bytes: 65_536,
        p_classification: "internal",
        p_retention_days: 30,
        p_projection_version: 1,
        p_reason: "Verify exact cleanup after local policy disable.",
      }),
      "policy_disable"
    )

    const queued = await database.query(
      `SELECT tombstone.confirmed_at, cleanup.delivery_state
       FROM public.context_index_tombstones tombstone
       JOIN public.context_index_outbox cleanup
         ON cleanup.id = tombstone.delete_outbox_id
       WHERE tombstone.company_id = $1
         AND tombstone.canonical_record_id = $2
         AND cleanup.operation = 'delete'`,
      [companyId, disabledRecordId]
    )
    expect(queued.rows).toHaveLength(1)
    expect(queued.rows[0]).toMatchObject({
      confirmed_at: null,
      delivery_state: "pending",
    })

    const cleaned = await runContextIndexBatch({
      repository,
      resolveProvider,
      workerId: "local-context-index-policy-cleanup",
      limit: 1,
      concurrency: 1,
    })
    expect(cleaned).toMatchObject({ claimed: 1, completed: 1 })
    expect(provider.deleted).toContain(`fake-${disabledRecordId}`)
    const confirmed = await database.query(
      `SELECT confirmed_at
       FROM public.context_index_tombstones
       WHERE company_id = $1 AND canonical_record_id = $2`,
      [companyId, disabledRecordId]
    )
    expect(confirmed.rows[0]?.confirmed_at).not.toBeNull()
  }, 20_000)
})

class LocalFakeIndexProvider implements ContextIndexProvider {
  readonly provider = "supermemory" as const
  readonly added: ContextIndexDocument[] = []
  readonly deleted: string[] = []
  beforeAddReturn: ((document: ContextIndexDocument) => Promise<void>) | null =
    null

  async add(
    document: ContextIndexDocument
  ): Promise<ContextIndexOperationResult> {
    this.added.push(document)
    const hook = this.beforeAddReturn
    this.beforeAddReturn = null
    if (hook) await hook(document)
    return this.result(document, "add", `fake-${document.canonicalRecordId}`)
  }

  async addBatch(documents: readonly ContextIndexDocument[]) {
    return Promise.all(documents.map((document) => this.add(document)))
  }

  async replace(_providerDocumentId: string, document: ContextIndexDocument) {
    return this.result(
      document,
      "replace",
      `fake-${document.canonicalRecordId}`
    )
  }

  async delete(request: Parameters<ContextIndexProvider["delete"]>[0]) {
    this.deleted.push(request.providerDocumentId)
    return {
      requestId: request.requestId,
      provider: this.provider,
      operation: "delete" as const,
      status: "complete" as const,
      providerDocumentId: request.providerDocumentId,
      receipt: `delete-${request.requestId}`,
      estimatedCostMicrounits: 10,
      completedAt: new Date().toISOString(),
    }
  }

  async list(): Promise<never> {
    throw new Error("not_used")
  }

  async processingStatus(): Promise<never> {
    throw new Error("not_used")
  }

  async health(): Promise<never> {
    throw new Error("not_used")
  }

  private result(
    document: ContextIndexDocument,
    operation: "add" | "replace",
    providerDocumentId: string
  ): ContextIndexOperationResult {
    return {
      requestId: document.requestId,
      provider: this.provider,
      operation,
      status: "complete",
      providerDocumentId,
      receipt: `${operation}-${document.requestId}`,
      estimatedCostMicrounits: 10,
      completedAt: new Date().toISOString(),
    }
  }
}

async function insertRecord(input: {
  admin: ReturnType<typeof createClient<Database>>
  companyId: string
  sourceId: string
  recordId: string
  externalId: string
  summary: string
}) {
  await requireSuccess(
    input.admin.from("external_records").insert({
      id: input.recordId,
      company_id: input.companyId,
      source_id: input.sourceId,
      record_type: "test_record",
      external_id: input.externalId,
      payload: {
        reference: input.externalId,
        summary: input.summary,
        secret: "must never be projected",
      },
    }),
    `record_${input.externalId}`
  )
}

async function requireSuccess(
  request: PromiseLike<{ error: { message: string } | null }>,
  step: string
) {
  const result = await request
  if (result.error)
    throw new Error(`context_index_e2e_${step}_failed:${result.error.message}`)
}

function localSupabaseEnvironment() {
  if (!optedIn) {
    return {
      url: "http://127.0.0.1:54321",
      anonKey: "skip",
      serviceRoleKey: "skip",
      databaseUrl: "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
    }
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  // eslint-disable-next-line turbo/no-undeclared-env-vars
  const databaseUrl = process.env.CONTEXT_INDEX_LOCAL_DB_URL
  if (!url || !anonKey || !serviceRoleKey || !databaseUrl) {
    throw new Error("context_index_e2e_missing_supabase_environment")
  }
  const parsed = new URL(url)
  if (
    !["127.0.0.1", "localhost"].includes(parsed.hostname) ||
    parsed.port !== "54321"
  ) {
    throw new Error(
      `context_index_e2e_refuses_non_local_supabase:${parsed.origin}`
    )
  }
  const parsedDatabase = new URL(databaseUrl)
  if (
    !["127.0.0.1", "localhost"].includes(parsedDatabase.hostname) ||
    parsedDatabase.port !== "54322"
  ) {
    throw new Error(
      `context_index_e2e_refuses_non_local_database:${parsedDatabase.origin}`
    )
  }
  return { url, anonKey, serviceRoleKey, databaseUrl }
}
