import { describe, expect, it } from "vitest"
import { createRuntimeStartState, resolveRuntimeSandboxEnabled } from "./state"

describe("runtime Sandbox compatibility", () => {
  it.each([
    [{}, true],
    [{ sandboxEnabled: true }, true],
    [{ sandboxEnabled: false }, false],
    [{ operatingMode: "sandbox" }, true],
    [{ operatingMode: "live" }, false],
    [{ sandboxEnabled: false, operatingMode: "sandbox" }, true],
    [{ sandboxEnabled: true, operatingMode: "live" }, true],
    [{ sandboxEnabled: "false", operatingMode: "live" }, true],
    [{ operatingMode: "unknown" }, true],
  ])("resolves %j to Sandbox %s", (input, expected) => {
    expect(resolveRuntimeSandboxEnabled(input)).toBe(expected)
  })

  it("normalizes missing state before a runtime graph starts", () => {
    const state = createRuntimeStartState({
      companyId: "company-1",
      actorId: "actor-1",
      workflowDefinitionId: "workflow-1",
      workflowRunId: "run-1",
      manifestDigest: "digest-1",
      mode: "mock",
      trigger: { id: "manual", kind: "manual", input: {} },
    })
    expect(state).toMatchObject({
      sandboxEnabled: true,
      operatingMode: "sandbox",
    })
  })
})
