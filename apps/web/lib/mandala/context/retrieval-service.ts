import "server-only"

import { createHash, randomUUID } from "node:crypto"
import { z } from "zod"
import {
  contextRetrievalBoundsSchema,
  contextRetrievalRequestSchema,
  contextRetrievalResultSchema,
  type ContextRetrievalProvider,
  type ContextRetrievalResult,
} from "@workspace/control-plane"
import type {
  RuntimeContextRetrievalInput,
  RuntimeContextRetriever,
} from "../runtime/graph"
import type { WorkflowSupabaseClient } from "../workflows"
import { createSupermemoryRetrievalProviderFromEnvironment } from "./supermemory-provider"

const UUID = z.string().uuid()
const HASH = z.string().regex(/^[0-9a-f]{64}$/)
const SAFE_KEY = z.string().trim().min(1).max(150)
const SAFE_REFERENCE = z.string().trim().min(1).max(500)

const storedSettingsSchema = z
  .object({
    company_id: UUID,
    provider: z.enum(["off", "supermemory"]),
    readiness: z.enum(["disabled", "not_ready", "ready", "error"]),
  })
  .strict()

const ledgerRowSchema = z
  .object({
    canonical_record_id: UUID,
    source_key: SAFE_KEY,
    record_type: SAFE_KEY,
    canonical_version: z.string().trim().min(1).max(200),
    policy_version: z.number().int().positive(),
    policy_hash: HASH,
    content_hash: HASH,
    stable_custom_id: z.string().regex(/^ctx_[0-9a-f]{64}$/),
    provider_document_id: SAFE_REFERENCE,
    status: z.literal("indexed"),
  })
  .strict()

const canonicalRowSchema = z
  .object({
    id: UUID,
    source_id: UUID,
    record_type: SAFE_KEY,
    external_id: SAFE_REFERENCE,
    pulled_at: z.string().datetime({ offset: true }),
  })
  .strict()

const sourceRowSchema = z
  .object({
    id: UUID,
    source_key: SAFE_KEY,
  })
  .strict()

const policyRowSchema = z
  .object({
    source_key: SAFE_KEY,
    record_type: SAFE_KEY,
    policy_version: z.number().int().positive(),
    indexing_enabled: z.boolean(),
    retention_days: z.number().int().positive(),
  })
  .strict()

export type ContextRetrievalCandidate = Readonly<{
  canonicalRecordId: string
  sourceId: string
  sourceKey: string
  recordType: string
  externalId: string | null
  entityValues: readonly string[]
}>

export type EligibleContextRecord = Readonly<{
  canonicalRecordId: string
  sourceId: string
  sourceKey: string
  recordType: string
  observedAt: string
  canonicalVersion: string
  policyVersion: number
  policyHash: string
  contentHash: string
  stableCustomId: string
  providerDocumentId: string
  retentionExpiresAt: string
}>

export interface ContextRetrievalRepository {
  readSettings(companyId: string): Promise<z.infer<typeof storedSettingsSchema>>
  loadEligibleRecords(input: {
    companyId: string
    candidates: readonly ContextRetrievalCandidate[]
  }): Promise<EligibleContextRecord[]>
}

export class SupabaseContextRetrievalRepository implements ContextRetrievalRepository {
  constructor(private readonly supabase: WorkflowSupabaseClient) {}

  async readSettings(companyId: string) {
    const parsedCompanyId = UUID.parse(companyId)
    const { data, error } = await this.supabase
      .from("context_workspace_settings")
      .select("company_id, provider, readiness")
      .eq("company_id", parsedCompanyId)
      .maybeSingle()
    if (error || !data)
      throw new ContextRetrievalServiceError("settings_unavailable")
    return storedSettingsSchema.parse(data)
  }

  async loadEligibleRecords(input: {
    companyId: string
    candidates: readonly ContextRetrievalCandidate[]
  }): Promise<EligibleContextRecord[]> {
    const companyId = UUID.parse(input.companyId)
    const candidateById = new Map(
      input.candidates.map((candidate) => [
        candidate.canonicalRecordId,
        candidate,
      ])
    )
    const canonicalIds = [...candidateById.keys()]
    if (canonicalIds.length === 0) return []
    const entityValues = unique(
      input.candidates.flatMap((candidate) => candidate.entityValues)
    ).slice(0, 100)

    const { data: directRecordData, error: directRecordError } =
      await this.supabase
        .from("external_records")
        .select("id, source_id, record_type, external_id, pulled_at")
        .eq("company_id", companyId)
        .in("id", canonicalIds)
        .limit(100)
    let relatedRecordData: unknown[] = []
    if (entityValues.length > 0) {
      const { data, error } = await this.supabase
        .from("external_records")
        .select("id, source_id, record_type, external_id, pulled_at")
        .eq("company_id", companyId)
        .in("external_id", entityValues)
        .limit(100)
      if (error) throw new ContextRetrievalServiceError("ledger_unavailable")
      relatedRecordData = data ?? []
    }
    if (directRecordError) {
      throw new ContextRetrievalServiceError("ledger_unavailable")
    }
    const canonicalRows = uniqueBy(
      z
        .array(canonicalRowSchema)
        .parse([...(directRecordData ?? []), ...relatedRecordData]),
      (row) => row.id
    )
    const eligibleCanonicalIds = canonicalRows.map((row) => row.id)
    if (eligibleCanonicalIds.length === 0) return []
    const sourceIds = unique(canonicalRows.map((row) => row.source_id))

    const [
      { data: ledgerData, error: ledgerError },
      { data: sourceData, error: sourceError },
    ] = await Promise.all([
      this.supabase
        .from("context_index_ledger")
        .select(
          "canonical_record_id, source_key, record_type, canonical_version, policy_version, policy_hash, content_hash, stable_custom_id, provider_document_id, status"
        )
        .eq("company_id", companyId)
        .eq("provider", "supermemory")
        .eq("status", "indexed")
        .in("canonical_record_id", eligibleCanonicalIds)
        .not("provider_document_id", "is", null),
      this.supabase
        .from("external_sources")
        .select("id, source_key")
        .eq("company_id", companyId)
        .in("id", sourceIds),
    ])
    if (ledgerError || sourceError) {
      throw new ContextRetrievalServiceError("ledger_unavailable")
    }

    const ledgerRows = z.array(ledgerRowSchema).parse(ledgerData ?? [])
    const sourceRows = z.array(sourceRowSchema).parse(sourceData ?? [])
    const sourceKeys = unique(ledgerRows.map((row) => row.source_key))
    const recordTypes = unique(ledgerRows.map((row) => row.record_type))
    if (sourceKeys.length === 0 || recordTypes.length === 0) return []

    const { data: policyData, error: policyError } = await this.supabase
      .from("context_indexing_policy_versions")
      .select(
        "source_key, record_type, policy_version, indexing_enabled, retention_days"
      )
      .eq("company_id", companyId)
      .in("source_key", sourceKeys)
      .in("record_type", recordTypes)
      .order("policy_version", { ascending: false })
    if (policyError)
      throw new ContextRetrievalServiceError("policy_unavailable")
    const policyRows = z.array(policyRowSchema).parse(policyData ?? [])
    const activePolicyByScope = new Map<
      string,
      z.infer<typeof policyRowSchema>
    >()
    for (const policy of policyRows) {
      const scope = `${policy.source_key}\u0000${policy.record_type}`
      if (!activePolicyByScope.has(scope))
        activePolicyByScope.set(scope, policy)
    }
    const canonicalById = new Map(canonicalRows.map((row) => [row.id, row]))
    const sourceById = new Map(sourceRows.map((row) => [row.id, row]))
    const relatedEntityValues = new Set(entityValues)

    return ledgerRows.flatMap((ledger): EligibleContextRecord[] => {
      const candidate = candidateById.get(ledger.canonical_record_id)
      const canonical = canonicalById.get(ledger.canonical_record_id)
      const source = canonical ? sourceById.get(canonical.source_id) : undefined
      const activePolicy = activePolicyByScope.get(
        `${ledger.source_key}\u0000${ledger.record_type}`
      )
      const entityRelated =
        canonical !== undefined &&
        relatedEntityValues.has(canonical.external_id)
      if (
        (!candidate && !entityRelated) ||
        !canonical ||
        !source ||
        !activePolicy?.indexing_enabled ||
        activePolicy.policy_version !== ledger.policy_version ||
        source.source_key !== ledger.source_key ||
        (candidate !== undefined &&
          (candidate.sourceId !== canonical.source_id ||
            candidate.sourceKey !== ledger.source_key ||
            candidate.recordType !== ledger.record_type)) ||
        canonical.record_type !== ledger.record_type
      ) {
        return []
      }
      return [
        {
          canonicalRecordId: ledger.canonical_record_id,
          sourceId: canonical.source_id,
          sourceKey: ledger.source_key,
          recordType: ledger.record_type,
          observedAt: canonical.pulled_at,
          canonicalVersion: ledger.canonical_version,
          policyVersion: ledger.policy_version,
          policyHash: ledger.policy_hash,
          contentHash: ledger.content_hash,
          stableCustomId: ledger.stable_custom_id,
          providerDocumentId: ledger.provider_document_id,
          retentionExpiresAt: new Date(
            Date.parse(canonical.pulled_at) +
              activePolicy.retention_days * 86_400_000
          ).toISOString(),
        },
      ]
    })
  }
}

export class ContextRetrievalServiceError extends Error {
  constructor(readonly code: string) {
    super(code)
    this.name = "ContextRetrievalServiceError"
  }
}

export class ServerContextRetriever implements RuntimeContextRetriever {
  constructor(
    private readonly repository: ContextRetrievalRepository,
    private readonly provider: ContextRetrievalProvider | null,
    private readonly enabled: boolean,
    private readonly now: () => Date = () => new Date()
  ) {}

  async retrieve(
    input: RuntimeContextRetrievalInput
  ): Promise<ContextRetrievalResult> {
    const companyId = UUID.parse(input.run.companyId)
    const scope = { companyId, workspaceScopeId: companyId }
    const query = buildQuery(input)
    const queryHash = sha256(query)
    const candidates = extractCandidates(input)
    const candidateFilterHash = sha256(stableStringify(candidates))

    let settings: z.infer<typeof storedSettingsSchema>
    try {
      settings = await this.repository.readSettings(companyId)
    } catch (error) {
      console.error(
        "Context retrieval settings lookup failed.",
        safeRetrievalErrorCode(error)
      )
      return fallbackResult({
        provider: "supermemory",
        status: "unavailable",
        fallbackReason: "provider_unavailable",
        scope,
        queryHash,
        filterHash: candidateFilterHash,
      })
    }
    if (settings.company_id !== companyId) {
      return fallbackResult({
        provider: "supermemory",
        status: "failed",
        fallbackReason: "policy_rejected",
        scope,
        queryHash,
        filterHash: candidateFilterHash,
      })
    }
    if (settings.provider === "off") {
      return fallbackResult({
        provider: "off",
        status: "disabled",
        fallbackReason: "context_off",
        scope,
        queryHash,
        filterHash: candidateFilterHash,
      })
    }
    if (candidates.length === 0) {
      return fallbackResult({
        provider: "supermemory",
        status: "failed",
        fallbackReason: "policy_rejected",
        scope,
        queryHash,
        filterHash: candidateFilterHash,
      })
    }

    let eligible: EligibleContextRecord[]
    try {
      eligible = await this.repository.loadEligibleRecords({
        companyId,
        candidates,
      })
    } catch (error) {
      console.error(
        "Context retrieval eligibility lookup failed.",
        safeRetrievalErrorCode(error)
      )
      return fallbackResult({
        provider: "supermemory",
        status: "unavailable",
        fallbackReason: "provider_unavailable",
        scope,
        queryHash,
        filterHash: candidateFilterHash,
      })
    }
    eligible = eligible.filter(
      (record) => Date.parse(record.retentionExpiresAt) > this.now().getTime()
    )
    const policyVersions = unique(
      eligible.map((record) => record.policyVersion)
    )
    const localSnapshot = snapshotMarker(eligible)
    if (eligible.length === 0 || policyVersions.length !== 1) {
      return fallbackResult({
        provider: "supermemory",
        status: "failed",
        fallbackReason: "policy_rejected",
        scope,
        queryHash,
        filterHash: candidateFilterHash,
        indexSnapshotMarker: localSnapshot,
      })
    }
    const filters = {
      sourceKeys: unique(eligible.map((record) => record.sourceKey)),
      recordTypes: unique(eligible.map((record) => record.recordType)),
      canonicalRecordIds: unique(
        eligible.map((record) => record.canonicalRecordId)
      ),
    }
    const filterHash = sha256(stableStringify(filters))
    const request = contextRetrievalRequestSchema.parse({
      requestId: randomUUID(),
      provider: "supermemory",
      scope,
      query,
      queryHash,
      filterHash,
      policyVersion: policyVersions[0],
      filters,
      bounds: contextRetrievalBoundsSchema.parse({}),
    })
    if (!this.enabled || settings.readiness !== "ready" || !this.provider) {
      return fallbackResult({
        provider: "supermemory",
        status: "unavailable",
        fallbackReason: "provider_unavailable",
        scope,
        queryHash,
        filterHash,
        policyVersion: request.policyVersion,
        bounds: request.bounds,
        requestId: request.requestId,
        indexSnapshotMarker: localSnapshot,
      })
    }

    const providerResult = await this.provider.retrieve(request)
    return revalidateProviderResult(providerResult, eligible, localSnapshot)
  }
}

export function createServerContextRetriever(input: {
  supabase: WorkflowSupabaseClient
  enabled?: boolean
  provider?: ContextRetrievalProvider | null
  now?: () => Date
}): RuntimeContextRetriever {
  const enabled =
    input.enabled ?? process.env.CONTEXT_RETRIEVAL_ENABLED === "true"
  const provider =
    input.provider !== undefined
      ? input.provider
      : enabled && process.env.SUPERMEMORY_API_KEY
        ? createSupermemoryRetrievalProviderFromEnvironment()
        : null
  return new ServerContextRetriever(
    new SupabaseContextRetrievalRepository(input.supabase),
    provider,
    enabled,
    input.now
  )
}

export function createDisabledContextRetriever(): RuntimeContextRetriever {
  return {
    retrieve: async (input) => {
      const companyId = UUID.parse(input.run.companyId)
      const query = buildQuery(input)
      return fallbackResult({
        provider: "off",
        status: "disabled",
        fallbackReason: "context_off",
        scope: { companyId, workspaceScopeId: companyId },
        queryHash: sha256(query),
        filterHash: sha256(stableStringify(extractCandidates(input))),
      })
    },
  }
}

function extractCandidates(
  input: RuntimeContextRetrievalInput
): ContextRetrievalCandidate[] {
  const candidates = new Map<string, ContextRetrievalCandidate>()
  for (const sourceRef of input.canonical.sourceRefs) {
    const reference = sourceRef.reference
    const parsed = z
      .object({
        canonicalRecordId: UUID,
        sourceId: UUID,
        sourceKey: SAFE_KEY,
        recordType: SAFE_KEY,
        externalId: SAFE_REFERENCE.optional(),
        entityValues: z
          .array(z.union([z.string(), z.number()]))
          .max(100)
          .optional(),
      })
      .passthrough()
      .safeParse(reference)
    if (!parsed.success) continue
    candidates.set(parsed.data.canonicalRecordId, {
      canonicalRecordId: parsed.data.canonicalRecordId,
      sourceId: parsed.data.sourceId,
      sourceKey: parsed.data.sourceKey,
      recordType: parsed.data.recordType,
      externalId: parsed.data.externalId ?? null,
      entityValues: unique(parsed.data.entityValues?.map(String) ?? []),
    })
    if (candidates.size >= 100) break
  }
  return [...candidates.values()].sort((left, right) =>
    left.canonicalRecordId.localeCompare(right.canonicalRecordId)
  )
}

function uniqueBy<T>(values: readonly T[], keyFor: (value: T) => string): T[] {
  const seen = new Set<string>()
  return values.filter((value) => {
    const key = keyFor(value)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function safeRetrievalErrorCode(error: unknown): string {
  return error instanceof ContextRetrievalServiceError
    ? error.code
    : error instanceof z.ZodError
      ? "invalid_repository_response"
      : "unknown_retrieval_error"
}

function buildQuery(input: RuntimeContextRetrievalInput): string {
  const candidates = extractCandidates(input)
  return [
    input.workflow.identityId,
    input.workflow.workflowType,
    input.workflow.sourceDigest,
    input.run.manifestDigest,
    ...candidates.flatMap((candidate) => [
      candidate.sourceKey,
      candidate.recordType,
      candidate.canonicalRecordId,
    ]),
  ]
    .join(" ")
    .slice(0, 2_000)
}

function revalidateProviderResult(
  result: ContextRetrievalResult,
  eligible: readonly EligibleContextRecord[],
  indexSnapshotMarker: string | null
): ContextRetrievalResult {
  const parsed = contextRetrievalResultSchema.parse(result)
  if (parsed.items.length === 0) {
    return contextRetrievalResultSchema.parse({
      ...parsed,
      provenance: { ...parsed.provenance, indexSnapshotMarker },
    })
  }
  const eligibleById = new Map(
    eligible.map((record) => [record.canonicalRecordId, record])
  )
  let rejected = false
  let characterCount = 0
  let tokenEstimate = 0
  const items = parsed.items.flatMap((item) => {
    const expected = eligibleById.get(item.citation.canonicalRecordId)
    if (
      !expected ||
      item.citation.providerReference.length === 0 ||
      (item.citation.providerDocumentId !== null &&
        item.citation.providerDocumentId !== expected.providerDocumentId) ||
      item.citation.stableCustomId !== expected.stableCustomId ||
      item.citation.canonicalRecordVersion !== expected.canonicalVersion ||
      item.citation.sourceId !== expected.sourceId ||
      item.citation.sourceKey !== expected.sourceKey ||
      item.citation.recordType !== expected.recordType ||
      item.citation.contentHash !== expected.contentHash ||
      item.citation.policyHash !== expected.policyHash ||
      item.citation.sourceObservedAt !== expected.observedAt
    ) {
      rejected = true
      return []
    }
    characterCount += item.excerpt.length
    tokenEstimate += Math.ceil(item.excerpt.length / 4)
    return [
      {
        ...item,
        citation: {
          ...item.citation,
          providerDocumentId: expected.providerDocumentId,
          rank: 0,
        },
      },
    ]
  })
  const ranked = items.map((item, index) => ({
    ...item,
    citation: { ...item.citation, rank: index + 1 },
  }))
  const status =
    ranked.length === 0
      ? "empty"
      : rejected || parsed.provenance.status === "partial"
        ? "partial"
        : parsed.provenance.status
  return contextRetrievalResultSchema.parse({
    provenance: {
      ...parsed.provenance,
      status,
      resultCount: ranked.length,
      characterCount,
      tokenEstimate,
      fallbackReason: rejected
        ? "policy_rejected"
        : parsed.provenance.fallbackReason,
      indexSnapshotMarker,
      citations: ranked.map((item) => item.citation),
    },
    items: ranked,
  })
}

function fallbackResult(input: {
  provider: "off" | "supermemory"
  status: "disabled" | "unavailable" | "failed"
  fallbackReason: "context_off" | "provider_unavailable" | "policy_rejected"
  scope: { companyId: string; workspaceScopeId: string }
  queryHash: string
  filterHash: string
  policyVersion?: number
  bounds?: z.output<typeof contextRetrievalBoundsSchema>
  requestId?: string
  indexSnapshotMarker?: string | null
}): ContextRetrievalResult {
  return contextRetrievalResultSchema.parse({
    provenance: {
      provider: input.provider,
      status: input.status,
      requestId: input.requestId ?? randomUUID(),
      scope: input.scope,
      queryHash: input.queryHash,
      filterHash: input.filterHash,
      policyVersion: input.policyVersion ?? 1,
      bounds: input.bounds ?? contextRetrievalBoundsSchema.parse({}),
      resultCount: 0,
      characterCount: 0,
      tokenEstimate: 0,
      latencyMs: 0,
      fallbackReason: input.fallbackReason,
      indexSnapshotMarker: input.indexSnapshotMarker ?? null,
      citations: [],
    },
    items: [],
  })
}

function snapshotMarker(
  records: readonly EligibleContextRecord[]
): string | null {
  if (records.length === 0) return null
  return `idx_${sha256(
    records
      .map(
        (record) =>
          `${record.canonicalRecordId}:${record.providerDocumentId}:${record.contentHash}:${record.policyVersion}`
      )
      .sort()
      .join("|")
  )}`
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableStringify(child)}`)
      .join(",")}}`
  }
  return JSON.stringify(value)
}

function unique<Value>(values: readonly Value[]): Value[] {
  return [...new Set(values)]
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex")
}
