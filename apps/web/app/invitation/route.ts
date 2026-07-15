import { NextResponse } from "next/server"
import { invitationTokenRequestSchema } from "@workspace/control-plane"
import {
  createInvitationHandoff,
  INVITATION_HANDOFF_COOKIE,
  INVITATION_HANDOFF_MAX_AGE_SECONDS,
} from "@/lib/mandala/invitation-handoff"
import { createClient } from "@/lib/supabase/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  const url = new URL(request.url)
  const parsed = invitationTokenRequestSchema.safeParse({
    token: url.searchParams.get("token"),
  })
  if (!parsed.success) {
    return invitationRedirect(url, "/sign-up?invitation=missing")
  }

  try {
    const handoff = await createInvitationHandoff(parsed.data.token)
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    const response = invitationRedirect(
      url,
      user ? "/invitation/complete" : "/sign-up?invitation=pending"
    )
    response.cookies.set({
      name: INVITATION_HANDOFF_COOKIE,
      value: handoff.tokenRecordId,
      httpOnly: true,
      maxAge: INVITATION_HANDOFF_MAX_AGE_SECONDS,
      path: "/invitation",
      sameSite: "lax",
      secure: url.protocol === "https:",
    })
    return response
  } catch (error) {
    const code =
      error instanceof Error && error.message === "invitation_expired"
        ? "expired"
        : "unavailable"
    return invitationRedirect(url, `/sign-up?invitation=${code}`)
  }
}

function invitationRedirect(url: URL, path: string) {
  const response = NextResponse.redirect(new URL(path, url.origin), 303)
  response.headers.set("Cache-Control", "private, no-store, max-age=0")
  response.headers.set("Pragma", "no-cache")
  response.headers.set("Referrer-Policy", "no-referrer")
  response.headers.set("X-Robots-Tag", "noindex, nofollow")
  return response
}
