import "server-only"

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto"
import type { AuthCallbackCredential } from "@/lib/auth/callback"
import { getSafePostAuthPath } from "@/lib/auth/redirect"

export const PENDING_AUTH_COOKIE = "mandala-auth-pending"
export const PENDING_AUTH_COOKIE_PATH = "/api/auth/session/replacement"
export const PENDING_AUTH_MAX_AGE_SECONDS = 5 * 60

export type PendingAuthSession = {
  credential: AuthCallbackCredential
  continuation: string
  version: 1
}

type PendingAuthEnvelope = PendingAuthSession & { issuedAt: number }

type PendingAuthCryptoOptions = {
  now?: number
  secret?: string
}

export function encodePendingAuthSession(
  value: PendingAuthSession,
  options: PendingAuthCryptoOptions = {}
) {
  const iv = randomBytes(12)
  const cipher = createCipheriv(
    "aes-256-gcm",
    pendingAuthKey(options.secret),
    iv
  )
  cipher.setAAD(Buffer.from(PENDING_AUTH_COOKIE, "utf8"))
  const plaintext = Buffer.from(
    JSON.stringify({ ...value, issuedAt: options.now ?? Date.now() }),
    "utf8"
  )
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  return [
    "v1",
    iv.toString("base64url"),
    ciphertext.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
  ].join(".")
}

export function decodePendingAuthSession(
  value: string | null | undefined,
  options: PendingAuthCryptoOptions = {}
): PendingAuthSession | null {
  if (!value || value.length > 12_000) {
    return null
  }

  try {
    const [version, encodedIv, encodedCiphertext, encodedTag, ...extra] =
      value.split(".")
    if (
      version !== "v1" ||
      !encodedIv ||
      !encodedCiphertext ||
      !encodedTag ||
      extra.length > 0
    ) {
      return null
    }

    const decipher = createDecipheriv(
      "aes-256-gcm",
      pendingAuthKey(options.secret),
      Buffer.from(encodedIv, "base64url")
    )
    decipher.setAAD(Buffer.from(PENDING_AUTH_COOKIE, "utf8"))
    decipher.setAuthTag(Buffer.from(encodedTag, "base64url"))
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(encodedCiphertext, "base64url")),
      decipher.final(),
    ])
    const parsed = JSON.parse(
      plaintext.toString("utf8")
    ) as Partial<PendingAuthEnvelope>

    const now = options.now ?? Date.now()
    if (
      parsed.version !== 1 ||
      !parsed.credential ||
      typeof parsed.issuedAt !== "number" ||
      !Number.isFinite(parsed.issuedAt) ||
      parsed.issuedAt > now ||
      now - parsed.issuedAt > PENDING_AUTH_MAX_AGE_SECONDS * 1_000
    ) {
      return null
    }

    const credential = parsed.credential
    if (
      (credential.kind !== "code" && credential.kind !== "otp") ||
      typeof credential.value !== "string" ||
      credential.value.length < 8 ||
      credential.value.length > 8_192
    ) {
      return null
    }

    if (
      credential.kind === "otp" &&
      credential.type !== "email" &&
      credential.type !== "signup"
    ) {
      return null
    }

    return {
      credential,
      continuation: getSafePostAuthPath(parsed.continuation),
      version: 1,
    }
  } catch {
    return null
  }
}

function pendingAuthKey(explicitSecret?: string) {
  const secret =
    explicitSecret ?? process.env.AUTH_PENDING_SESSION_SECRET?.trim()
  if (!secret || Buffer.byteLength(secret, "utf8") < 32) {
    throw new Error(
      "AUTH_PENDING_SESSION_SECRET must contain at least 32 bytes."
    )
  }
  return createHash("sha256")
    .update("mandala:pending-auth-session:v1\u0000", "utf8")
    .update(secret, "utf8")
    .digest()
}
