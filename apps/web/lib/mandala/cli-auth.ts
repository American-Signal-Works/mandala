import "server-only"

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto"
import { createClient, type Session } from "@supabase/supabase-js"
import { z } from "zod"

import type { Database } from "@/lib/supabase/types"

export const CLI_AUTHORIZATION_COOKIE = "mandala-cli-authorization"
export const CLI_AUTHORIZATION_COOKIE_MAX_AGE_SECONDS = 10 * 60
export const CLI_AUTHORIZATION_COOKIE_PATH = "/"
export const CLI_ACCESS_TOKEN_PREFIX = "mdl_cli_at_"
export const CLI_REFRESH_TOKEN_PREFIX = "mdl_cli_rt_"
export const CLI_ACCESS_TOKEN_LIFETIME_SECONDS = 15 * 60
export const CLI_REFRESH_TOKEN_LIFETIME_SECONDS = 30 * 24 * 60 * 60

export const privateCliAuthHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow",
}

export const claimedAuthorizationSchema = z
  .object({
    status: z.literal("exchange_ready"),
    authorizationId: z.string().uuid(),
    exchangeNonce: z.string().uuid(),
    userId: z.string().uuid(),
    companyId: z.string().uuid(),
    requestedScopes: z.array(z.literal("workspace:control")).min(1).max(10),
    clientName: z.string().min(1).max(120),
    clientVersion: z.string().min(1).max(40),
    clientPlatform: z.string().min(1).max(80),
  })
  .strict()

export const pendingAuthorizationClaimSchema = z
  .object({
    status: z.enum(["authorization_pending", "slow_down"]),
    intervalSeconds: z.number().int().min(5).max(30),
  })
  .strict()

export const terminalAuthorizationClaimSchema = z
  .object({
    status: z.enum(["denied", "expired", "consumed", "invalid_device_code"]),
  })
  .strict()

export const authorizationClaimSchema = z.union([
  claimedAuthorizationSchema,
  pendingAuthorizationClaimSchema,
  terminalAuthorizationClaimSchema,
])

export const cliAuthorizationOperationErrorSchema = z
  .object({
    error: z.enum([
      "rate_limited",
      "not_found",
      "expired",
      "already_decided",
      "invalid_decision",
      "company_required",
      "forbidden",
    ]),
  })
  .strict()

const encryptedActorSessionSchema = z
  .object({
    version: z.literal(1),
    accessToken: z.string().min(1).max(8_192),
    expiresAt: z.number().int().positive(),
    userId: z.string().uuid(),
  })
  .strict()

export function createDeviceCode() {
  return randomBytes(32).toString("base64url")
}

export function createBrowserAuthorizationToken() {
  return randomBytes(32).toString("base64url")
}

export function createCliAccessToken() {
  return `${CLI_ACCESS_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`
}

export function createCliRefreshToken() {
  return `${CLI_REFRESH_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`
}

export function isCliAccessToken(value: string) {
  return new RegExp(`^${CLI_ACCESS_TOKEN_PREFIX}[A-Za-z0-9_-]{43}$`).test(value)
}

export function isCliRefreshToken(value: string) {
  return new RegExp(`^${CLI_REFRESH_TOKEN_PREFIX}[A-Za-z0-9_-]{43}$`).test(
    value
  )
}

export function isBrowserAuthorizationToken(value: string) {
  return /^[A-Za-z0-9_-]{43}$/.test(value)
}

export function readBrowserAuthorizationToken(request: Request) {
  const cookieHeader = request.headers.get("cookie") ?? ""
  for (const part of cookieHeader.split(";")) {
    const [candidate, ...rawValue] = part.trim().split("=")
    if (candidate !== CLI_AUTHORIZATION_COOKIE) continue
    const value = decodeURIComponent(rawValue.join("="))
    return isBrowserAuthorizationToken(value) ? value : null
  }
  return null
}

export function hashAuthorizationSecret(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex")
}

export function encryptCliActorSession(session: Session) {
  const payload = encryptedActorSessionSchema.parse({
    version: 1,
    accessToken: session.access_token,
    expiresAt:
      session.expires_at ??
      Math.floor(Date.now() / 1_000) + (session.expires_in ?? 0),
    userId: session.user.id,
  })
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", actorSessionKey(), iv)
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(payload), "utf8"),
    cipher.final(),
  ])
  return [
    "v1",
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".")
}

export function decryptCliActorSession(value: string) {
  const [version, encodedIv, encodedTag, encodedCiphertext, extra] =
    value.split(".")
  if (
    version !== "v1" ||
    !encodedIv ||
    !encodedTag ||
    !encodedCiphertext ||
    extra
  ) {
    throw new Error("cli_actor_session_invalid")
  }
  const iv = Buffer.from(encodedIv, "base64url")
  const tag = Buffer.from(encodedTag, "base64url")
  const ciphertext = Buffer.from(encodedCiphertext, "base64url")
  if (iv.length !== 12 || tag.length !== 16 || ciphertext.length > 16_384) {
    throw new Error("cli_actor_session_invalid")
  }
  const decipher = createDecipheriv("aes-256-gcm", actorSessionKey(), iv)
  decipher.setAuthTag(tag)
  const plaintext = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString("utf8")
  return encryptedActorSessionSchema.parse(JSON.parse(plaintext))
}

export async function getAuthSessionId(session: Session) {
  const verifier = createClient<Database>(
    requiredEnvironment("NEXT_PUBLIC_SUPABASE_URL"),
    requiredEnvironment("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
    }
  )
  const { data, error } = await verifier.auth.getClaims(session.access_token)
  const sessionId = data?.claims.session_id
  if (
    error ||
    typeof sessionId !== "string" ||
    !z.string().uuid().safeParse(sessionId).success
  ) {
    throw new Error("cli_session_claims_invalid")
  }
  return sessionId
}

export function requestSubjectHash(request: Request) {
  return authorizationSubjectHash(request.headers)
}

export function authorizationSubjectHash(headers: Pick<Headers, "get">) {
  const forwarded = headers.get("x-forwarded-for")
  const address = forwarded?.split(",")[0]?.trim() || "unknown"
  const userAgent = headers.get("user-agent")?.slice(0, 300) || "unknown"
  return hashAuthorizationSecret(`${address}\u0000${userAgent}`)
}

export function productionSiteOrigin(request: Request) {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim()
  const origin = configured || new URL(request.url).origin
  return new URL(origin).origin
}

export function cliCredentialExpiries(now = new Date()) {
  const nowSeconds = Math.floor(now.getTime() / 1_000)
  return {
    accessExpiresAt: new Date(
      (nowSeconds + CLI_ACCESS_TOKEN_LIFETIME_SECONDS) * 1_000
    ),
    refreshExpiresAt: new Date(
      (nowSeconds + CLI_REFRESH_TOKEN_LIFETIME_SECONDS) * 1_000
    ),
    accessExpiresAtSeconds: nowSeconds + CLI_ACCESS_TOKEN_LIFETIME_SECONDS,
  }
}

function actorSessionKey() {
  return createHash("sha256")
    .update("mandala-cli-actor-session\u0000", "utf8")
    .update(requiredEnvironment("SUPABASE_SERVICE_ROLE_KEY"), "utf8")
    .digest()
}

function requiredEnvironment(
  name:
    | "NEXT_PUBLIC_SUPABASE_URL"
    | "NEXT_PUBLIC_SUPABASE_ANON_KEY"
    | "SUPABASE_SERVICE_ROLE_KEY"
) {
  const value = process.env[name]
  if (!value) throw new Error(`Missing required environment variable: ${name}`)
  return value
}
