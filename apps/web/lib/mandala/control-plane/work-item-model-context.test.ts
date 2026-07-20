import { describe, expect, it } from "vitest"
import type { ResolvedCompilerCapability } from "../skills/capabilities"
import type { CompiledAgentManifest } from "../skills/compiler"
import {
  currentModelBindings,
  projectLegacyFixtureDataForModel,
} from "./work-item-model-context"

describe("work item model context", () => {
  it("uses current classifications and drops unhealthy or ungranted bindings", () => {
    const bindings = currentModelBindings(
      {
        capabilityBindings: [
          binding("inventory", "inventory"),
          binding("vendor", "vendor"),
        ],
      } as unknown as CompiledAgentManifest,
      [
        capability("inventory", {
          modelAllowedPaths: ["rows[].sku", "rows[].quantity"],
        }),
        capability("vendor", { healthy: false }),
      ]
    )

    expect(bindings).toHaveLength(1)
    expect(bindings[0]).toMatchObject({
      alias: "inventory",
      modelAllowedPaths: ["rows[].sku", "rows[].quantity"],
    })
    expect(bindings[0]?.modelAllowedPaths).not.toContain("rows[].secret")
  })

  it("projects bounded synthetic fixture facts when legacy workflows have no bindings", () => {
    const projected = projectLegacyFixtureDataForModel({
      contextPacket: {
        sources: [{ source: "fixture_inventory" }],
        facts: {
          sku: "MDL-MATCHA-006",
          inventoryOnHand: 9,
          inboundUnits: 0,
          reorderPoint: 36,
          recent30DaySales: 150,
          leadTimeDays: 14,
          vendorPackSize: 12,
          vendorMinimumOrderQuantity: 72,
          secret: "never-project-this",
        },
      },
      recommendation: {
        rationaleSummary: "Recommend 96 units for mock review.",
        output: {
          projectedDailySales: 5.2,
          recommendedQuantity: 96,
          internalTrace: "never-project-this",
        },
      },
      evidence: {
        evidence: [{ label: "available_inventory", value: 9 }],
        assumptions: ["Fixture data is synthetic."],
      },
    } as never)

    expect(projected).toMatchObject({
      "synthetic-fixture": {
        inventory: {
          sku: "MDL-MATCHA-006",
          inventoryOnHand: 9,
          inboundUnits: 0,
          reorderPoint: 36,
        },
        sales: { recent30DaySales: 150 },
        vendorTerms: {
          leadTimeDays: 14,
          vendorPackSize: 12,
          vendorMinimumOrderQuantity: 72,
        },
        recommendation: {
          projectedDailySales: 5.2,
          recommendedQuantity: 96,
        },
      },
    })
    expect(JSON.stringify(projected)).not.toContain("never-project-this")
  })

  it("never applies the legacy fallback to real connector evidence", () => {
    expect(
      projectLegacyFixtureDataForModel({
        contextPacket: {
          sources: [{ source: "shiphero" }],
          facts: { inventoryOnHand: 9 },
        },
      } as never)
    ).toBeNull()
  })
})

function binding(alias: string, id: string) {
  return {
    alias,
    id,
    version: "1.0.0",
    access: "read" as const,
    connectorId: `${id}-connector`,
    schemaDigest: "a".repeat(64),
    toolName: `read_${id}`,
    healthy: true,
    granted: true,
    schemaCompatible: true,
    useInPrompt: true,
    modelAllowedPaths: ["rows[].secret"],
  }
}

function capability(
  id: string,
  overrides: Partial<ResolvedCompilerCapability> = {}
): ResolvedCompilerCapability {
  return {
    id,
    version: "1.0.0",
    access: "read",
    connectorId: `${id}-connector`,
    installationId: `${id}-connector`,
    capabilityVersionId: `${id}-version`,
    grantId: `${id}-grant`,
    schemaDigest: "a".repeat(64),
    schemaCompatible: true,
    toolName: `read_${id}`,
    healthy: true,
    granted: true,
    modelAllowedPaths: ["rows[].sku"],
    ...overrides,
  }
}
