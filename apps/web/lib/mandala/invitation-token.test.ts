import { afterEach, describe, expect, it } from "vitest"
import { invitationToken, invitationTokenDigest } from "./invitation-token"

const originalSecret = process.env.INVITATION_TOKEN_SECRET
const invitationId = "b3000000-0000-4000-8000-000000000001"

afterEach(() => {
  if (originalSecret === undefined) delete process.env.INVITATION_TOKEN_SECRET
  else process.env.INVITATION_TOKEN_SECRET = originalSecret
})

describe("invitation tokens", () => {
  it("derives an opaque stable token without persisting the secret input", () => {
    process.env.INVITATION_TOKEN_SECRET = "s".repeat(32)
    const first = invitationToken({ invitationId, version: 1 })
    const replay = invitationToken({ invitationId, version: 1 })

    expect(first).toBe(replay)
    expect(first).toMatch(/^mandala_invite_v1\.[A-Za-z0-9_-]{43}$/)
    expect(first).not.toContain(invitationId)
    expect(invitationTokenDigest(first)).toMatch(/^[0-9a-f]{64}$/)
  })

  it("rotates the token whenever invitation version changes", () => {
    const secret = "x".repeat(32)
    expect(invitationToken({ invitationId, version: 1, secret })).not.toBe(
      invitationToken({ invitationId, version: 2, secret })
    )
  })

  it("rejects missing, short, or invalid configuration", () => {
    delete process.env.INVITATION_TOKEN_SECRET
    expect(() => invitationToken({ invitationId, version: 1 })).toThrow(
      "Missing INVITATION_TOKEN_SECRET"
    )
    expect(() =>
      invitationToken({ invitationId, version: 1, secret: "too-short" })
    ).toThrow("at least 32 bytes")
    expect(() =>
      invitationToken({ invitationId, version: 0, secret: "x".repeat(32) })
    ).toThrow("Invalid invitation token version")
  })
})
