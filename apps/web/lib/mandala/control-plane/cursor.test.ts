import { describe, expect, it } from "vitest"
import { z } from "zod"
import {
  BoundCursorError,
  decodeBoundCursor,
  encodeBoundCursor,
  resolveCursorSecret,
} from "./cursor"

const secret = "test-only-cursor-secret-that-is-long-enough"
const pageSchema = z
  .object({
    snapshotAt: z.string().datetime({ offset: true }),
    after: z.object({
      sortValue: z.union([z.string(), z.number(), z.null()]),
      itemId: z.string().uuid(),
    }),
  })
  .strict()
const page = {
  snapshotAt: "2026-07-14T19:00:00.000Z",
  after: {
    sortValue: 50,
    itemId: "33000000-0000-0000-0000-000000000001",
  },
}
const binding = {
  companyId: "20000000-0000-0000-0000-000000000001",
  statuses: ["active", "blocked", "approved"],
  sort: { key: "priority", direction: "desc" },
}

describe("bound control-plane cursors", () => {
  it("round-trips an opaque database page", () => {
    const cursor = encodeBoundCursor({ binding, page, secret })

    expect(cursor).not.toContain(page.after.itemId)
    expect(decodeBoundCursor({ cursor, binding, pageSchema, secret })).toEqual(
      page
    )
  })

  it("rejects tampering and reuse with another query", () => {
    const cursor = encodeBoundCursor({ binding, page, secret })
    const last = cursor.at(-1) === "a" ? "b" : "a"

    expect(() =>
      decodeBoundCursor({
        cursor: `${cursor.slice(0, -1)}${last}`,
        binding,
        pageSchema,
        secret,
      })
    ).toThrow(BoundCursorError)
    expect(() =>
      decodeBoundCursor({
        cursor,
        binding: { ...binding, statuses: ["resolved"] },
        pageSchema,
        secret,
      })
    ).toThrow(BoundCursorError)
  })

  it("rejects a page that does not match the expected shape", () => {
    const cursor = encodeBoundCursor({
      binding,
      page: { snapshotAt: "invalid", after: null },
      secret,
    })

    expect(() =>
      decodeBoundCursor({ cursor, binding, pageSchema, secret })
    ).toThrow(BoundCursorError)
  })

  it("reuses an existing server secret and has a process-local fallback", () => {
    expect(
      resolveCursorSecret({
        MANDALA_CONTROL_BINDING_SECRET: secret,
      } as unknown as NodeJS.ProcessEnv)
    ).toBe(secret)
    const fallback = resolveCursorSecret({} as NodeJS.ProcessEnv)
    expect(fallback).toHaveLength(64)
    expect(resolveCursorSecret({} as NodeJS.ProcessEnv)).toBe(fallback)
    expect(() =>
      resolveCursorSecret({
        MANDALA_CONTROL_BINDING_SECRET: "weak",
      } as unknown as NodeJS.ProcessEnv)
    ).toThrow("cursor_configuration_failed")
  })
})
