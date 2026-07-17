import { NextResponse } from "next/server"
import {
  cliDeviceAuthorizationTokenRequestSchema,
  cliDeviceAuthorizationTokenResponseSchema,
} from "@workspace/control-plane"
import { z } from "zod"

import {
  claimCliDeviceAuthorization,
  completeCliDeviceAuthorization,
  issueSupabaseCliActorSession,
  loadCliCompany,
  releaseCliDeviceAuthorization,
  revokeIssuedCliActorSession,
} from "@/actions/admin/cli-auth"
import {
  authorizationClaimSchema,
  cliCredentialExpiries,
  createCliAccessToken,
  createCliRefreshToken,
  encryptCliActorSession,
  getAuthSessionId,
  hashAuthorizationSecret,
  privateCliAuthHeaders,
} from "@/lib/mandala/cli-auth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const completedExchangeSchema = z
  .object({ sessionId: z.string().uuid(), companyId: z.string().uuid() })
  .strict()

export async function POST(request: Request) {
  const parsed = cliDeviceAuthorizationTokenRequestSchema.safeParse(
    await request.json().catch(() => null)
  )
  if (!parsed.success) {
    return privateResponse({ status: "invalid_device_code" }, 400)
  }

  const { data, error } = await claimCliDeviceAuthorization({
    p_device_code_hash: hashAuthorizationSecret(parsed.data.deviceCode),
  })
  const claim = authorizationClaimSchema.safeParse(data)
  if (error || !claim.success) {
    return privateError("token_exchange_failed", 500)
  }

  if (claim.data.status !== "exchange_ready") {
    return privateResponse(
      cliDeviceAuthorizationTokenResponseSchema.parse(claim.data)
    )
  }

  let issuedActorAccessToken: string | null = null
  try {
    const accessToken = createCliAccessToken()
    const refreshToken = createCliRefreshToken()
    const expiries = cliCredentialExpiries()
    const [actorSession, companyResult] = await Promise.all([
      issueSupabaseCliActorSession(claim.data.userId),
      loadCliCompany(claim.data.companyId),
    ])
    issuedActorAccessToken = actorSession.access_token
    const user = actorSession.user
    if (
      user.id !== claim.data.userId ||
      companyResult.error ||
      !companyResult.data
    ) {
      throw new Error("cli_company_unavailable")
    }

    const actorAuthSessionId = await getAuthSessionId(actorSession)
    const completed = await completeCliDeviceAuthorization({
      p_authorization_id: claim.data.authorizationId,
      p_exchange_nonce: claim.data.exchangeNonce,
      p_access_token_hash: hashAuthorizationSecret(accessToken),
      p_refresh_token_hash: hashAuthorizationSecret(refreshToken),
      p_access_expires_at: expiries.accessExpiresAt.toISOString(),
      p_refresh_expires_at: expiries.refreshExpiresAt.toISOString(),
      p_actor_auth_session_id: actorAuthSessionId,
      p_actor_session_ciphertext: encryptCliActorSession(actorSession),
    })
    const completedExchange = completedExchangeSchema.safeParse(completed.data)
    if (completed.error || !completedExchange.success) {
      throw completed.error ?? new Error("cli_exchange_completion_invalid")
    }

    return privateResponse(
      cliDeviceAuthorizationTokenResponseSchema.parse({
        status: "authorized",
        sessionId: completedExchange.data.sessionId,
        accessToken,
        refreshToken,
        expiresAt: expiries.accessExpiresAtSeconds,
        user: {
          id: user.id,
          email: user.email ?? null,
        },
        company: companyResult.data,
      })
    )
  } catch {
    if (issuedActorAccessToken) {
      await revokeIssuedCliActorSession(issuedActorAccessToken).catch(
        () => undefined
      )
    }
    try {
      await releaseCliDeviceAuthorization({
        p_authorization_id: claim.data.authorizationId,
        p_exchange_nonce: claim.data.exchangeNonce,
      })
    } catch {
      // The device request remains short-lived even if its claim cannot be
      // released after a failed credential exchange.
    }
    return privateError("token_exchange_failed", 500)
  }
}

function privateResponse(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: privateCliAuthHeaders })
}

function privateError(error: string, status: number) {
  return privateResponse({ error }, status)
}
