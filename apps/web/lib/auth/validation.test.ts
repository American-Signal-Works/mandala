import { describe, expect, it } from "vitest"

import { getEmailValidationError, normalizeEmail } from "./validation"

describe("auth validation helpers", () => {
  it("normalizes email before auth calls", () => {
    expect(normalizeEmail("  Test.User@Example.COM  ")).toBe(
      "test.user@example.com"
    )
  })

  it("rejects empty and malformed email addresses", () => {
    expect(getEmailValidationError("")).toBe("Enter your email address.")
    expect(getEmailValidationError("not-an-email")).toBe(
      "Enter a valid email address."
    )
    expect(getEmailValidationError("person@example.c")).toBe(
      "Enter a valid email address."
    )
    expect(getEmailValidationError("person@example.com")).toBeNull()
  })
})
