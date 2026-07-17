import { NextResponse } from "next/server"
import {
  cliDeviceAuthorizationDecisionRequestSchema,
  cliDeviceAuthorizationDecisionResponseSchema,
} from "@workspace/control-plane"

import { decideCliDeviceAuthorization } from "@/actions/admin/cli-auth"
import {
  CLI_AUTHORIZATION_COOKIE,
  CLI_AUTHORIZATION_COOKIE_PATH,
  cliAuthorizationOperationErrorSchema,
  hashAuthorizationSecret,
  privateCliAuthHeaders,
  readBrowserAuthorizationToken,
  requestSubjectHash,
} from "@/lib/mandala/cli-auth"
import { authenticateRequest } from "@/lib/supabase/request"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  if (!hasSameOrigin(request)) {
    return NextResponse.json(
      { error: "forbidden" },
      { status: 403, headers: privateCliAuthHeaders }
    )
  }

  const auth = await authenticateRequest(request)
  if (!auth || auth.authMode !== "cookie") {
    return NextResponse.json(
      { error: "unauthorized" },
      { status: 401, headers: privateCliAuthHeaders }
    )
  }

  const parsed = cliDeviceAuthorizationDecisionRequestSchema.safeParse(
    await request.json().catch(() => null)
  )
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request" },
      { status: 400, headers: privateCliAuthHeaders }
    )
  }

  const browserToken = readBrowserAuthorizationToken(request)
  if (!browserToken) {
    return NextResponse.json(
      { error: "request_missing" },
      { status: 400, headers: privateCliAuthHeaders }
    )
  }

  const { data, error } = await decideCliDeviceAuthorization({
    p_actor_user_id: auth.user.id,
    p_browser_token_hash: hashAuthorizationSecret(browserToken),
    p_subject_hash: requestSubjectHash(request),
    p_decision: parsed.data.decision,
    p_company_id: parsed.data.companyId ?? null,
  })
  if (error) return rpcError()

  const decision = cliDeviceAuthorizationDecisionResponseSchema.safeParse(data)
  if (!decision.success) {
    const handled = cliAuthorizationOperationErrorSchema.safeParse(data)
    return handled.success ? handledError(handled.data.error) : rpcError()
  }
  const response = NextResponse.json(decision.data, {
    headers: privateCliAuthHeaders,
  })
  response.cookies.set({
    name: CLI_AUTHORIZATION_COOKIE,
    value: "",
    expires: new Date(0),
    httpOnly: true,
    path: CLI_AUTHORIZATION_COOKIE_PATH,
    sameSite: "lax",
    secure: new URL(request.url).protocol === "https:",
  })
  return response
}

function handledError(error: string) {
  const status =
    error === "rate_limited"
      ? 429
      : error === "not_found"
        ? 404
        : error === "expired" || error === "already_decided"
          ? 409
          : error === "forbidden"
            ? 403
            : 500
  return NextResponse.json(
    {
      error:
        status === 404
          ? "request_not_found"
          : status === 429
            ? "rate_limited"
            : status === 409
              ? "authorization_unavailable"
              : status === 403
                ? "workspace_forbidden"
                : "authorization_decision_failed",
    },
    { status, headers: privateCliAuthHeaders }
  )
}

function rpcError() {
  return NextResponse.json(
    { error: "authorization_decision_failed" },
    { status: 500, headers: privateCliAuthHeaders }
  )
}

function hasSameOrigin(request: Request) {
  const origin = request.headers.get("origin")
  if (!origin) return false
  try {
    return new URL(origin).origin === new URL(request.url).origin
  } catch {
    return false
  }
}
