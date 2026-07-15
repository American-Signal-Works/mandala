import "server-only"

import { createHash, createHmac } from "node:crypto"

const tokenPrefix = "mandala_invite_v1"

export function invitationToken(input: {
  invitationId: string
  version: number
  secret?: string
}): string {
  if (!Number.isInteger(input.version) || input.version < 1) {
    throw new Error("Invalid invitation token version.")
  }
  const secret = input.secret ?? requiredInvitationSecret()
  if (Buffer.byteLength(secret, "utf8") < 32) {
    throw new Error("INVITATION_TOKEN_SECRET must contain at least 32 bytes.")
  }
  const mac = createHmac("sha256", secret)
    .update(`${tokenPrefix}:${input.invitationId}:${input.version}`)
    .digest("base64url")
  return `${tokenPrefix}.${mac}`
}

export function invitationTokenDigest(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex")
}

function requiredInvitationSecret(): string {
  const value = process.env.INVITATION_TOKEN_SECRET?.trim()
  if (!value) throw new Error("Missing INVITATION_TOKEN_SECRET.")
  return value
}
