import { describe, expect, it } from "vitest"

import { companyInvitationSchema } from "../src/invitations.js"

describe("companyInvitationSchema", () => {
  it("accepts the UTC offsets returned by PostgreSQL invitation projections", () => {
    expect(
      companyInvitationSchema.parse({
        invitationId: "30000000-0000-4000-8000-000000000001",
        companyId: "20000000-0000-4000-8000-000000000001",
        recipientEmail: "new-owner@example.test",
        state: "pending",
        version: 1,
        issuedAt: "2026-07-24T18:15:48.42729+00:00",
        expiresAt: "2026-07-27T18:15:48.372+00:00",
        deliveryId: "40000000-0000-4000-8000-000000000001",
      })
    ).toMatchObject({
      state: "pending",
      recipientEmail: "new-owner@example.test",
    })
  })
})
