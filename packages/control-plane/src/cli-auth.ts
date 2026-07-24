import { z } from "zod"
import { companyRoleSchema } from "./schemas.js"

export const cliAuthorizationScopeSchema = z.literal("workspace:control")
const cliTimestampSchema = z.string().datetime({ offset: true })

export const cliDeviceAuthorizationCreateRequestSchema = z
  .object({
    clientName: z.string().trim().min(1).max(120),
    clientVersion: z.string().trim().min(1).max(40),
    clientPlatform: z.string().trim().min(1).max(80),
    requestedScopes: z
      .array(cliAuthorizationScopeSchema)
      .min(1)
      .max(10)
      .default(["workspace:control"]),
  })
  .strict()

export const cliDeviceAuthorizationCreateResponseSchema = z
  .object({
    deviceCode: z.string().min(32).max(256),
    verificationUri: z.string().url(),
    expiresAt: cliTimestampSchema,
    intervalSeconds: z.number().int().min(5).max(30),
  })
  .strict()

export const cliDeviceAuthorizationBootstrapRequestSchema = z
  .object({
    browserToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  })
  .strict()

export const cliDeviceAuthorizationStatusSchema = z.enum([
  "pending",
  "approved",
  "denied",
  "expired",
  "exchanging",
  "consumed",
])

export const cliDeviceAuthorizationInspectionSchema = z
  .object({
    authorizationId: z.string().uuid(),
    status: cliDeviceAuthorizationStatusSchema,
    clientName: z.string().min(1).max(120),
    clientVersion: z.string().min(1).max(40),
    clientPlatform: z.string().min(1).max(80),
    requestedScopes: z.array(cliAuthorizationScopeSchema).min(1).max(10),
    expiresAt: cliTimestampSchema,
    selectedCompanyId: z.string().uuid().nullable(),
  })
  .strict()

export const cliDeviceAuthorizationDecisionRequestSchema = z.discriminatedUnion(
  "decision",
  [
    z
      .object({
        decision: z.literal("approve"),
        companyId: z.string().uuid(),
      })
      .strict(),
    z.object({ decision: z.literal("deny") }).strict(),
  ]
)

export const cliDeviceAuthorizationDecisionResponseSchema =
  z.discriminatedUnion("status", [
    z
      .object({
        status: z.literal("approved"),
        company: z
          .object({
            id: z.string().uuid(),
            name: z.string().min(1).max(200),
          })
          .strict(),
      })
      .strict(),
    z.object({ status: z.literal("denied") }).strict(),
  ])

export const cliDeviceAuthorizationTokenRequestSchema = z
  .object({ deviceCode: z.string().min(32).max(256) })
  .strict()

const cliDeviceAuthorizationPendingResponseSchema = z
  .object({
    status: z.enum(["authorization_pending", "slow_down"]),
    intervalSeconds: z.number().int().min(5).max(30),
  })
  .strict()

const cliDeviceAuthorizationTerminalResponseSchema = z
  .object({
    status: z.enum(["denied", "expired", "consumed", "invalid_device_code"]),
  })
  .strict()

const cliDeviceAuthorizationAuthorizedResponseSchema = z
  .object({
    status: z.literal("authorized"),
    sessionId: z.string().uuid(),
    accessToken: z.string().min(1),
    refreshToken: z.string().min(1),
    expiresAt: z.number().int().positive(),
    user: z
      .object({
        id: z.string().uuid(),
        email: z.string().email().nullable(),
      })
      .strict(),
    company: z
      .object({
        id: z.string().uuid(),
        name: z.string().min(1).max(200),
      })
      .strict()
      .optional(),
  })
  .strict()

export const cliSessionCompanySelectionRequestSchema = z
  .object({ companyId: z.string().uuid() })
  .strict()

export const cliSessionCompanySelectionResponseSchema = z
  .object({
    company: z
      .object({
        id: z.string().uuid(),
        name: z.string().min(1).max(200),
        role: companyRoleSchema,
      })
      .strict(),
  })
  .strict()

export const cliDeviceAuthorizationTokenResponseSchema = z.union([
  cliDeviceAuthorizationPendingResponseSchema,
  cliDeviceAuthorizationTerminalResponseSchema,
  cliDeviceAuthorizationAuthorizedResponseSchema,
])

export const cliSessionRefreshRequestSchema = z
  .object({ refreshToken: z.string().min(1).max(8_192) })
  .strict()

export const cliSessionRefreshResponseSchema = z
  .object({
    accessToken: z.string().min(1),
    refreshToken: z.string().min(1),
    expiresAt: z.number().int().positive(),
    user: z
      .object({
        id: z.string().uuid(),
        email: z.string().email().nullable(),
      })
      .strict(),
  })
  .strict()

export const cliSessionSchema = z
  .object({
    id: z.string().uuid(),
    selectedCompanyId: z.string().uuid().nullable(),
    selectedCompanyName: z.string().min(1).max(200).nullable().optional(),
    scopes: z.array(cliAuthorizationScopeSchema).min(1).max(10),
    clientName: z.string().min(1).max(120),
    clientVersion: z.string().min(1).max(40),
    clientPlatform: z.string().min(1).max(80),
    createdAt: cliTimestampSchema,
    lastUsedAt: cliTimestampSchema,
    revokedAt: cliTimestampSchema.nullable(),
  })
  .strict()

export const cliSessionListResponseSchema = z
  .object({ sessions: z.array(cliSessionSchema) })
  .strict()

export const cliSessionRevokeRequestSchema = z
  .object({ sessionId: z.string().uuid() })
  .strict()

export const cliSessionRevokeAllRequestSchema = z
  .object({ all: z.literal(true) })
  .strict()

export const cliSessionRevocationRequestSchema = z.union([
  cliSessionRevokeRequestSchema,
  cliSessionRevokeAllRequestSchema,
])

export const cliSessionRevocationResponseSchema = z.union([
  z.object({ sessionId: z.string().uuid(), revoked: z.literal(true) }).strict(),
  z.object({ revokedCount: z.number().int().nonnegative() }).strict(),
])

export type CliDeviceAuthorizationCreateResponse = z.infer<
  typeof cliDeviceAuthorizationCreateResponseSchema
>
export type CliDeviceAuthorizationInspection = z.infer<
  typeof cliDeviceAuthorizationInspectionSchema
>
export type CliDeviceAuthorizationTokenResponse = z.infer<
  typeof cliDeviceAuthorizationTokenResponseSchema
>
export type CliSession = z.infer<typeof cliSessionSchema>
