import { describe, expect, it } from "vitest"
import {
  AgentCapabilityResolutionError,
  jsonPointerToModelPath,
  resolveCompiledManifestGrantBindings,
  type ResolvedCompilerCapability,
} from "./capabilities"
import type { CompiledAgentManifest } from "./compiler"

describe("database-backed compiler capabilities", () => {
  it("converts classified JSON Pointers into bounded model paths", () => {
    expect(jsonPointerToModelPath("/sku")).toBe("sku")
    expect(jsonPointerToModelPath("/products/*/sku")).toBe("products[].sku")
    expect(jsonPointerToModelPath("/vendor~1code/~0value")).toBe(
      "vendor/code.~value"
    )
  })

  it("creates snapshots only from the exact healthy authorized grant", () => {
    expect(
      resolveCompiledManifestGrantBindings({
        manifest: manifest(),
        capabilities: [capability()],
      })
    ).toEqual([{ requirementKey: "inventory", grantId: grantId }])
  })

  it("rejects stale connector schemas before snapshot creation", () => {
    expect(() =>
      resolveCompiledManifestGrantBindings({
        manifest: manifest(),
        capabilities: [capability({ schemaCompatible: false })],
      })
    ).toThrow(AgentCapabilityResolutionError)
  })
})

const installationId = "b0000000-0000-4000-8000-000000000001"
const grantId = "c0000000-0000-4000-8000-000000000001"

function capability(
  overrides: Partial<ResolvedCompilerCapability> = {}
): ResolvedCompilerCapability {
  return {
    id: "commerce.inventory.read",
    version: "1.0.0",
    access: "read",
    connectorId: installationId,
    installationId,
    capabilityVersionId: "d0000000-0000-4000-8000-000000000001",
    grantId,
    schemaDigest: "a".repeat(64),
    schemaCompatible: true,
    toolName: "read_inventory",
    healthy: true,
    granted: true,
    modelAllowedPaths: ["sku"],
    ...overrides,
  }
}

function manifest(): CompiledAgentManifest {
  return {
    schemaVersion: "mandala.ai/v1",
    compilerVersion: "1.0.0",
    sourceDigest: "a".repeat(64),
    manifestDigest: "b".repeat(64),
    identity: {
      id: "inventory-agent",
      name: "Inventory Agent",
      version: "1.0.0",
      description: "Tests inventory.",
    },
    workflow: {
      type: "procurement_reorder_review",
      status: "draft",
      default_mode: "mock",
      triggers: [],
    },
    capabilityBindings: [
      {
        ...capability(),
        alias: "inventory",
        useInPrompt: true,
      },
    ],
    graph: [],
    rules: [],
    records: [],
    evidence: [],
    approvals: [],
    actions: [],
    tests: [],
    guidance: {
      purpose: "Purpose",
      investigation: "Investigate",
      decision: "Decide",
      exceptions: "Exceptions",
      outputQuality: "Quality",
    },
  } as unknown as CompiledAgentManifest
}
