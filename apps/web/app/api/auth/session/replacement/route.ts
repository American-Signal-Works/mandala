import { NextResponse } from "next/server"

import {
  decodePendingAuthSession,
  PENDING_AUTH_COOKIE,
  PENDING_AUTH_COOKIE_PATH,
} from "@/lib/auth/pending-session"
import { completeAuthCallback } from "@/lib/auth/server-callback"
import { createClient } from "@/lib/supabase/server"

export async function POST(request: Request) {
  if (!hasSameOrigin(request)) {
    return authJson({ status: "forbidden" }, 403)
  }

  const pending = decodePendingAuthSession(
    readCookie(request, PENDING_AUTH_COOKIE)
  )
  if (!pending) {
    return authJson({ status: "missing" }, 400)
  }

  const supabase = await createClient()
  const result = await completeAuthCallback(supabase, pending.credential)
  const response = result.ok
    ? authJson(
        {
          continuation: pending.continuation,
          status: "session_replaced",
        },
        200
      )
    : authJson({ status: result.failure }, 400)

  clearPendingCookie(response, request)
  return response
}

export async function DELETE(request: Request) {
  if (!hasSameOrigin(request)) {
    return authJson({ status: "forbidden" }, 403)
  }

  const response = authJson({ status: "session_replacement_cancelled" }, 200)
  clearPendingCookie(response, request)
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

function readCookie(request: Request, name: string) {
  const cookieHeader = request.headers.get("cookie") ?? ""
  for (const part of cookieHeader.split(";")) {
    const [candidate, ...value] = part.trim().split("=")
    if (candidate === name) {
      return value.join("=")
    }
  }
  return null
}

function clearPendingCookie(response: NextResponse, request: Request) {
  response.cookies.set({
    name: PENDING_AUTH_COOKIE,
    value: "",
    expires: new Date(0),
    httpOnly: true,
    path: PENDING_AUTH_COOKIE_PATH,
    sameSite: "strict",
    secure: new URL(request.url).protocol === "https:",
  })
}

function authJson(body: object, status: number) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      Pragma: "no-cache",
      "Referrer-Policy": "no-referrer",
      "X-Robots-Tag": "noindex, nofollow",
    },
  })
}
