import { describe, expect, it } from "vitest"
import { listWorkspaceMappingTemplates } from "./mapping-templates"

describe("workspace mapping templates", () => {
  it("are declarative, generic-provider specs without customer or source adapters", () => {
    const templates = listWorkspaceMappingTemplates()
    expect(templates).toHaveLength(5)
    const serialized = JSON.stringify(templates).toLowerCase()
    expect(serialized).not.toContain("dirt king")
    expect(serialized).not.toContain("alba")
    expect(serialized).not.toContain("shiphero")
    expect(serialized).not.toContain("trello")
    expect(serialized).not.toContain("javascript")
    expect(
      templates.every(
        ({ schemaVersion }) => schemaVersion === "mandala.workspace-data/v1"
      )
    ).toBe(true)
  })
})
