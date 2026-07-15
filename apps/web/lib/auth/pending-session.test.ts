import { describe, expect, it } from "vitest"

import {
  decodePendingAuthSession,
  encodePendingAuthSession,
} from "./pending-session"

describe("pending auth session", () => {
  const secret = "pending-session-test-secret-value-32-bytes"

  it("round trips only a safe continuation and opaque auth credential", () => {
    const encoded = encodePendingAuthSession(
      {
        credential: { kind: "code", value: "one-time-code" },
        continuation: "/login?auth=success",
        version: 1,
      },
      { now: 1_000, secret }
    )

    expect(encoded).not.toContain("one-time-code")
    expect(decodePendingAuthSession(encoded, { now: 1_000, secret })).toEqual({
      credential: { kind: "code", value: "one-time-code" },
      continuation: "/login?auth=success",
      version: 1,
    })
  })

  it("fails closed for malformed data and external continuations", () => {
    expect(decodePendingAuthSession("not-json", { secret })).toBeNull()

    const encoded = encodePendingAuthSession(
      {
        credential: { kind: "code", value: "one-time-code" },
        continuation: "https://evil.example.com",
        version: 1,
      },
      { secret }
    )
    expect(decodePendingAuthSession(encoded, { secret })?.continuation).toBe(
      "/login?auth=success"
    )
  })

  it("rejects tampering, expiry, and a different encryption key", () => {
    const encoded = encodePendingAuthSession(
      {
        credential: { kind: "otp", value: "one-time-token", type: "email" },
        continuation: "/login?auth=success",
        version: 1,
      },
      { now: 1_000, secret }
    )
    const tamperedParts = encoded.split(".")
    const ciphertext = tamperedParts[2]!
    tamperedParts[2] = `${ciphertext[0] === "a" ? "b" : "a"}${ciphertext.slice(1)}`
    const tampered = tamperedParts.join(".")

    expect(
      decodePendingAuthSession(tampered, { now: 1_000, secret })
    ).toBeNull()
    expect(
      decodePendingAuthSession(encoded, {
        now: 1_000 + 5 * 60 * 1_000 + 1,
        secret,
      })
    ).toBeNull()
    expect(
      decodePendingAuthSession(encoded, {
        now: 1_000,
        secret: "a-different-pending-secret-value-32-bytes",
      })
    ).toBeNull()
  })
})
