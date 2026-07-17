import { z } from "zod"
import {
  workspaceCapabilityMappingSpecSchema,
  type WorkspaceCapabilityMappingSpec,
} from "@workspace/control-plane"
import type { WorkflowSupabaseClient } from "../workflows"
import {
  WorkspaceDataProviderError,
  type WorkspaceDataStore,
  type WorkspaceExternalRecord,
  type WorkspaceMappingBinding,
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
              "dataset_alias, source_key, record_type, expected_schema_hash, maximum_freshness_hours, required"
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
      if (!dataset.source_key && catalogs.length > 1) {
        throw new WorkspaceDataProviderError(
          "mapping_dataset_ambiguous",
          `Dataset ${dataset.dataset_alias} now matches more than one imported source.`
        )
      }
      if (dataset.expected_schema_hash === null) {
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
      const current = catalogs.find(
        (catalog) =>
          catalog.profile_status === "ready" &&
          catalog.schema_hash === dataset.expected_schema_hash
      )
      if (!current) {
        throw new WorkspaceDataProviderError(
          "mapping_schema_drift",
          `Dataset ${dataset.dataset_alias} no longer matches its frozen schema.`
        )
      }
      const freshnessAge = current.freshest_observed_at
        ? (this.now().getTime() -
            new Date(current.freshest_observed_at).getTime()) /
          3_600_000
        : Number.POSITIVE_INFINITY
      if (dataset.required && freshnessAge > dataset.maximum_freshness_hours) {
        throw new WorkspaceDataProviderError(
          "mapping_dataset_stale",
          `Dataset ${dataset.dataset_alias} is older than its freshness policy.`
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
      .select("id, source_key, sync_status")
      .eq("company_id", input.companyId)
    if (input.sourceKey)
      sourceQuery = sourceQuery.eq("source_key", input.sourceKey)
    const sources = z
      .array(sourceRowSchema)
      .parse(rowsOrThrow(await sourceQuery))
    if (sources.length === 0) return []
    if (sources.some(({ sync_status }) => sync_status === "error")) {
      throw new WorkspaceDataProviderError(
        "workspace_source_unhealthy",
        "A mapped workspace source is in an error state. Repair its sync before running the skill."
      )
    }
    const sourceById = new Map(
      sources.map((source) => [source.id, source.source_key])
    )
    const rows = z.array(externalRecordSchema).parse(
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
            sources.map(({ id }) => id)
          )
          .order("pulled_at", { ascending: false })
          .limit(input.limit)
      )
    )
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
}
