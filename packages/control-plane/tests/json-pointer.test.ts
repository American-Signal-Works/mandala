import { describe, expect, it } from "vitest"
import {
  applyJsonPointerAssignments,
  JsonPointerError,
  parseJsonPointerAssignment,
} from "../src/index.js"

describe("JSON Pointer assignments", () => {
  it("parses JSON values and applies an immutable update", () => {
    const source = { lines: [{ quantity: 12, label: "A" }] }
    const patch = parseJsonPointerAssignment("/lines/0/quantity=24")

    const result = applyJsonPointerAssignments(source, [patch])

    expect(result).toEqual({ lines: [{ quantity: 24, label: "A" }] })
    expect(source.lines[0]?.quantity).toBe(12)
  })

  it("decodes escaped path segments", () => {
    const source = { "a/b": { "~key": true } }
    const patch = parseJsonPointerAssignment("/a~1b/~0key=false")

    expect(applyJsonPointerAssignments(source, [patch])).toEqual({
      "a/b": { "~key": false },
    })
  })

  it.each([
    "/__proto__/polluted=true",
    "/constructor/prototype/polluted=true",
    "/safe/prototype/x=1",
  ])("rejects prototype-pollution path %s", (assignment) => {
    expect(() => parseJsonPointerAssignment(assignment)).toThrowError(
      JsonPointerError
    )
  })

  it("does not create missing paths or extend arrays", () => {
    expect(() =>
      applyJsonPointerAssignments({ value: 1 }, [
        parseJsonPointerAssignment("/missing=2"),
      ])
    ).toThrowError(/does not exist/)
    expect(() =>
      applyJsonPointerAssignments([1], [parseJsonPointerAssignment("/1=2")])
    ).toThrowError(/cannot extend/)
  })
})
