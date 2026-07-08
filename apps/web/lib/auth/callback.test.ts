import { describe, expect, it } from "vitest"

import { getCallbackPendingAction } from "./callback"

describe("auth callback helpers", () => {
  it("maps callback methods to auth loading actions", () => {
    expect(getCallbackPendingAction("email")).toBe("send")
    expect(getCallbackPendingAction("google")).toBe("google")
    expect(getCallbackPendingAction("microsoft")).toBe("microsoft")
  })

  it("falls back to the email loading action for older callback URLs", () => {
    expect(getCallbackPendingAction(undefined)).toBe("send")
    expect(getCallbackPendingAction("unknown")).toBe("send")
  })
})
