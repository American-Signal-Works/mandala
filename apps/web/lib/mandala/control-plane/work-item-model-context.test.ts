import { describe, expect, it } from "vitest"
import type { ResolvedCompilerCapability } from "../skills/capabilities"
import type { CompiledAgentManifest } from "../skills/compiler"
import { currentModelBindings } from "./work-item-model-context"

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
