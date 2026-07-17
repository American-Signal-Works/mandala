import { describe, expect, it } from "vitest"

import {
  cliDeviceAuthorizationCreateResponseSchema,
  cliDeviceAuthorizationDecisionRequestSchema,
  cliDeviceAuthorizationInspectionSchema,
  cliDeviceAuthorizationTokenResponseSchema,
  cliSessionListResponseSchema,
  cliSessionRevocationRequestSchema,
} from "../src/index.js"

const companyId = "20000000-0000-4000-8000-000000000001"

describe("hosted CLI authorization contracts", () => {
  it("accepts UTC offsets returned by Postgres timestamps", () => {
    expect(
      cliDeviceAuthorizationInspectionSchema.safeParse({
        authorizationId: "30000000-0000-4000-8000-000000000001",
        status: "pending",
        clientName: "Mandala CLI",
        clientVersion: "0.0.0",
        clientPlatform: "darwin-arm64",
        requestedScopes: ["workspace:control"],
        expiresAt: "2026-07-16T17:49:11.204+00:00",
        selectedCompanyId: null,
      }).success
    ).toBe(true)
  })

  it("requires an explicit workspace for approval but not denial", () => {
    expect(
      cliDeviceAuthorizationDecisionRequestSchema.safeParse({
        decision: "approve",
      }).success
    ).toBe(false)
    expect(
      cliDeviceAuthorizationDecisionRequestSchema.safeParse({
        decision: "approve",
        companyId,
      }).success
    ).toBe(true)
    expect(
      cliDeviceAuthorizationDecisionRequestSchema.safeParse({
        decision: "deny",
      }).success
    ).toBe(true)
  })

  it("does not expose a human-entered code in the browser handoff contract", () => {
    const result = cliDeviceAuthorizationCreateResponseSchema.parse({
      deviceCode: "d".repeat(43),
      verificationUri:
        "https://mandala.md/cli/authorize#request=" + "b".repeat(43),
      expiresAt: "2026-07-16T17:49:11.204+00:00",
      intervalSeconds: 5,
    })
    expect(result).not.toHaveProperty("userCode")
  })

  it("accepts polling states without allowing secrets in terminal responses", () => {
    expect(
      cliDeviceAuthorizationTokenResponseSchema.parse({
        status: "authorization_pending",
        intervalSeconds: 5,
      })
    ).toEqual({ status: "authorization_pending", intervalSeconds: 5 })
    expect(
      cliDeviceAuthorizationTokenResponseSchema.safeParse({
        status: "authorized",
        sessionId: "30000000-0000-4000-8000-000000000001",
        accessToken: "access",
        refreshToken: "refresh",
        expiresAt: 2_000_000_000,
        user: {
          id: "10000000-0000-4000-8000-000000000001",
          email: "user@example.com",
        },
        company: { id: companyId, name: "Example" },
        rawDeviceCode: "must-not-pass",
      }).success
    ).toBe(false)
  })

  it("keeps session listings non-secret and revocation narrowly addressed", () => {
    expect(
      cliSessionListResponseSchema.safeParse({
        sessions: [
          {
            id: "30000000-0000-4000-8000-000000000001",
            selectedCompanyId: companyId,
            scopes: ["workspace:control"],
            clientName: "Mandala CLI",
            clientVersion: "0.0.0",
            clientPlatform: "darwin-arm64",
            createdAt: "2026-07-16T00:00:00.000Z",
            lastUsedAt: "2026-07-16T00:01:00.000Z",
            revokedAt: null,
            refreshToken: "must-not-pass",
          },
        ],
      }).success
    ).toBe(false)
    expect(
      cliSessionRevocationRequestSchema.parse({
        sessionId: "30000000-0000-4000-8000-000000000001",
      })
    ).toEqual({ sessionId: "30000000-0000-4000-8000-000000000001" })
  })
})
