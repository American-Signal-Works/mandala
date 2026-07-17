import { z } from "zod"
import type { AgentSummary } from "@workspace/control-plane"
import type { WorkflowSupabaseClient } from "../workflows"
import {
  createAgentWorkflowBindingSnapshot,
  getAgentSummary,
  installAgentWorkflowVersion,
} from "../skills/lifecycle"
import { resolveCompanyCompilerCapabilities } from "../skills/capabilities"
import {
  compileAgentSkill,
  type CompiledAgentManifest,
} from "../skills/compiler"
import { parseAgentSkillMarkdown } from "../skills/parser"
import { getWorkspaceMappingTemplate } from "./mapping-templates"
import type { WorkspaceCapabilityMappingSpec } from "@workspace/control-plane"
import {
  asWorkspaceDatabase,
  dataOrThrow,
  rowsOrThrow,
  type WorkspaceDatabase,
} from "./database"

const uuid = z.string().uuid()
const connectorInstallResult = z.object({ installationId: uuid }).passthrough()
const mappingPublishResult = z
  .object({
    mappingVersionId: uuid,
    version: z.number().int().positive(),
    status: z.literal("validated"),
    specHash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .passthrough()

export type PreparedWorkspaceMapping = {
  requirementKey: string
  capabilityKey: string
  capabilityVersionId: string
  mappingVersionId: string
  version: number
  status: "validated"
  confidence: number
}

export type PreparedWorkspaceAgent = {
  catalog: {
    datasets: number
    records: number
    freshestObservedAt: string | null
  }
  mappings: PreparedWorkspaceMapping[]
  manifest: CompiledAgentManifest
  agent: AgentSummary
  bindingSnapshotId: string
}

export class WorkspaceSetupError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = "WorkspaceSetupError"
  }
}

export async function prepareWorkspaceAgent(input: {
  supabase: WorkflowSupabaseClient
  companyId: string
  skillMarkdown: string
  confirmMappings: boolean
}): Promise<PreparedWorkspaceAgent> {
  const parsed = parseAgentSkillMarkdown(input.skillMarkdown)
  if (!parsed.ok) {
    throw new WorkspaceSetupError(
      "skill_invalid",
      parsed.diagnostics.map(({ message }) => message).join(" ")
    )
  }
  const readRequirements = parsed.value.skill.capabilities.filter(
    ({ access }) => access === "read"
  )
  const writeRequirements = parsed.value.skill.capabilities.filter(
    ({ access }) => access !== "read"
  )
  const specs = readRequirements.map((requirement) => {
    const spec = getWorkspaceMappingTemplate({
      capabilityKey: requirement.id,
      capabilityVersion: requirement.version,
    })
    if (!spec) {
      throw new WorkspaceSetupError(
        "mapping_template_missing",
        `No declarative workspace mapping is registered for ${requirement.id} v${requirement.version}.`
      )
    }
    return { requirement, spec }
  })
  if (!input.confirmMappings) {
    throw new WorkspaceSetupError(
      "mapping_confirmation_required",
      "The proposed mappings contain explicit policy defaults and require confirmation."
    )
  }

  const db = asWorkspaceDatabase(input.supabase)
  dataOrThrow(
    await db.rpc("refresh_workspace_data_catalog_v1", {
      p_company_id: input.companyId,
    })
  )
  const catalogRows = rowsOrThrow(
    await db
      .from<CatalogRow>("workspace_data_catalogs")
      .select(
        "source_key, record_type, record_count, freshest_observed_at, profile_status"
      )
      .eq("company_id", input.companyId)
  ).filter(({ profile_status }) => profile_status !== "detached")
  const resolvedSpecs = specs.map(({ requirement, spec }) => ({
    requirement,
    spec: resolveDatasetSources(spec, catalogRows),
  }))
  const catalog = {
    datasets: catalogRows.length,
    records: catalogRows.reduce(
      (sum, row) => sum + Number(row.record_count),
      0
    ),
    freshestObservedAt:
      catalogRows
        .map(({ freshest_observed_at }) => freshest_observed_at)
        .filter((value): value is string => Boolean(value))
        .sort()
        .map((value) => new Date(value).toISOString())
        .at(-1) ?? null,
  }

  const workspaceConnector = await configureConnector({
    db,
    companyId: input.companyId,
    connectorKey: "mandala.workspace-data",
    displayName: "Workspace Data",
  })
  const mappings: PreparedWorkspaceMapping[] = []
  for (const { requirement, spec } of resolvedSpecs) {
    const capability = await capabilityVersion(
      db,
      requirement.id,
      requirement.version
    )
    await grantCapability({
      db,
      companyId: input.companyId,
      installationId: workspaceConnector.installationId,
      capabilityVersionId: capability.id,
      allowModelProcessing: requirement.use_in_prompt,
      maximumRows: spec.bounds.maximumInputRows,
      maximumBytes: spec.bounds.maximumOutputBytes,
    })
    const published = mappingPublishResult.parse(
      dataOrThrow(
        await db.rpc("publish_workspace_capability_mapping_v1", {
          p_company_id: input.companyId,
          p_mapping_key: `${requirement.id}.${requirement.as}`,
          p_capability_version_id: capability.id,
          p_confidence: 0.9,
          p_spec: spec,
          p_provenance: {
            kind: "platform_template",
            mappingSchema: spec.schemaVersion,
            catalogedAutomatically: true,
          },
          p_confirmed: true,
        })
      )
    )
    mappings.push({
      requirementKey: requirement.as,
      capabilityKey: requirement.id,
      capabilityVersionId: capability.id,
      mappingVersionId: published.mappingVersionId,
      version: published.version,
      status: published.status,
      confidence: 0.9,
    })
  }

  if (writeRequirements.length > 0) {
    const simulationConnector = await configureConnector({
      db,
      companyId: input.companyId,
      connectorKey: "mandala.synthetic-commerce",
      displayName: "Sandbox Simulation Boundary",
    })
    for (const requirement of writeRequirements) {
      const capability = await capabilityVersion(
        db,
        requirement.id,
        requirement.version
      )
      await assertConnectorOffers(
        db,
        simulationConnector.connectorVersionId,
        capability.id
      )
      await grantCapability({
        db,
        companyId: input.companyId,
        installationId: simulationConnector.installationId,
        capabilityVersionId: capability.id,
        allowModelProcessing: false,
        maximumRows: 100,
        maximumBytes: 262_144,
      })
    }
  }

  const capabilities = await resolveCompanyCompilerCapabilities({
    supabase: input.supabase,
    companyId: input.companyId,
  })
  const compiled = compileAgentSkill({
    source: input.skillMarkdown,
    capabilities,
  })
  if (!compiled.ok) {
    throw new WorkspaceSetupError(
      "skill_compile_failed",
      compiled.diagnostics.map(({ message }) => message).join(" ")
    )
  }
  const agent = await installOrReuseAgent({
    supabase: input.supabase,
    db,
    companyId: input.companyId,
    skillMarkdown: input.skillMarkdown,
    manifest: compiled.manifest,
    diagnostics: compiled.diagnostics,
  })
  if (agent.active) {
    throw new WorkspaceSetupError(
      "sandbox_agent_must_be_inactive",
      "Sandbox setup refuses to use an active agent."
    )
  }
  const bindingSnapshotId = await createAgentWorkflowBindingSnapshot({
    supabase: input.supabase,
    companyId: input.companyId,
    agentId: agent.id,
    manifest: compiled.manifest,
  })
  dataOrThrow(
    await db.rpc("bind_workspace_mappings_v1", {
      p_company_id: input.companyId,
      p_binding_snapshot_id: bindingSnapshotId,
      p_mappings: mappings.map((mapping) => ({
        requirementKey: mapping.requirementKey,
        mappingVersionId: mapping.mappingVersionId,
      })),
    })
  )
  return {
    catalog,
    mappings,
    manifest: compiled.manifest,
    agent,
    bindingSnapshotId,
  }
}

async function configureConnector(input: {
  db: WorkspaceDatabase
  companyId: string
  connectorKey: string
  displayName: string
}) {
  const definition = dataOrThrow(
    await input.db
      .from<{ id: string }>("connector_definitions")
      .select("id")
      .eq("connector_key", input.connectorKey)
      .eq("status", "active")
      .single()
  )
  const version = dataOrThrow(
    await input.db
      .from<{
        id: string
        schema_hash: string
      }>("connector_definition_versions")
      .select("id, schema_hash")
      .eq("connector_definition_id", definition.id)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(1)
      .single()
  )
  const existing = await input.db
    .from<{
      id: string
      connector_version_id: string
      status: string
    }>("company_connector_installations")
    .select("id, connector_version_id, status")
    .eq("company_id", input.companyId)
    .eq("connector_definition_id", definition.id)
    .maybeSingle()
  if (existing.error) throw new Error(existing.error.message)
  if (existing.data) {
    if (
      existing.data.connector_version_id !== version.id ||
      existing.data.status !== "connected"
    ) {
      throw new WorkspaceSetupError(
        "connector_not_ready",
        `${input.displayName} is disconnected or requires an explicit version review.`
      )
    }
    const health = await input.db
      .from<{
        status: string
        observed_schema_hash: string | null
      }>("company_connector_health")
      .select("status, observed_schema_hash")
      .eq("company_id", input.companyId)
      .eq("installation_id", existing.data.id)
      .maybeSingle()
    if (health.error) throw new Error(health.error.message)
    if (
      health.data?.status !== "healthy" ||
      health.data.observed_schema_hash !== version.schema_hash
    ) {
      throw new WorkspaceSetupError(
        "connector_unhealthy",
        `${input.displayName} is not healthy. Repair it before running the skill.`
      )
    }
    return {
      installationId: existing.data.id,
      connectorVersionId: version.id,
    }
  }
  const installation = connectorInstallResult.parse(
    dataOrThrow(
      await input.db.rpc("configure_company_connector_installation", {
        p_company_id: input.companyId,
        p_connector_version_id: version.id,
        p_display_name: input.displayName,
      })
    )
  )
  dataOrThrow(
    await input.db.rpc("set_company_connector_health", {
      p_company_id: input.companyId,
      p_installation_id: installation.installationId,
      p_status: "healthy",
      p_observed_schema_hash: version.schema_hash,
      p_details: { providerStatus: "ready", schemaVersion: "1.0.0" },
    })
  )
  return {
    installationId: installation.installationId,
    connectorVersionId: version.id,
  }
}

async function capabilityVersion(
  db: WorkspaceDatabase,
  capabilityKey: string,
  version: string
) {
  const definition = dataOrThrow(
    await db
      .from<{ id: string; effect: string }>("capability_definitions")
      .select("id, effect")
      .eq("capability_key", capabilityKey)
      .eq("status", "active")
      .single()
  )
  return dataOrThrow(
    await db
      .from<{
        id: string
        schema_hash: string
      }>("capability_definition_versions")
      .select("id, schema_hash")
      .eq("capability_definition_id", definition.id)
      .eq("version", version)
      .eq("status", "active")
      .single()
  )
}

async function assertConnectorOffers(
  db: WorkspaceDatabase,
  connectorVersionId: string,
  capabilityVersionId: string
) {
  const result = await db
    .from<{ provider_operation: string }>("connector_capability_offerings")
    .select("provider_operation")
    .eq("connector_version_id", connectorVersionId)
    .eq("capability_version_id", capabilityVersionId)
    .maybeSingle()
  if (result.error || !result.data) {
    throw new WorkspaceSetupError(
      "simulation_capability_unavailable",
      "The Sandbox simulation boundary does not offer a required action capability."
    )
  }
}

async function grantCapability(input: {
  db: WorkspaceDatabase
  companyId: string
  installationId: string
  capabilityVersionId: string
  allowModelProcessing: boolean
  maximumRows: number
  maximumBytes: number
}) {
  const [grant, policy] = await Promise.all([
    input.db
      .from<{ status: string }>("company_connector_capability_grants")
      .select("status")
      .eq("company_id", input.companyId)
      .eq("installation_id", input.installationId)
      .eq("capability_version_id", input.capabilityVersionId)
      .maybeSingle(),
    input.db
      .from<{
        enabled: boolean
        allow_model_processing: boolean
        require_human_approval: boolean
        max_rows: number
        max_bytes: number
      }>("company_capability_policies")
      .select(
        "enabled, allow_model_processing, require_human_approval, max_rows, max_bytes"
      )
      .eq("company_id", input.companyId)
      .eq("capability_version_id", input.capabilityVersionId)
      .maybeSingle(),
  ])
  if (grant.error) throw new Error(grant.error.message)
  if (policy.error) throw new Error(policy.error.message)
  if (grant.data?.status === "revoked") {
    throw new WorkspaceSetupError(
      "capability_revoked",
      "A required connector capability was revoked. Restore it explicitly before running the skill."
    )
  }
  if (!grant.data) {
    dataOrThrow(
      await input.db.rpc("set_company_connector_capability_grant", {
        p_company_id: input.companyId,
        p_installation_id: input.installationId,
        p_capability_version_id: input.capabilityVersionId,
        p_status: "active",
      })
    )
  }
  if (policy.data) {
    if (!policy.data.enabled) {
      throw new WorkspaceSetupError(
        "capability_disabled",
        "A required capability policy is disabled. Re-enable it explicitly before running the skill."
      )
    }
    if (input.allowModelProcessing && !policy.data.allow_model_processing) {
      throw new WorkspaceSetupError(
        "capability_model_egress_blocked",
        "A required capability is not approved for model processing."
      )
    }
    if (
      !policy.data.require_human_approval ||
      policy.data.max_rows < input.maximumRows ||
      policy.data.max_bytes < input.maximumBytes
    ) {
      throw new WorkspaceSetupError(
        "capability_policy_too_narrow",
        "A required capability policy does not cover the confirmed mapping bounds."
      )
    }
    return
  }
  dataOrThrow(
    await input.db.rpc("set_company_capability_policy", {
      p_company_id: input.companyId,
      p_capability_version_id: input.capabilityVersionId,
      p_enabled: true,
      p_minimum_role: "member",
      p_allow_model_processing: input.allowModelProcessing,
      p_require_human_approval: true,
      p_max_rows: input.maximumRows,
      p_max_bytes: input.maximumBytes,
    })
  )
}

async function installOrReuseAgent(input: {
  supabase: WorkflowSupabaseClient
  db: WorkspaceDatabase
  companyId: string
  skillMarkdown: string
  manifest: CompiledAgentManifest
  diagnostics: unknown[]
}): Promise<AgentSummary> {
  const existing = await input.db
    .from<{
      id: string
      compiled_manifest_hash: string | null
      spec: { capabilityBindings?: unknown; manifestDigest?: unknown }
    }>("agent_workflows")
    .select("id, compiled_manifest_hash, spec")
    .eq("company_id", input.companyId)
    .eq("workflow_key", input.manifest.identity.id)
    .eq("version", input.manifest.identity.version)
    .maybeSingle()
  if (existing.error) throw new Error(existing.error.message)
  if (existing.data) {
    if (existing.data.spec.manifestDigest !== input.manifest.manifestDigest) {
      throw new WorkspaceSetupError(
        "agent_version_conflict",
        "The installed agent version has different compiled content. Publish a new skill version before changing its frozen manifest."
      )
    }
    return getAgentSummary({
      supabase: input.supabase,
      companyId: input.companyId,
      agentId: existing.data.id,
    })
  }
  return installAgentWorkflowVersion({
    supabase: input.supabase,
    companyId: input.companyId,
    source: input.skillMarkdown,
    manifest: input.manifest,
    diagnostics: input.diagnostics,
  })
}

type CatalogRow = {
  source_key: string
  record_type: string
  record_count: number | string
  freshest_observed_at: string | null
  profile_status: string
}

function resolveDatasetSources(
  spec: WorkspaceCapabilityMappingSpec,
  catalogs: readonly CatalogRow[]
): WorkspaceCapabilityMappingSpec {
  return {
    ...spec,
    datasets: spec.datasets.map((dataset) => {
      const matches = catalogs.filter(
        (catalog) =>
          catalog.record_type === dataset.recordType &&
          (!dataset.sourceKey || catalog.source_key === dataset.sourceKey)
      )
      if (matches.length === 0) {
        if (dataset.required) {
          throw new WorkspaceSetupError(
            "mapping_dataset_not_cataloged",
            `Required dataset ${dataset.alias} is not available in the workspace catalog.`
          )
        }
        return dataset
      }
      if (matches.length > 1) {
        throw new WorkspaceSetupError(
          "mapping_dataset_ambiguous",
          `Dataset ${dataset.alias} matches more than one imported source. Choose a source explicitly before binding it.`
        )
      }
      return { ...dataset, sourceKey: matches[0]!.source_key }
    }),
  }
}
