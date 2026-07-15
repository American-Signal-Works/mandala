import { NextResponse } from "next/server"
import { CompanyInvitationError } from "@/lib/mandala/invitations"

export function privateInvitationJson(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "cache-control": "private, no-store" },
  })
}

export function invitationErrorResponse(error: unknown) {
  if (!(error instanceof CompanyInvitationError)) {
    return privateInvitationJson({ error: "invitation_failed" }, 500)
  }
  const status = statusForInvitationError(error)
  return privateInvitationJson({ error: error.code }, status)
}

function statusForInvitationError(error: CompanyInvitationError): number {
  if (error.code === "session_replacement_required") return 409
  if (
    error.code === "invitation_not_found" ||
    error.code === "invitation_missing"
  )
    return 404
  if (
    [
      "invitation_expired",
      "invitation_revoked",
      "invitation_used",
      "invitation_superseded",
    ].includes(error.code)
  )
    return 410
  if (
    [
      "active_invitation_exists",
      "already_active_member",
      "invitation_not_pending",
      "invitation_accepted",
      "invitation_version_conflict",
    ].includes(error.code)
  )
    return 409
  if (error.code === "invalid_invitation") return 400
  if (error.code === "invitation_forbidden" || error.providerCode === "42501")
    return 403
  return 500
}
