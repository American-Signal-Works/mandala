import { describe, expect, it } from "vitest"

import {
  createInviteAcceptedEmailPayload,
  createTeamRemovedEmailPayload,
  createWorkspaceInviteEmailPayload,
  WORKSPACE_INVITATION_EXPIRY_HOURS,
} from "../../../../supabase/functions/send-auth-email/_shared/transactional-email"

const shared = {
  fromAddress: "auth@example.com",
  workspaceLogoUrl: "https://cdn.example.com/acme-logo.png?size=48&mode=light",
  workspaceName: "Acme & Partners",
}

describe("Mandala workspace transactional emails", () => {
  it("renders the invitation in HTML and text and targets the invitee", () => {
    const payload = createWorkspaceInviteEmailPayload({
      ...shared,
      actionUrl: "https://app.mandala.md/invite/token?next=%2Fhome&from=email",
      inviterName: "Jordan <Owner>",
      recipientEmail: "invitee@example.com",
    })

    expect(payload).toMatchObject({
      from: "Mandala <auth@example.com>",
      tags: [{ name: "category", value: "workspace_invitation" }],
      to: ["invitee@example.com"],
    })
    expect(payload.html).toContain(
      "Jordan &lt;Owner&gt; invited you to join the workspace Acme &amp; Partners"
    )
    expect(payload.html).toContain("Join workspace")
    expect(payload.html).toContain(
      `expires after ${WORKSPACE_INVITATION_EXPIRY_HOURS} hours`
    )
    expect(payload.html).toContain(
      "https://app.mandala.md/invite/token?next=%2Fhome&amp;from=email"
    )
    expect(payload.text).toContain("Jordan <Owner>")
    expect(payload.text).toContain("https://app.mandala.md/invite/token")
    expect(payload.html).not.toContain("<Owner>")
  })

  it("uses the workspace logo, not an inviter avatar", () => {
    const payload = createWorkspaceInviteEmailPayload({
      ...shared,
      actionUrl: "https://app.mandala.md/invite/token",
      inviterName: "Jordan",
      recipientEmail: "invitee@example.com",
    })

    expect(payload.html).toContain('alt="Acme &amp; Partners workspace logo"')
    expect(payload.html).toContain(
      "https://cdn.example.com/acme-logo.png?size=48&amp;mode=light"
    )
    expect(payload.html).not.toContain("inviter avatar")
  })

  it.each([
    undefined,
    "",
    "http://cdn.example.com/logo.png",
    "javascript:alert(1)",
  ])("falls back safely when the workspace logo is %s", (workspaceLogoUrl) => {
    const payload = createWorkspaceInviteEmailPayload({
      ...shared,
      actionUrl: "https://app.mandala.md/invite/token",
      inviterName: "Jordan",
      recipientEmail: "invitee@example.com",
      workspaceLogoUrl,
    })

    expect(payload.html).toContain("mandala-workspace-fallback-light")
    expect(payload.html).toContain("mandala-workspace-fallback-dark")
    expect(payload.html).toContain("Acme &amp; Partners")
    expect(payload.html).not.toContain("javascript:")
  })

  it("renders the member-removed notice and targets the removed member", () => {
    const payload = createTeamRemovedEmailPayload({
      ...shared,
      removedMemberEmail: "former-member@example.com",
    })

    expect(payload).toMatchObject({
      tags: [{ name: "category", value: "workspace_member_removed" }],
      to: ["former-member@example.com"],
    })
    expect(payload.html).toContain(
      "You've been removed from the Acme &amp; Partners workspace"
    )
    expect(payload.text).toContain("Talk to your administrator")
    expect(payload.html).not.toContain("Join workspace")
  })

  it("renders acceptance confirmation and targets the inviter, never the invitee", () => {
    const payload = createInviteAcceptedEmailPayload({
      ...shared,
      inviterEmail: "owner@example.com",
      memberName: "Taylor <New Member>",
    })

    expect(payload).toMatchObject({
      tags: [{ name: "category", value: "workspace_invitation_accepted" }],
      to: ["owner@example.com"],
    })
    expect(payload.html).toContain(
      "Taylor &lt;New Member&gt; has joined the workspace Acme &amp; Partners"
    )
    expect(payload.text).toContain("Your invite was accepted")
    expect(payload.html).not.toContain("invitee@example.com")
  })

  it("keeps every template responsive, dark-safe, and readable without images", () => {
    const payloads = [
      createWorkspaceInviteEmailPayload({
        ...shared,
        actionUrl: "https://app.mandala.md/invite/token",
        inviterName: "Jordan",
        recipientEmail: "invitee@example.com",
      }),
      createTeamRemovedEmailPayload({
        ...shared,
        removedMemberEmail: "former-member@example.com",
      }),
      createInviteAcceptedEmailPayload({
        ...shared,
        inviterEmail: "owner@example.com",
        memberName: "Taylor",
      }),
    ]

    for (const payload of payloads) {
      expect(payload.html).toContain('name="viewport"')
      expect(payload.html).toContain('name="color-scheme" content="light dark"')
      expect(payload.html).toContain("@media (prefers-color-scheme: dark)")
      expect(payload.html).toContain(
        "@media only screen and (max-width: 620px)"
      )
      expect(payload.html).toContain(shared.workspaceName.replace("&", "&amp;"))
      expect(payload.text).toContain(shared.workspaceName)
    }
  })

  it("rejects non-HTTPS action URLs", () => {
    expect(() =>
      createWorkspaceInviteEmailPayload({
        ...shared,
        actionUrl: "javascript:alert(1)",
        inviterName: "Jordan",
        recipientEmail: "invitee@example.com",
      })
    ).toThrow("Transactional email input is invalid")
  })
})
