import type { WorkflowSupabaseClient } from "../workflows"
import type { CompiledAgentManifest, CompilerCapability } from "./compiler"

export type ResolvedCompilerCapability = CompilerCapability & {
  capabilityVersionId: string
  grantId: string | null
  installationId: string
  schemaCompatible: boolean
}

export class AgentCapabilityResolutionError extends Error {
  readonly code = "agent_capabilities_unavailable"

  constructor(readonly capabilityAlias: string) {
    super(`Capability ${capabilityAlias} is not ready.`)
    this.name = "AgentCapabilityResolutionError"
  }
}

/**
 * Projects the company-scoped connector catalog into the compiler's bounded
 * capability input. No connector credentials or unclassified record data are
 * loaded here.
 */
export async function resolveCompanyCompilerCapabilities(input: {
  supabase: WorkflowSupabaseClient
  companyId: string
}): Promise<ResolvedCompilerCapability[]> {
  const [installationResult, grantResult, healthResult, policyResult] =
    await Promise.all([
      input.supabase
        .from("company_connector_installations")
        .select("*")
        .eq("company_id", input.companyId),
      input.supabase
        .from("company_connector_capability_grants")
        .select("*")
        .eq("company_id", input.companyId),
      input.supabase
        .from("company_connector_health")
        .select("*")
        .eq("company_id", input.companyId),
      input.supabase
        .from("company_capability_policies")
        .select("*")
        .eq("company_id", input.companyId),
    ])
  const installations = rowsOrThrow(installationResult)
  const grants = rowsOrThrow(grantResult)
  const health = rowsOrThrow(healthResult)
  const policies = rowsOrThrow(policyResult)
  if (installations.length === 0) return []

  const connectorVersionIds = unique(
    installations.map(({ connector_version_id }) => connector_version_id)
  )
  const [offeringResult, connectorVersionResult] = await Promise.all([
    input.supabase
      .from("connector_capability_offerings")
      .select("*")
      .in("connector_version_id", connectorVersionIds),
    input.supabase
      .from("connector_definition_versions")
      .select("*")
      .in("id", connectorVersionIds),
  ])
  const offerings = rowsOrThrow(offeringResult)
  const connectorVersions = rowsOrThrow(connectorVersionResult)
  const capabilityVersionIds = unique(
    offerings.map(({ capability_version_id }) => capability_version_id)
  )
  if (capabilityVersionIds.length === 0) return []

  const [versionResult, classificationResult] = await Promise.all([
    input.supabase
      .from("capability_definition_versions")
      .select("*")
      .in("id", capabilityVersionIds),
    input.supabase
      .from("capability_field_classifications")
      .select("*")
      .in("capability_version_id", capabilityVersionIds),
  ])
  const versions = rowsOrThrow(versionResult)
  const classifications = rowsOrThrow(classificationResult)
  const definitionIds = unique(
    versions.map(({ capability_definition_id }) => capability_definition_id)
  )
  const definitionResult = await input.supabase
    .from("capability_definitions")
    .select("*")
    .in("id", definitionIds)
  const definitions = rowsOrThrow(definitionResult)

  const resolved: ResolvedCompilerCapability[] = []
  for (const installation of installations) {
    const connectorVersion = connectorVersions.find(
      ({ id }) => id === installation.connector_version_id
    )
    if (!connectorVersion || connectorVersion.status !== "active") continue
    const installationHealth = health.find(
      ({ installation_id }) => installation_id === installation.id
    )
    for (const offering of offerings.filter(
      ({ connector_version_id }) =>
        connector_version_id === installation.connector_version_id
    )) {
      const version = versions.find(
        ({ id }) => id === offering.capability_version_id
      )
      const definition = definitions.find(
        ({ id }) => id === version?.capability_definition_id
      )
      if (
        !version ||
        !definition ||
        version.status !== "active" ||
        definition.status !== "active"
      )
        continue
      const grant = grants.find(
        (candidate) =>
          candidate.installation_id === installation.id &&
          candidate.capability_version_id === version.id
      )
      const policy = policies.find(
        ({ capability_version_id }) => capability_version_id === version.id
      )
      resolved.push({
        id: definition.capability_key,
        version: version.version,
        access: compilerAccess(definition.effect),
        connectorId: installation.id,
        installationId: installation.id,
        capabilityVersionId: version.id,
        grantId: grant?.status === "active" ? grant.id : null,
        schemaDigest: version.schema_hash,
        schemaCompatible:
          installationHealth?.observed_schema_hash ===
          connectorVersion.schema_hash,
        toolName: offering.provider_operation,
        healthy:
          installation.status === "connected" &&
          installationHealth?.status === "healthy",
        granted: grant?.status === "active" && policy?.enabled === true,
        modelAllowedPaths:
          policy?.allow_model_processing === true
            ? classifications
                .filter(
                  (field) =>
                    field.capability_version_id === version.id &&
                    field.model_allowed
                )
                .map(({ json_pointer }) => jsonPointerToModelPath(json_pointer))
                .sort()
            : [],
        evidenceRoles: parseEvidenceRoles(offering.evidence_roles),
      })
    }
  }
  return resolved.sort((left, right) =>
    `${left.id}:${left.installationId}`.localeCompare(
      `${right.id}:${right.installationId}`
    )
  )
}

export function resolveCompiledManifestGrantBindings(input: {
  manifest: CompiledAgentManifest
  capabilities: readonly ResolvedCompilerCapability[]
}): Array<{ requirementKey: string; grantId: string }> {
  return input.manifest.capabilityBindings.map((binding) => {
    const candidates = input.capabilities.filter(
      (candidate) =>
        candidate.id === binding.id &&
        candidate.version === binding.version &&
        candidate.schemaDigest === binding.schemaDigest &&
        candidate.connectorId === binding.connectorId &&
        candidate.grantId !== null &&
        candidate.granted &&
        candidate.healthy &&
        candidate.schemaCompatible &&
        (!binding.useInPrompt || candidate.modelAllowedPaths?.length)
    )
    if (candidates.length !== 1)
      throw new AgentCapabilityResolutionError(binding.alias)
    return {
      requirementKey: binding.alias,
      grantId: candidates[0]!.grantId!,
    }
  })
}

function rowsOrThrow<T>(result: {
  data: T[] | null
  error: { message: string } | null
}): T[] {
  if (result.error) throw new Error(result.error.message)
  return result.data ?? []
}

function compilerAccess(effect: string): CompilerCapability["access"] {
  if (effect === "write") return "execute"
  if (effect === "propose") return "propose"
  return "read"
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}

function parseEvidenceRoles(
  value: unknown
): NonNullable<CompilerCapability["evidenceRoles"]> {
  if (!Array.isArray(value)) return []
  return value.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate))
      return []
    const role = candidate as Record<string, unknown>
    if (
      typeof role.businessObject !== "string" ||
      !["authoritative", "tracking", "supporting"].includes(
        String(role.role)
      ) ||
      !Array.isArray(role.recordTypes) ||
      !role.recordTypes.every((recordType) => typeof recordType === "string")
    )
      return []
    return [
      {
        businessObject: role.businessObject,
        role: role.role as "authoritative" | "tracking" | "supporting",
        recordTypes: role.recordTypes as string[],
      },
    ]
  })
}

export function jsonPointerToModelPath(pointer: string): string {
  if (pointer === "") return ""
  const output: string[] = []
  for (const rawSegment of pointer.replace(/^\//, "").split("/")) {
    const segment = rawSegment.replaceAll("~1", "/").replaceAll("~0", "~")
    if (segment === "*") {
      const previous = output.pop()
      if (previous) output.push(`${previous}[]`)
      continue
    }
    output.push(segment)
  }
  return output.join(".")
}
