import { describe, expect, it } from "vitest"

import {
  companyDirectorySchema,
  companyInvitationSchema,
  invitationInspectionSchema,
} from "../src/invitations.js"

const offsetIssuedAt = "2026-07-24T18:15:48.42729+00:00"
const offsetExpiresAt = "2026-07-27T18:15:48.372+00:00"

describe("companyInvitationSchema", () => {
  it.each(["pending", "accepted", "revoked", "expired"] as const)(
    "accepts PostgreSQL offsets for a %s mutation result",
    (state) => {
      expect(
        companyInvitationSchema.parse({
          invitationId: "30000000-0000-4000-8000-000000000001",
          companyId: "20000000-0000-4000-8000-000000000001",
          recipientEmail: "new-owner@example.test",
          state,
          version: 1,
          issuedAt: offsetIssuedAt,
          expiresAt: offsetExpiresAt,
          deliveryId: "40000000-0000-4000-8000-000000000001",
        })
      ).toMatchObject({
        state,
        recipientEmail: "new-owner@example.test",
      })
    }
  )
})

describe("invitationInspectionSchema", () => {
  it.each([
    "valid",
    "used",
    "accepted",
    "superseded",
    "revoked",
    "expired",
  ] as const)("accepts the safe %s classification", (state) => {
    expect(
      invitationInspectionSchema.parse({
        state,
        workspaceName: "Invitation Workspace",
        expiresAt: offsetExpiresAt,
      })
    ).toEqual({
      state,
      workspaceName: "Invitation Workspace",
      expiresAt: offsetExpiresAt,
    })
  })

  it("keeps missing tokens non-identifying and rejects recipient leakage", () => {
    expect(invitationInspectionSchema.parse({ state: "missing" })).toEqual({
      state: "missing",
    })
    expect(() =>
      invitationInspectionSchema.parse({
        state: "missing",
        recipientEmail: "private@example.test",
      })
    ).toThrow()
  })
})

describe("companyDirectorySchema", () => {
  const directory = {
    members: [
      {
        membershipId: "50000000-0000-4000-8000-000000000001",
        userId: "10000000-0000-4000-8000-000000000001",
        email: "active@example.test",
        displayName: "Active Member",
        role: "owner",
        status: "active",
        joinedAt: offsetIssuedAt,
        updatedAt: offsetExpiresAt,
      },
      {
        membershipId: "50000000-0000-4000-8000-000000000002",
        userId: "10000000-0000-4000-8000-000000000002",
        email: "inactive@example.test",
        displayName: null,
        role: "viewer",
        status: "inactive",
        joinedAt: offsetIssuedAt,
        updatedAt: offsetExpiresAt,
      },
    ],
    pendingInvitations: [
      {
        invitationId: "30000000-0000-4000-8000-000000000001",
        recipientEmail: "pending@example.test",
        state: "pending",
        issuedAt: offsetIssuedAt,
        expiresAt: offsetExpiresAt,
        deliveryId: "40000000-0000-4000-8000-000000000001",
      },
    ],
  } as const

  it("accepts active, inactive, and pending records with PostgreSQL offsets", () => {
    expect(companyDirectorySchema.parse(directory)).toEqual(directory)
  })

  it("rejects malformed timestamp output", () => {
    expect(() =>
      companyDirectorySchema.parse({
        ...directory,
        members: [{ ...directory.members[0], joinedAt: "not-a-timestamp" }],
      })
    ).toThrow()
  })
})
