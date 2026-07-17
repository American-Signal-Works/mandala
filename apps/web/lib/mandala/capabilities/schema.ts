import { z } from "zod"

const capabilityKeyPattern = /^[a-z][a-z0-9_-]*(?:\.[a-z][a-z0-9_-]*){2,}$/
const connectorKeyPattern = /^[a-z][a-z0-9_]*(?:[.-][a-z0-9_]+)*$/
const semanticVersionPattern = /^\d+\.\d+\.\d+$/
const sha256Pattern = /^[0-9a-f]{64}$/

export const capabilitySchemaVersionSchema = z.literal("1")
export const capabilityKeySchema = z
  .string()
  .min(5)
  .max(200)
  .regex(capabilityKeyPattern)
export const connectorKeySchema = z
  .string()
  .min(1)
  .max(120)
  .regex(connectorKeyPattern)
export const semanticVersionSchema = z
  .string()
  .max(40)
  .regex(semanticVersionPattern)
export const schemaDigestSchema = z.string().regex(sha256Pattern)
export const capabilityOperationSchema = z.enum(["read", "propose", "execute"])
export const capabilityKindSchema = z.enum(["dataset", "action"])
export const dataClassificationSchema = z.enum([
  "internal",
  "confidential",
  "restricted",
  "secret",
])
export const modelEgressPolicySchema = z
  .object({
    defaultClassification: dataClassificationSchema,
    fields: z.array(
      z
        .object({
          path: z.string().min(1).max(300),
          classification: dataClassificationSchema,
          modelAllowed: z.boolean(),
        })
        .strict()
    ),
  })
  .strict()
export const capabilityActorRoleSchema = z.enum([
  "owner",
  "admin",
  "approver",
  "member",
  "viewer",
  "agent",
])

export const jsonSchemaDocumentSchema = z
  .object({
    type: z.literal("object"),
    properties: z.record(z.string(), z.unknown()).default({}),
    required: z.array(z.string()).default([]),
    additionalProperties: z.boolean().default(false),
  })
  .strict()

export const capabilityDefinitionSchema = z
  .object({
    schemaVersion: capabilitySchemaVersionSchema,
    key: capabilityKeySchema,
    version: semanticVersionSchema,
    name: z.string().min(1).max(200),
    description: z.string().min(1).max(2_000),
    kind: capabilityKindSchema,
    operations: z.array(capabilityOperationSchema).min(1),
    inputSchema: jsonSchemaDocumentSchema,
    outputSchema: jsonSchemaDocumentSchema,
    schemaDigest: schemaDigestSchema,
    modelEgress: modelEgressPolicySchema,
  })
  .strict()

export const connectorCapabilitySchema = z
  .object({
    capabilityKey: capabilityKeySchema,
    capabilityVersion: semanticVersionSchema,
    operations: z.array(capabilityOperationSchema).min(1),
    schemaDigest: schemaDigestSchema,
    evidenceRoles: z
      .array(
        z
          .object({
            businessObject: z
              .string()
              .regex(/^[a-z][a-z0-9_-]*(?:\.[a-z][a-z0-9_-]*)+$/),
            role: z.enum(["authoritative", "tracking", "supporting"]),
            recordTypes: z.array(z.string().min(1).max(150)).min(1).max(20),
          })
          .strict()
      )
      .max(20)
      .optional(),
  })
  .strict()

export const connectorDefinitionSchema = z
  .object({
    schemaVersion: capabilitySchemaVersionSchema,
    key: connectorKeySchema,
    version: semanticVersionSchema,
    name: z.string().min(1).max(200),
    description: z.string().min(1).max(2_000),
    capabilities: z.array(connectorCapabilitySchema).min(1),
  })
  .strict()

export const connectorInstallationSchema = z
  .object({
    schemaVersion: capabilitySchemaVersionSchema,
    id: z.string().uuid(),
    companyId: z.string().uuid(),
    connectorKey: connectorKeySchema,
    connectorVersion: semanticVersionSchema,
    status: z.enum(["connected", "degraded", "disconnected", "revoked"]),
    health: z
      .object({
        status: z.enum(["healthy", "degraded", "unavailable", "unknown"]),
        checkedAt: z.string().datetime({ offset: true }),
        message: z.string().min(1).max(1_000).optional(),
      })
      .strict(),
    installedAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .strict()

export const installationCapabilityGrantSchema = z
  .object({
    schemaVersion: capabilitySchemaVersionSchema,
    id: z.string().uuid(),
    companyId: z.string().uuid(),
    installationId: z.string().uuid(),
    capabilityKey: capabilityKeySchema,
    capabilityVersion: semanticVersionSchema,
    status: z.enum(["granted", "denied", "revoked"]),
    operations: z.array(capabilityOperationSchema),
    schemaDigest: schemaDigestSchema,
    grantedAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .strict()

export const workflowCapabilityRequirementSchema = z
  .object({
    id: connectorKeySchema,
    capabilityKey: capabilityKeySchema,
    capabilityVersion: semanticVersionSchema,
    operation: capabilityOperationSchema,
    required: z.boolean().default(true),
    expectedSchemaDigest: schemaDigestSchema.optional(),
  })
  .strict()

export const workflowCapabilityBindingSchema = z
  .object({
    schemaVersion: capabilitySchemaVersionSchema,
    id: z.string().uuid(),
    companyId: z.string().uuid(),
    workflowDefinitionId: z.string().uuid(),
    requirementId: connectorKeySchema,
    installationId: z.string().uuid(),
    connectorKey: connectorKeySchema,
    connectorVersion: semanticVersionSchema,
    capabilityKey: capabilityKeySchema,
    capabilityVersion: semanticVersionSchema,
    operation: capabilityOperationSchema,
    schemaDigest: schemaDigestSchema,
    resolvedAt: z.string().datetime({ offset: true }),
  })
  .strict()

export const capabilityCatalogSchema = z
  .object({
    schemaVersion: capabilitySchemaVersionSchema,
    capabilities: z.array(capabilityDefinitionSchema),
    connectors: z.array(connectorDefinitionSchema),
  })
  .strict()

export const capabilityResolverDiagnosticCodeSchema = z.enum([
  "capability_missing",
  "capability_ambiguous",
  "connector_unhealthy",
  "capability_unauthorized",
  "capability_schema_drift",
])

export const capabilityResolverDiagnosticSchema = z
  .object({
    code: capabilityResolverDiagnosticCodeSchema,
    severity: z.enum(["error", "warning"]),
    requirementId: connectorKeySchema,
    capabilityKey: capabilityKeySchema,
    message: z.string().min(1).max(2_000),
    installationIds: z.array(z.string().uuid()).default([]),
  })
  .strict()

export type CapabilityOperation = z.infer<typeof capabilityOperationSchema>
export type CapabilityActorRole = z.infer<typeof capabilityActorRoleSchema>
export type CapabilityDefinition = z.infer<typeof capabilityDefinitionSchema>
export type DataClassification = z.infer<typeof dataClassificationSchema>
export type ConnectorDefinition = z.infer<typeof connectorDefinitionSchema>
export type ConnectorInstallation = z.infer<typeof connectorInstallationSchema>
export type InstallationCapabilityGrant = z.infer<
  typeof installationCapabilityGrantSchema
>
export type WorkflowCapabilityRequirement = z.infer<
  typeof workflowCapabilityRequirementSchema
>
export type WorkflowCapabilityBinding = z.infer<
  typeof workflowCapabilityBindingSchema
>
export type CapabilityCatalog = z.infer<typeof capabilityCatalogSchema>
export type CapabilityResolverDiagnostic = z.infer<
  typeof capabilityResolverDiagnosticSchema
>
