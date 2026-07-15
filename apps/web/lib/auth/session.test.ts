import { describe, expect, it } from "vitest"

import { evaluateSessionBinding } from "./session"

describe("auth session binding", () => {
  it("reports an absent session without mutating anything", () => {
    expect(evaluateSessionBinding(null, "invitee@example.com")).toEqual({
      status: "session_absent",
    })
  })

  it("confirms the invited identity case-insensitively", () => {
    expect(
      evaluateSessionBinding(
        { id: "user_1", email: " Invitee@Example.com " },
        "invitee@example.com"
      )
    ).toEqual({ status: "session_confirmed", userId: "user_1" })
  })

  it("requires explicit confirmation for a different active session", () => {
    expect(
      evaluateSessionBinding(
        { id: "user_1", email: "other@example.com" },
        "invitee@example.com"
      )
    ).toEqual({
      status: "session_replacement_required",
      currentUserId: "user_1",
    })
  })
})
