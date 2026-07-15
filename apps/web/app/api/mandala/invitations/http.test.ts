import { describe, expect, it } from "vitest"
import { CompanyInvitationError } from "@/lib/mandala/invitations"
import { invitationErrorResponse } from "./http"

describe("invitation HTTP errors", () => {
  it.each([
    ["session_replacement_required", 409],
    ["invitation_not_found", 404],
    ["invitation_expired", 410],
    ["invitation_revoked", 410],
    ["invitation_used", 410],
    ["invitation_superseded", 410],
    ["active_invitation_exists", 409],
    ["already_active_member", 409],
    ["invitation_not_pending", 409],
    ["invalid_invitation", 400],
    ["invitation_forbidden", 403],
  ])("maps %s without exposing provider details", async (code, status) => {
    const response = invitationErrorResponse(
      new CompanyInvitationError(code, "provider-secret-code")
    )
    expect(response.status).toBe(status)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    await expect(response.json()).resolves.toEqual({ error: code })
  })

  it("returns a generic result for unknown failures", async () => {
    const response = invitationErrorResponse(new Error("database details"))
    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      error: "invitation_failed",
    })
  })
})
