import { NextResponse } from "next/server"
import { z } from "zod"

import {
  AUTH_CONTINUATION_COOKIE,
  AUTH_CONTINUATION_COOKIE_PATH,
  AUTH_CONTINUATION_MAX_AGE_SECONDS,
  getEmailRedirectTo,
  getSafePostAuthPath,
} from "@/lib/auth/redirect"
import { normalizeEmail } from "@/lib/auth/validation"
import { createClient } from "@/lib/supabase/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const requestSchema = z
  .object({
    email: z.string().trim().email().max(320),
    postAuthPath: z.string().max(200).optional(),
    shouldCreateUser: z.boolean().optional().default(false),
  })
  .strict()

const privateHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow",
}

export async function POST(request: Request) {
  if (!hasSameOrigin(request)) {
    return NextResponse.json(
      { error: "forbidden" },
      { status: 403, headers: privateHeaders }
    )
  }

  const parsed = requestSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request" },
      { status: 400, headers: privateHeaders }
    )
  }

  const continuation = getSafePostAuthPath(parsed.data.postAuthPath)
  try {
    const supabase = await createClient()
    await supabase.auth.signInWithOtp({
      email: normalizeEmail(parsed.data.email),
      options: {
        emailRedirectTo: getEmailRedirectTo(continuation),
        shouldCreateUser: parsed.data.shouldCreateUser,
      },
    })
  } catch {
    // Provider and delivery failures stay server-private. Returning the same
    // result for every valid address prevents account-existence disclosure.
  }

  const response = NextResponse.json(
    { accepted: true },
    { status: 202, headers: privateHeaders }
  )
  response.cookies.set({
    name: AUTH_CONTINUATION_COOKIE,
    value: continuation,
    httpOnly: true,
    maxAge: AUTH_CONTINUATION_MAX_AGE_SECONDS,
    path: AUTH_CONTINUATION_COOKIE_PATH,
    // Magic links are opened from an email client, so this cookie must survive
    // a cross-site top-level navigation back to our callback. Lax keeps it out
    // of cross-site subrequests while allowing that deliberate navigation.
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
