import { z } from "zod"
import {
  workspaceCapabilityMappingSpecSchema,
  type WorkspaceCapabilityMappingSpec,
} from "@workspace/control-plane"
import type { WorkflowSupabaseClient } from "../workflows"
import { connectorAccessSchema } from "../connectors"
import {
  WorkspaceDataProviderError,
  type WorkspaceDataStore,
  type WorkspaceExternalRecord,
  type WorkspaceMappingBinding,
  type WorkspaceSourceCoverage,
} from "./provider"
import { asWorkspaceDatabase, dataOrThrow, rowsOrThrow } from "./database"

const bindingRowSchema = z
  .object({
    mapping_version_id: z.string().uuid(),
    mapping_spec_hash: z.string().regex(/^[a-f0-9]{64}$/),
    catalog_digest: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .passthrough()
const mappingRowSchema = z
  .object({
    id: z.string().uuid(),
    mapping_key: z.string(),
    status: z.literal("validated"),
    spec_hash: z.string().regex(/^[a-f0-9]{64}$/),
    spec: workspaceCapabilityMappingSpecSchema,
  })
  .passthrough()
const datasetRowSchema = z
  .object({
    dataset_alias: z.string(),
    source_key: z.string().nullable(),
    record_type: z.string(),
    expected_schema_hash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
    expected_schema_hashes: z.array(z.string().regex(/^[a-f0-9]{64}$/)),
    maximum_freshness_hours: z.number().int().positive(),
    required: z.boolean(),
  })
  .passthrough()
const catalogRowSchema = z
  .object({
    source_key: z.string(),
    record_type: z.string(),
    schema_hash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
    profile_status: z.enum(["pending", "ready", "drifted", "detached"]),
    freshest_observed_at: z.string().datetime({ offset: true }).nullable(),
  })
  .passthrough()
const sourceRowSchema = z
  .object({
    id: z.string().uuid(),
    source_key: z.string(),
    sync_status: z.enum(["idle", "syncing", "error"]),
    config: z.record(z.string(), z.unknown()),
    last_synced_at: z.string().datetime({ offset: true }).nullable(),
    last_sync_error: z.string().nullable(),
  })
  .passthrough()
const externalRecordSchema = z
  .object({
    id: z.string().uuid(),
    company_id: z.string().uuid(),
    source_id: z.string().uuid(),
    record_type: z.string(),
    external_id: z.string(),
    payload: z.record(z.string(), z.unknown()),
    pulled_at: z.string().datetime({ offset: true }),
  })
  .passthrough()

export class SupabaseWorkspaceDataStore implements WorkspaceDataStore {
  private readonly db

  constructor(
    supabase: WorkflowSupabaseClient,
    private readonly bindingSnapshotId: string,
    private readonly now: () => Date = () => new Date()
  ) {
    this.db = asWorkspaceDatabase(supabase)
  }

  async resolveMapping(input: {
    companyId: string
    requirementKey: string
    capabilityKey: string
    capabilityVersion: string
  }): Promise<WorkspaceMappingBinding> {
    const binding = bindingRowSchema.parse(
      dataOrThrow(
        await this.db
          .from("workflow_workspace_mapping_bindings")
          .select("mapping_version_id, mapping_spec_hash, catalog_digest")
          .eq("company_id", input.companyId)
          .eq("binding_snapshot_id", this.bindingSnapshotId)
          .eq("requirement_key", input.requirementKey)
          .single()
      )
    )
    const mapping = mappingRowSchema.parse(
      dataOrThrow(
        await this.db
          .from("workspace_capability_mapping_versions")
          .select("id, mapping_key, status, spec_hash, spec")
          .eq("company_id", input.companyId)
          .eq("id", binding.mapping_version_id)
          .single()
      )
    )
    if (
      mapping.spec_hash !== binding.mapping_spec_hash ||
      mapping.spec.capabilityKey !== input.capabilityKey ||
      mapping.spec.capabilityVersion !== input.capabilityVersion
    ) {
      throw new WorkspaceDataProviderError(
        "frozen_mapping_mismatch",
        `The frozen mapping for ${input.requirementKey} no longer matches the compiled binding.`
      )
    }
    const datasets = z
      .array(datasetRowSchema)
      .parse(
        rowsOrThrow(
          await this.db
            .from("workspace_capability_mapping_datasets")
            .select(
              "dataset_alias, source_key, record_type, expected_schema_hash, expected_schema_hashes, maximum_freshness_hours, required"
            )
            .eq("company_id", input.companyId)
            .eq("mapping_version_id", mapping.id)
        )
      )
    for (const dataset of datasets) {
      let query = this.db
        .from("workspace_data_catalogs")
        .select(
          "source_key, record_type, schema_hash, profile_status, freshest_observed_at"
        )
        .eq("company_id", input.companyId)
        .eq("record_type", dataset.record_type)
      if (dataset.source_key) query = query.eq("source_key", dataset.source_key)
      const catalogs = z.array(catalogRowSchema).parse(rowsOrThrow(await query))
      if (dataset.expected_schema_hashes.length === 0) {
        if (
          catalogs.some(({ profile_status }) => profile_status !== "detached")
        ) {
          throw new WorkspaceDataProviderError(
            "mapping_optional_dataset_changed",
            `Optional dataset ${dataset.dataset_alias} appeared after the mapping was confirmed.`
          )
        }
        continue
      }
      const current = catalogs.filter(
        (catalog) => catalog.profile_status !== "detached"
      )
      if (
        (dataset.required && current.length === 0) ||
        current.some(
          (catalog) =>
            catalog.profile_status !== "ready" ||
            !dataset.expected_schema_hashes.includes(catalog.schema_hash ?? "")
        )
      ) {
        throw new WorkspaceDataProviderError(
          "mapping_schema_drift",
          `Dataset ${dataset.dataset_alias} no longer matches its frozen schema.`
        )
      }
    }
    return {
      mappingVersionId: mapping.id,
      mappingKey: mapping.mapping_key,
      specHash: mapping.spec_hash,
      catalogDigest: binding.catalog_digest,
      spec: mapping.spec as WorkspaceCapabilityMappingSpec,
    }
  }

  async loadRecords(input: {
    companyId: string
    sourceKey?: string
    recordType: string
    limit: number
  }): Promise<WorkspaceExternalRecord[]> {
    let sourceQuery = this.db
      .from("external_sources")
      .select(
        "id, source_key, sync_status, config, last_synced_at, last_sync_error"
      )
      .eq("company_id", input.companyId)
    if (input.sourceKey)
      sourceQuery = sourceQuery.eq("source_key", input.sourceKey)
    const sources = z
      .array(sourceRowSchema)
      .parse(rowsOrThrow(await sourceQuery))
    if (sources.length === 0) return []
    const healthySources = sources.filter(
      (source) => source.sync_status === "idle" && hasReadAccess(source.config)
    )
    if (healthySources.length === 0) return []
    const sourceById = new Map(
      healthySources.map((source) => [source.id, source.source_key])
    )
    const rows: z.infer<typeof externalRecordSchema>[] = []
    const pageSize = 1_000
    while (rows.length < input.limit) {
      const remaining = input.limit - rows.length
      const requested = Math.min(pageSize, remaining)
      const page = z.array(externalRecordSchema).parse(
        rowsOrThrow(
          await this.db
            .from("external_records")
            .select(
              "id, company_id, source_id, record_type, external_id, payload, pulled_at"
            )
            .eq("company_id", input.companyId)
            .eq("record_type", input.recordType)
            .in(
              "source_id",
              healthySources.map(({ id }) => id)
            )
            .order("pulled_at", { ascending: false })
            .order("id", { ascending: true })
            .range(rows.length, rows.length + requested - 1)
        )
      )
      rows.push(...page)
      if (page.length < requested) break
    }
    return rows.map((row) => ({
      id: row.id,
      companyId: row.company_id,
      sourceId: row.source_id,
      sourceKey: sourceById.get(row.source_id) ?? "unknown",
      recordType: row.record_type,
      externalId: row.external_id,
      payload: row.payload,
      pulledAt: row.pulled_at,
    }))
  }

  async inspectCoverage(input: {
    companyId: string
    sourceKey?: string
    recordType: string
    businessObject?: string
    evidenceRole?: "authoritative" | "tracking" | "supporting"
    maximumFreshnessHours: number
  }): Promise<WorkspaceSourceCoverage[]> {
    let sourceQuery = this.db
      .from("external_sources")
      .select(
        "id, source_key, sync_status, config, last_synced_at, last_sync_error"
      )
      .eq("company_id", input.companyId)
    if (input.sourceKey)
      sourceQuery = sourceQuery.eq("source_key", input.sourceKey)
    const sources = z
      .array(sourceRowSchema)
      .parse(rowsOrThrow(await sourceQuery))

    let catalogQuery = this.db
      .from("workspace_data_catalogs")
      .select(
        "source_id, source_key, record_type, record_count, schema_hash, profile_status, freshest_observed_at"
      )
      .eq("company_id", input.companyId)
      .eq("record_type", input.recordType)
    if (input.sourceKey)
      catalogQuery = catalogQuery.eq("source_key", input.sourceKey)
    const catalogs = z
      .array(
        catalogRowSchema.extend({
          source_id: z.string().uuid(),
          record_count: z.coerce.number().int().nonnegative(),
        })
      )
      .parse(rowsOrThrow(await catalogQuery))
    const catalogBySource = new Map(
      catalogs.map((catalog) => [catalog.source_id, catalog])
    )
    const relevant = sources.filter(
      (source) =>
        Boolean(input.sourceKey) ||
        catalogBySource.has(source.id) ||
        advertisesEvidenceRole(source.config, input)
    )
    const checkedAt = this.now().toISOString()
    return relevant.map((source) => {
      const catalog = catalogBySource.get(source.id)
      const freshestObservedAt =
        catalog?.freshest_observed_at ?? source.last_synced_at
      const freshnessHours = freshestObservedAt
        ? (this.now().getTime() - new Date(freshestObservedAt).getTime()) /
          3_600_000
        : Number.POSITIVE_INFINITY
      const status: WorkspaceSourceCoverage["status"] =
        !hasReadAccess(source.config) || source.sync_status !== "idle"
          ? "unavailable"
          : catalog?.profile_status === "drifted"
            ? "schema_drift"
            : freshnessHours > input.maximumFreshnessHours
              ? "stale"
              : "checked"
      return {
        sourceId: source.id,
        sourceKey: source.source_key,
        recordType: input.recordType,
        businessObject: input.businessObject,
        evidenceRole: input.evidenceRole,
        status,
        recordCount: catalog?.record_count ?? 0,
        checkedAt,
        freshestObservedAt,
        ...(status === "unavailable"
          ? {
              error: !hasReadAccess(source.config)
                ? "Source is not connected with read permission."
                : (source.last_sync_error ??
                  (source.sync_status === "syncing"
                    ? "Source sync is still running."
                    : "Source sync is unavailable.")),
            }
          : {}),
      }
    })
  }
}

function hasReadAccess(config: Record<string, unknown>): boolean {
  const access = connectorAccessSchema.safeParse(config.access ?? {})
  return (
    access.success &&
    access.data.status === "connected" &&
    access.data.permissions.read
  )
}

function advertisesEvidenceRole(
  config: Record<string, unknown>,
  input: {
    recordType: string
    businessObject?: string
    evidenceRole?: "authoritative" | "tracking" | "supporting"
  }
): boolean {
  if (!input.businessObject || !input.evidenceRole) return false
  const roles = config.businessEvidenceRoles
  if (!Array.isArray(roles)) return false
  return roles.some(
    (role) =>
      isRecord(role) &&
      role.businessObject === input.businessObject &&
      role.role === input.evidenceRole &&
      Array.isArray(role.recordTypes) &&
      role.recordTypes.includes(input.recordType)
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}
