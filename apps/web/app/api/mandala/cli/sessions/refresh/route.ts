import { NextResponse } from "next/server"
import {
  cliSessionRefreshRequestSchema,
  cliSessionRefreshResponseSchema,
} from "@workspace/control-plane"
import { z } from "zod"

import {
  inspectCliSessionRefresh,
  issueSupabaseCliActorSession,
  revokeIssuedCliActorSession,
  rotateCliSessionCredentials,
} from "@/actions/admin/cli-auth"
import {
  cliCredentialExpiries,
  createCliAccessToken,
  createCliRefreshToken,
  encryptCliActorSession,
  getAuthSessionId,
  hashAuthorizationSecret,
  isCliRefreshToken,
  privateCliAuthHeaders,
} from "@/lib/mandala/cli-auth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const rotatedSessionSchema = z
  .object({
    sessionId: z.string().uuid(),
    userId: z.string().uuid(),
    email: z.string().email().nullable(),
  })
  .strict()

const refreshInspectionSchema = z
  .object({
    sessionId: z.string().uuid(),
    userId: z.string().uuid(),
  })
  .strict()

export async function POST(request: Request) {
  const parsed = cliSessionRefreshRequestSchema.safeParse(
    await request.json().catch(() => null)
  )
  if (!parsed.success || !isCliRefreshToken(parsed.data.refreshToken)) {
    return privateError("invalid_request", 400)
  }

  const currentRefreshHash = hashAuthorizationSecret(parsed.data.refreshToken)
  const inspection = await inspectCliSessionRefresh({
    p_refresh_token_hash: currentRefreshHash,
  })
  const inspected = refreshInspectionSchema.safeParse(inspection.data)
  if (inspection.error || !inspected.success) {
    return privateError("session_expired", 401)
  }

  let issuedActorAccessToken: string | null = null
  try {
    const actorSession = await issueSupabaseCliActorSession(
      inspected.data.userId
    )
    issuedActorAccessToken = actorSession.access_token
    const actorAuthSessionId = await getAuthSessionId(actorSession)
    const accessToken = createCliAccessToken()
    const refreshToken = createCliRefreshToken()
    const expiries = cliCredentialExpiries()
    const result = await rotateCliSessionCredentials({
      p_refresh_token_hash: currentRefreshHash,
      p_next_access_token_hash: hashAuthorizationSecret(accessToken),
      p_next_refresh_token_hash: hashAuthorizationSecret(refreshToken),
      p_access_expires_at: expiries.accessExpiresAt.toISOString(),
      p_refresh_expires_at: expiries.refreshExpiresAt.toISOString(),
      p_actor_auth_session_id: actorAuthSessionId,
      p_actor_session_ciphertext: encryptCliActorSession(actorSession),
    })
    const rotated = rotatedSessionSchema.safeParse(result.data)
    if (result.error || !rotated.success) {
      throw new Error("cli_session_rotation_failed")
    }

    issuedActorAccessToken = null
    return NextResponse.json(
      cliSessionRefreshResponseSchema.parse({
        accessToken,
        refreshToken,
        expiresAt: expiries.accessExpiresAtSeconds,
        user: {
          id: rotated.data.userId,
          email: rotated.data.email,
        },
      }),
      { headers: privateCliAuthHeaders }
    )
  } catch {
    if (issuedActorAccessToken) {
      await revokeIssuedCliActorSession(issuedActorAccessToken).catch(
        () => undefined
      )
    }
    return privateError("session_expired", 401)
  }
}

function privateError(error: string, status: number) {
  return NextResponse.json(
    { error },
    { status, headers: privateCliAuthHeaders }
  )
}
