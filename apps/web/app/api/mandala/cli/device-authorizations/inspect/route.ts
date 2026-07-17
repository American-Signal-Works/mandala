import { NextResponse } from "next/server"
import { cliDeviceAuthorizationInspectionSchema } from "@workspace/control-plane"

import { inspectCliDeviceAuthorization } from "@/actions/admin/cli-auth"
import {
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
  const auth = await authenticateRequest(request)
  if (!auth || auth.authMode !== "cookie") {
    return NextResponse.json(
      { error: "unauthorized" },
      { status: 401, headers: privateCliAuthHeaders }
    )
  }

  const browserToken = readBrowserAuthorizationToken(request)
  if (!browserToken) {
    return NextResponse.json(
      { error: "request_missing" },
      { status: 400, headers: privateCliAuthHeaders }
    )
  }

  const { data, error } = await inspectCliDeviceAuthorization({
    p_actor_user_id: auth.user.id,
    p_browser_token_hash: hashAuthorizationSecret(browserToken),
    p_subject_hash: requestSubjectHash(request),
  })
  if (error) return rpcError()

  const inspection = cliDeviceAuthorizationInspectionSchema.safeParse(data)
  if (!inspection.success) {
    const handled = cliAuthorizationOperationErrorSchema.safeParse(data)
    return handled.success ? handledError(handled.data.error) : rpcError()
  }
  return NextResponse.json(inspection.data, { headers: privateCliAuthHeaders })
}

function handledError(error: string) {
  const status =
    error === "rate_limited" ? 429 : error === "not_found" ? 404 : 500
  return NextResponse.json(
    {
      error:
        status === 404
          ? "request_not_found"
          : status === 429
            ? "rate_limited"
            : "authorization_lookup_failed",
    },
    { status, headers: privateCliAuthHeaders }
  )
}

function rpcError() {
  return NextResponse.json(
    { error: "authorization_lookup_failed" },
    { status: 500, headers: privateCliAuthHeaders }
  )
}
