import { describe, expect, it } from "vitest"
import {
  capabilitySchemaDigest,
  effectiveCapabilityPermission,
  resolveWorkflowCapabilities,
  syntheticCommerceCapabilityCatalog,
  syntheticCommerceConnectorDefinition,
  type CapabilityOperation,
  type ConnectorInstallation,
  type InstallationCapabilityGrant,
  type WorkflowCapabilityRequirement,
} from "."

const companyId = "20000000-0000-4000-8000-000000000001"
const workflowDefinitionId = "30000000-0000-4000-8000-000000000001"
const installationId = "40000000-0000-4000-8000-000000000001"
const grantId = "50000000-0000-4000-8000-000000000001"
const resolvedAt = "2026-07-13T12:00:00.000Z"
const inventory = syntheticCommerceCapabilityCatalog.capabilities.find(
  ({ key }) => key === "commerce.inventory.read"
)!

describe("capability catalog", () => {
  it("registers versioned synthetic commerce datasets and guarded actions", () => {
    expect(syntheticCommerceConnectorDefinition.schemaVersion).toBe("1")
    expect(syntheticCommerceCapabilityCatalog.capabilities).toHaveLength(8)
    expect(
      syntheticCommerceCapabilityCatalog.capabilities.map(({ key }) => key)
    ).toEqual(
      expect.arrayContaining([
        "commerce.catalog.read",
        "commerce.inventory.read",
        "commerce.sales.read",
        "commerce.events.read",
        "procurement.open-orders.read",
        "procurement.vendor-terms.read",
        "procurement.purchase-order.create-draft",
        "procurement.purchase-order.mock-execute",
      ])
    )
    expect(inventory.schemaDigest).toMatch(/^[0-9a-f]{64}$/)
  })

  it("produces a stable digest independent of object key order", () => {
    const left = capabilitySchemaDigest({
      inputSchema: {
        type: "object",
        properties: { a: { type: "string" }, b: { type: "number" } },
        required: ["a", "b"],
        additionalProperties: false,
      },
      outputSchema: {
        type: "object",
        properties: {},
        required: [],
        additionalProperties: false,
      },
    })
    const right = capabilitySchemaDigest({
      outputSchema: {
        additionalProperties: false,
        properties: {},
        required: [],
        type: "object",
      },
      inputSchema: {
        additionalProperties: false,
        required: ["a", "b"],
        properties: { b: { type: "number" }, a: { type: "string" } },
        type: "object",
      },
    })
    expect(left).toBe(right)
  })
})

describe("effective capability permissions", () => {
  it("uses the intersection of connector, grant, workspace, skill, and role", () => {
    expect(
      effectiveCapabilityPermission({
        connectorOperations: ["read", "propose", "execute"],
        grantOperations: ["read", "propose"],
        workspaceOperations: ["read", "propose", "execute"],
        skillOperations: ["read", "propose"],
        actorRole: "member",
      })
    ).toEqual({
      allowedOperations: ["read", "propose"],
      deniedOperations: ["execute"],
    })

    expect(
      effectiveCapabilityPermission({
        connectorOperations: ["execute"],
        grantOperations: ["execute"],
        workspaceOperations: ["execute"],
        skillOperations: ["execute"],
        actorRole: "agent",
      }).allowedOperations
    ).toEqual([])
  })
})

describe("capability resolver", () => {
  it("binds one healthy and authorized installation", () => {
    const result = resolve({})

    expect(result.ok).toBe(true)
    expect(result.diagnostics).toEqual([])
    expect(result.bindings).toEqual([
      expect.objectContaining({
        companyId,
        workflowDefinitionId,
        connectorKey: "mandala.synthetic-commerce",
        installationId,
        capabilityKey: inventory.key,
        schemaDigest: inventory.schemaDigest,
      }),
    ])
  })

  it.each([
    {
      label: "missing",
      overrides: { installations: [] },
      code: "capability_missing",
    },
    {
      label: "unhealthy",
      overrides: {
        installations: [installation({ health: "unavailable" })],
      },
      code: "connector_unhealthy",
    },
    {
      label: "unauthorized",
      overrides: { grants: [grant({ status: "denied", operations: [] })] },
      code: "capability_unauthorized",
    },
    {
      label: "schema drift",
      overrides: {
        grants: [grant({ schemaDigest: "f".repeat(64) })],
      },
      code: "capability_schema_drift",
    },
    {
      label: "ambiguous",
      overrides: {
        installations: [
          installation(),
          installation({ id: "40000000-0000-4000-8000-000000000002" }),
        ],
        grants: [
          grant(),
          grant({
            id: "50000000-0000-4000-8000-000000000002",
            installationId: "40000000-0000-4000-8000-000000000002",
          }),
        ],
      },
      code: "capability_ambiguous",
    },
  ])("diagnoses $label resolution", ({ overrides, code }) => {
    const result = resolve(overrides)

    expect(result.ok).toBe(false)
    expect(result.bindings).toEqual([])
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ code, severity: "error" }),
    ])
  })
})

function resolve(
  overrides: Partial<{
    installations: ConnectorInstallation[]
    grants: InstallationCapabilityGrant[]
    workspaceOperations: CapabilityOperation[]
  }>
) {
  return resolveWorkflowCapabilities({
    catalog: syntheticCommerceCapabilityCatalog,
    companyId,
    workflowDefinitionId,
    requirements: [requirement()],
    installations: overrides.installations ?? [installation()],
    grants: overrides.grants ?? [grant()],
    workspaceOperations: overrides.workspaceOperations ?? [
      "read",
      "propose",
      "execute",
    ],
    actorRole: "owner",
    now: new Date(resolvedAt),
    createId: () => "60000000-0000-4000-8000-000000000001",
  })
}

function requirement(): WorkflowCapabilityRequirement {
  return {
    id: "inventory",
    capabilityKey: inventory.key,
    capabilityVersion: inventory.version,
    operation: "read",
    required: true,
    expectedSchemaDigest: inventory.schemaDigest,
  }
}

function installation(
  overrides: Partial<{
    id: string
    health: ConnectorInstallation["health"]["status"]
  }> = {}
): ConnectorInstallation {
  return {
    schemaVersion: "1",
    id: overrides.id ?? installationId,
    companyId,
    connectorKey: "mandala.synthetic-commerce",
    connectorVersion: "1.0.0",
    status: "connected",
    health: {
      status: overrides.health ?? "healthy",
      checkedAt: resolvedAt,
    },
    installedAt: resolvedAt,
    updatedAt: resolvedAt,
  }
}

function grant(
  overrides: Partial<{
    id: string
    installationId: string
    status: InstallationCapabilityGrant["status"]
    operations: CapabilityOperation[]
    schemaDigest: string
  }> = {}
): InstallationCapabilityGrant {
  return {
    schemaVersion: "1",
    id: overrides.id ?? grantId,
    companyId,
    installationId: overrides.installationId ?? installationId,
    capabilityKey: inventory.key,
    capabilityVersion: inventory.version,
    status: overrides.status ?? "granted",
    operations: overrides.operations ?? ["read"],
    schemaDigest: overrides.schemaDigest ?? inventory.schemaDigest,
    grantedAt: resolvedAt,
    updatedAt: resolvedAt,
  }
}
