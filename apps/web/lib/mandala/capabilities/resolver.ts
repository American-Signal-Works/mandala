import { randomUUID } from "node:crypto"
import { effectiveCapabilityPermission } from "./permissions"
import {
  capabilityCatalogSchema,
  capabilityResolverDiagnosticSchema,
  connectorInstallationSchema,
  installationCapabilityGrantSchema,
  workflowCapabilityBindingSchema,
  workflowCapabilityRequirementSchema,
  type CapabilityActorRole,
  type CapabilityCatalog,
  type CapabilityOperation,
  type CapabilityResolverDiagnostic,
  type ConnectorDefinition,
  type ConnectorInstallation,
  type InstallationCapabilityGrant,
  type WorkflowCapabilityBinding,
  type WorkflowCapabilityRequirement,
} from "./schema"

export type CapabilityResolutionInput = {
  catalog: CapabilityCatalog
  companyId: string
  workflowDefinitionId: string
  requirements: WorkflowCapabilityRequirement[]
  installations: ConnectorInstallation[]
  grants: InstallationCapabilityGrant[]
  workspaceOperations: CapabilityOperation[]
  actorRole: CapabilityActorRole
  now?: Date
  createId?: () => string
}

export type CapabilityResolutionResult = {
  ok: boolean
  bindings: WorkflowCapabilityBinding[]
  diagnostics: CapabilityResolverDiagnostic[]
}

type Candidate = {
  connector: ConnectorDefinition
  installation: ConnectorInstallation
  grant: InstallationCapabilityGrant | undefined
  operations: CapabilityOperation[]
  schemaDigest: string
  definitionSchemaDigest: string
}

export function resolveWorkflowCapabilities(
  input: CapabilityResolutionInput
): CapabilityResolutionResult {
  const catalog = capabilityCatalogSchema.parse(input.catalog)
  const installations = input.installations.map((value) =>
    connectorInstallationSchema.parse(value)
  )
  const grants = input.grants.map((value) =>
    installationCapabilityGrantSchema.parse(value)
  )
  const requirements = input.requirements.map((value) =>
    workflowCapabilityRequirementSchema.parse(value)
  )
  const now = (input.now ?? new Date()).toISOString()
  const createId = input.createId ?? randomUUID
  const bindings: WorkflowCapabilityBinding[] = []
  const diagnostics: CapabilityResolverDiagnostic[] = []

  for (const requirement of requirements) {
    const definitions = catalog.capabilities.filter(
      (definition) =>
        definition.key === requirement.capabilityKey &&
        definition.version === requirement.capabilityVersion
    )
    const candidates = providerCandidates({
      catalog,
      companyId: input.companyId,
      requirement,
      installations,
      grants,
    })

    if (definitions.length === 0 || candidates.length === 0) {
      diagnostics.push(
        diagnostic(
          requirement,
          "capability_missing",
          `No installed connector provides ${requirement.capabilityKey} ${requirement.capabilityVersion}.`
        )
      )
      continue
    }

    const healthy = candidates.filter(
      ({ installation }) =>
        installation.status === "connected" &&
        installation.health.status === "healthy"
    )
    if (healthy.length === 0) {
      diagnostics.push(
        diagnostic(
          requirement,
          "connector_unhealthy",
          `Installed connectors for ${requirement.capabilityKey} are not healthy.`,
          candidates
        )
      )
      continue
    }

    const authorized = healthy.filter((candidate) => {
      if (candidate.grant?.status !== "granted") return false
      return effectiveCapabilityPermission({
        connectorOperations: candidate.operations,
        grantOperations: candidate.grant.operations,
        workspaceOperations: input.workspaceOperations,
        skillOperations: [requirement.operation],
        actorRole: input.actorRole,
      }).allowedOperations.includes(requirement.operation)
    })
    if (authorized.length === 0) {
      diagnostics.push(
        diagnostic(
          requirement,
          "capability_unauthorized",
          `The current connector grant, workspace policy, skill allowance, or actor role does not allow ${requirement.operation}.`,
          healthy
        )
      )
      continue
    }

    const schemaCompatible = authorized.filter((candidate) => {
      const expected = requirement.expectedSchemaDigest
      return (
        (!expected || expected === candidate.schemaDigest) &&
        candidate.definitionSchemaDigest === candidate.schemaDigest &&
        candidate.grant?.schemaDigest === candidate.schemaDigest
      )
    })
    if (schemaCompatible.length === 0) {
      diagnostics.push(
        diagnostic(
          requirement,
          "capability_schema_drift",
          `The installed connector schema for ${requirement.capabilityKey} no longer matches the compiled workflow.`,
          authorized
        )
      )
      continue
    }

    if (schemaCompatible.length > 1) {
      diagnostics.push(
        diagnostic(
          requirement,
          "capability_ambiguous",
          `More than one installed connector can satisfy ${requirement.capabilityKey}; choose one before activation.`,
          schemaCompatible
        )
      )
      continue
    }

    const candidate = schemaCompatible[0]!
    bindings.push(
      workflowCapabilityBindingSchema.parse({
        schemaVersion: "1",
        id: createId(),
        companyId: input.companyId,
        workflowDefinitionId: input.workflowDefinitionId,
        requirementId: requirement.id,
        installationId: candidate.installation.id,
        connectorKey: candidate.connector.key,
        connectorVersion: candidate.connector.version,
        capabilityKey: requirement.capabilityKey,
        capabilityVersion: requirement.capabilityVersion,
        operation: requirement.operation,
        schemaDigest: candidate.schemaDigest,
        resolvedAt: now,
      })
    )
  }

  const boundRequirementIds = new Set(
    bindings.map(({ requirementId }) => requirementId)
  )
  return {
    ok:
      diagnostics.every(({ severity }) => severity !== "error") &&
      requirements
        .filter(({ required }) => required)
        .every(({ id }) => boundRequirementIds.has(id)),
    bindings,
    diagnostics,
  }
}

function providerCandidates(input: {
  catalog: CapabilityCatalog
  companyId: string
  requirement: WorkflowCapabilityRequirement
  installations: ConnectorInstallation[]
  grants: InstallationCapabilityGrant[]
}): Candidate[] {
  const candidates: Candidate[] = []
  for (const connector of input.catalog.connectors) {
    const offered = connector.capabilities.find(
      (capability) =>
        capability.capabilityKey === input.requirement.capabilityKey &&
        capability.capabilityVersion === input.requirement.capabilityVersion
    )
    if (!offered) continue
    const definition = input.catalog.capabilities.find(
      (candidate) =>
        candidate.key === offered.capabilityKey &&
        candidate.version === offered.capabilityVersion
    )
    if (!definition) continue
    for (const installation of input.installations) {
      if (
        installation.companyId !== input.companyId ||
        installation.connectorKey !== connector.key ||
        installation.connectorVersion !== connector.version
      ) {
        continue
      }
      const grant = input.grants.find(
        (candidate) =>
          candidate.companyId === input.companyId &&
          candidate.installationId === installation.id &&
          candidate.capabilityKey === offered.capabilityKey &&
          candidate.capabilityVersion === offered.capabilityVersion
      )
      candidates.push({
        connector,
        installation,
        grant,
        operations: offered.operations,
        schemaDigest: offered.schemaDigest,
        definitionSchemaDigest: definition.schemaDigest,
      })
    }
  }
  return candidates
}

function diagnostic(
  requirement: WorkflowCapabilityRequirement,
  code: CapabilityResolverDiagnostic["code"],
  message: string,
  candidates: Candidate[] = []
): CapabilityResolverDiagnostic {
  return capabilityResolverDiagnosticSchema.parse({
    code,
    severity: requirement.required ? "error" : "warning",
    requirementId: requirement.id,
    capabilityKey: requirement.capabilityKey,
    message,
    installationIds: candidates.map(({ installation }) => installation.id),
  })
}
