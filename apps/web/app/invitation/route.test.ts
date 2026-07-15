// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  acceptInvitationHandoff,
  createInvitationHandoff,
  INVITATION_HANDOFF_COOKIE,
} from "@/lib/mandala/invitation-handoff"
import { CompanyInvitationError } from "@/lib/mandala/invitations"
import { authenticateRequest } from "@/lib/supabase/request"
import { createClient } from "@/lib/supabase/server"
import { GET as completeInvitation } from "./complete/route"
import { GET as landInvitation } from "./route"

vi.mock("@/lib/mandala/invitation-handoff", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/lib/mandala/invitation-handoff")>()
  return {
    ...original,
    acceptInvitationHandoff: vi.fn(),
    createInvitationHandoff: vi.fn(),
  }
})
vi.mock("@/lib/supabase/request", () => ({ authenticateRequest: vi.fn() }))
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }))

const tokenRecordId = "30000000-0000-4000-8000-000000000001"
const rawToken = `mandala_invite_v1.${"a".repeat(43)}`

describe("invitation browser handoff", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(createInvitationHandoff).mockResolvedValue({ tokenRecordId })
    vi.mocked(createClient).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
      },
    } as never)
    vi.mocked(authenticateRequest).mockResolvedValue({
      authMode: "cookie",
      supabase: {},
      user: { id: "10000000-0000-4000-8000-000000000001" },
    } as never)
    vi.mocked(acceptInvitationHandoff).mockResolvedValue({
      companyId: "20000000-0000-4000-8000-000000000001",
      invitationId: "30000000-0000-4000-8000-000000000002",
      membershipId: "40000000-0000-4000-8000-000000000001",
      role: "owner",
      state: "accepted",
    })
  })

  it("cleans the raw token from the URL and stores only an opaque scoped cookie", async () => {
    const response = await landInvitation(
      new Request(`https://mandala.md/invitation?token=${rawToken}`)
    )

    expect(response.status).toBe(303)
    expect(response.headers.get("location")).toBe(
      "https://mandala.md/sign-up?invitation=pending"
    )
    const cookie = response.headers.get("set-cookie") ?? ""
    expect(cookie).toContain(`${INVITATION_HANDOFF_COOKIE}=${tokenRecordId}`)
    expect(cookie).toContain("HttpOnly")
    expect(cookie).toContain("Path=/invitation")
    expect(cookie).not.toContain(rawToken)
    expect(response.headers.get("location")).not.toContain(rawToken)
  })

  it("accepts automatically after authentication and clears the handoff", async () => {
    const response = await completeInvitation(
      new Request("https://mandala.md/invitation/complete", {
        headers: { cookie: `${INVITATION_HANDOFF_COOKIE}=${tokenRecordId}` },
      })
    )

    expect(response.status).toBe(303)
    expect(response.headers.get("location")).toBe(
      "https://mandala.md/login?auth=success"
    )
    expect(acceptInvitationHandoff).toHaveBeenCalledWith({
      supabase: {},
      tokenRecordId,
    })
    expect(response.headers.get("set-cookie")).toContain(
      "Expires=Thu, 01 Jan 1970 00:00:00 GMT"
    )
  })

  it("keeps the opaque handoff while the invited identity replaces another session", async () => {
    vi.mocked(acceptInvitationHandoff).mockRejectedValue(
      new CompanyInvitationError("session_replacement_required")
    )

    const response = await completeInvitation(
      new Request("https://mandala.md/invitation/complete", {
        headers: { cookie: `${INVITATION_HANDOFF_COOKIE}=${tokenRecordId}` },
      })
    )

    expect(response.headers.get("location")).toBe(
      "https://mandala.md/sign-up?invitation=pending&error=session_replacement_required"
    )
    expect(response.headers.get("set-cookie")).toBeNull()
  })
})
