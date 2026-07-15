import { NextResponse } from "next/server"

import {
  parseAuthCallback,
  type AuthCallbackFailure,
} from "@/lib/auth/callback"
import {
  encodePendingAuthSession,
  PENDING_AUTH_COOKIE,
  PENDING_AUTH_COOKIE_PATH,
  PENDING_AUTH_MAX_AGE_SECONDS,
} from "@/lib/auth/pending-session"
import {
  AUTH_CONTINUATION_COOKIE,
  AUTH_CONTINUATION_COOKIE_PATH,
  AUTH_SUCCESS_PATH,
  getSafePostAuthPath,
} from "@/lib/auth/redirect"
import {
  completeAuthCallback,
  hasAuthenticatedUser,
} from "@/lib/auth/server-callback"
import { createClient } from "@/lib/supabase/server"

export async function GET(request: Request) {
  const url = new URL(request.url)
  const parsed = parseAuthCallback(url)

  if (!parsed.ok) {
    return callbackFailure(url, parsed.failure)
  }

  const continuation = getSafePostAuthPath(
    url.searchParams.get("next") ??
      readCookie(request, AUTH_CONTINUATION_COOKIE)
  )
  const supabase = await createClient()
  const currentSession = await supabase.auth.getUser()

  if (hasAuthenticatedUser(currentSession)) {
    const response = callbackFailure(url, "session_replacement_required")
    response.cookies.set({
      name: PENDING_AUTH_COOKIE,
      value: encodePendingAuthSession({
        credential: parsed.credential,
        continuation,
        version: 1,
      }),
      httpOnly: true,
      maxAge: PENDING_AUTH_MAX_AGE_SECONDS,
      path: PENDING_AUTH_COOKIE_PATH,
      sameSite: "strict",
      secure: url.protocol === "https:",
    })
    return response
  }

  const result = await completeAuthCallback(supabase, parsed.credential)
  if (!result.ok) {
    return callbackFailure(url, result.failure)
  }

  return authRedirect(url, continuation || AUTH_SUCCESS_PATH)
}

function callbackFailure(url: URL, failure: AuthCallbackFailure) {
  const destination = new URL("/login", url.origin)
  destination.searchParams.set("error", failure)
  return authRedirect(url, destination.pathname + destination.search)
}

function authRedirect(requestUrl: URL, path: string) {
  const response = NextResponse.redirect(new URL(path, requestUrl.origin), 303)
  response.cookies.set({
    name: AUTH_CONTINUATION_COOKIE,
    value: "",
    expires: new Date(0),
    httpOnly: true,
    path: AUTH_CONTINUATION_COOKIE_PATH,
    sameSite: "strict",
    secure: requestUrl.protocol === "https:",
  })
  response.headers.set("Cache-Control", "private, no-store, max-age=0")
  response.headers.set("Pragma", "no-cache")
  response.headers.set("Referrer-Policy", "no-referrer")
  response.headers.set("X-Robots-Tag", "noindex, nofollow")
  return response
}

function readCookie(request: Request, name: string) {
  const cookieHeader = request.headers.get("cookie") ?? ""
  for (const part of cookieHeader.split(";")) {
    const [candidate, ...value] = part.trim().split("=")
    if (candidate === name) return decodeURIComponent(value.join("="))
  }
  return null
}
