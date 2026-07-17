import { randomUUID } from "node:crypto"
import { NextResponse } from "next/server"
import {
  cliDeviceAuthorizationCreateRequestSchema,
  cliDeviceAuthorizationCreateResponseSchema,
} from "@workspace/control-plane"

import { createCliDeviceAuthorization } from "@/actions/admin/cli-auth"
import {
  createBrowserAuthorizationToken,
  createDeviceCode,
  hashAuthorizationSecret,
  privateCliAuthHeaders,
  productionSiteOrigin,
  requestSubjectHash,
} from "@/lib/mandala/cli-auth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  const parsed = cliDeviceAuthorizationCreateRequestSchema.safeParse(
    await request.json().catch(() => null)
  )
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request" },
      { status: 400, headers: privateCliAuthHeaders }
    )
  }

  const expiresAt = new Date(Date.now() + 10 * 60 * 1_000)

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const deviceCode = createDeviceCode()
    const browserToken = createBrowserAuthorizationToken()
    const { data, error } = await createCliDeviceAuthorization({
      p_id: randomUUID(),
      p_device_code_hash: hashAuthorizationSecret(deviceCode),
      p_browser_token_hash: hashAuthorizationSecret(browserToken),
      p_requester_hash: requestSubjectHash(request),
      p_client_name: parsed.data.clientName,
      p_client_version: parsed.data.clientVersion,
      p_client_platform: parsed.data.clientPlatform,
      p_requested_scopes: parsed.data.requestedScopes,
      p_expires_at: expiresAt.toISOString(),
    })

    if (!error) {
      const response = cliDeviceAuthorizationCreateResponseSchema.parse({
        deviceCode,
        verificationUri: browserAuthorizationUrl(request, browserToken),
        expiresAt: expiresAt.toISOString(),
        intervalSeconds:
          typeof data === "object" &&
          data !== null &&
          "intervalSeconds" in data &&
          typeof data.intervalSeconds === "number"
            ? data.intervalSeconds
            : 5,
      })
      return NextResponse.json(response, {
        status: 201,
        headers: privateCliAuthHeaders,
      })
    }

    if (error.code === "23505") continue
    if (error.message.includes("cli_authorization_rate_limited")) {
      return NextResponse.json(
        { error: "rate_limited" },
        {
          status: 429,
          headers: { ...privateCliAuthHeaders, "Retry-After": "600" },
        }
      )
    }
    break
  }

  return NextResponse.json(
    { error: "device_authorization_failed" },
    { status: 500, headers: privateCliAuthHeaders }
  )
}

function browserAuthorizationUrl(request: Request, browserToken: string) {
  const url = new URL("/cli/authorize", productionSiteOrigin(request))
  url.hash = new URLSearchParams({ request: browserToken }).toString()
  return url.toString()
}
