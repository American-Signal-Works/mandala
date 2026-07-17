import { NextResponse } from "next/server"
import { cliDeviceAuthorizationBootstrapRequestSchema } from "@workspace/control-plane"

import {
  CLI_AUTHORIZATION_COOKIE,
  CLI_AUTHORIZATION_COOKIE_MAX_AGE_SECONDS,
  CLI_AUTHORIZATION_COOKIE_PATH,
  privateCliAuthHeaders,
} from "@/lib/mandala/cli-auth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  if (!hasSameOrigin(request)) {
    return NextResponse.json(
      { error: "forbidden" },
      { status: 403, headers: privateCliAuthHeaders }
    )
  }

  const parsed = cliDeviceAuthorizationBootstrapRequestSchema.safeParse(
    await request.json().catch(() => null)
  )
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request" },
      { status: 400, headers: privateCliAuthHeaders }
    )
  }

  const response = NextResponse.json(
    { ready: true },
    { status: 201, headers: privateCliAuthHeaders }
  )
  response.cookies.set({
    name: CLI_AUTHORIZATION_COOKIE,
    value: parsed.data.browserToken,
    httpOnly: true,
    maxAge: CLI_AUTHORIZATION_COOKIE_MAX_AGE_SECONDS,
    path: CLI_AUTHORIZATION_COOKIE_PATH,
    sameSite: "lax",
    secure: new URL(request.url).protocol === "https:",
  })
  return response
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
