import { describe, expect, it } from "vitest"

import { connectorAccessSchema, connectorSyncConfigSchema } from "./types"

describe("connectorSyncConfigSchema", () => {
  it("keeps connector ingestion disabled until a source explicitly opts in", () => {
    expect(connectorSyncConfigSchema.parse({}).enabled).toBe(false)
    expect(connectorSyncConfigSchema.parse({ enabled: true }).enabled).toBe(
      true
    )
  })
})

describe("connectorAccessSchema", () => {
  it("defaults to disconnected with no permissions", () => {
    expect(connectorAccessSchema.parse({})).toMatchObject({
      status: "disconnected",
      permissions: { read: false, write: false },
    })
  })
})
