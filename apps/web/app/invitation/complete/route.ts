import { NextResponse } from "next/server"
import { z } from "zod"
import {
  acceptInvitationHandoff,
  INVITATION_HANDOFF_COOKIE,
} from "@/lib/mandala/invitation-handoff"
import { CompanyInvitationError } from "@/lib/mandala/invitations"
import { authenticateRequest } from "@/lib/supabase/request"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const tokenRecordIdSchema = z.string().uuid()

export async function GET(request: Request) {
  const url = new URL(request.url)
  const tokenRecordId = tokenRecordIdSchema.safeParse(
    readCookie(request, INVITATION_HANDOFF_COOKIE)
  )
  if (!tokenRecordId.success) {
    return invitationRedirect(url, "/sign-up?invitation=missing", true)
  }

  const auth = await authenticateRequest(request)
  if (!auth) {
    return invitationRedirect(url, "/sign-up?invitation=pending")
  }

  try {
    await acceptInvitationHandoff({
      supabase: auth.supabase,
      tokenRecordId: tokenRecordId.data,
    })
    return invitationRedirect(url, "/login?auth=success", true)
  } catch (error) {
    if (
      error instanceof CompanyInvitationError &&
      error.code === "session_replacement_required"
    ) {
      return invitationRedirect(
        url,
        "/sign-up?invitation=pending&error=session_replacement_required"
      )
    }
    const state =
      error instanceof CompanyInvitationError &&
      error.code === "invitation_expired"
        ? "expired"
        : "unavailable"
    return invitationRedirect(url, `/sign-up?invitation=${state}`, true)
  }
}

function readCookie(request: Request, name: string) {
  const cookieHeader = request.headers.get("cookie") ?? ""
  for (const part of cookieHeader.split(";")) {
    const [candidate, ...value] = part.trim().split("=")
    if (candidate === name) return value.join("=")
  }
  return null
}

function invitationRedirect(url: URL, path: string, clearHandoff = false) {
  const response = NextResponse.redirect(new URL(path, url.origin), 303)
  response.headers.set("Cache-Control", "private, no-store, max-age=0")
  response.headers.set("Pragma", "no-cache")
  response.headers.set("Referrer-Policy", "no-referrer")
  response.headers.set("X-Robots-Tag", "noindex, nofollow")
  if (clearHandoff) {
    response.cookies.set({
      name: INVITATION_HANDOFF_COOKIE,
      value: "",
      expires: new Date(0),
      httpOnly: true,
      path: "/invitation",
      sameSite: "lax",
    })
  }
  return response
}
