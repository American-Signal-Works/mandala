import { describe, expect, it } from "vitest"

import {
  classifyAuthCallbackError,
  getAuthCallbackFailureMessage,
  parseAuthCallback,
} from "./callback"

describe("auth callback helpers", () => {
  it("accepts one PKCE code or legacy OTP hash but rejects mixed credentials", () => {
    expect(
      parseAuthCallback(new URL("https://mandala.md/callback?code=valid-code"))
    ).toEqual({
      ok: true,
      credential: { kind: "code", value: "valid-code" },
    })
    expect(
      parseAuthCallback(
        new URL(
          "https://mandala.md/callback?token_hash=valid-token&type=signup"
        )
      )
    ).toEqual({
      ok: true,
      credential: { kind: "otp", type: "signup", value: "valid-token" },
    })
    expect(
      parseAuthCallback(
        new URL(
          "https://mandala.md/callback?code=valid-code&token_hash=valid-token"
        )
      )
    ).toEqual({ ok: false, failure: "malformed" })
  })

  it("classifies missing, malformed, and provider-failed callback inputs", () => {
    expect(parseAuthCallback(new URL("https://mandala.md/callback"))).toEqual({
      ok: false,
      failure: "missing",
    })
    expect(
      parseAuthCallback(new URL("https://mandala.md/callback?code=short"))
    ).toEqual({ ok: false, failure: "malformed" })
    expect(
      parseAuthCallback(
        new URL("https://mandala.md/callback?error=access_denied")
      )
    ).toEqual({ ok: false, failure: "provider_failed" })
  })

  it("uses stable Supabase error codes for expiry and replay classification", () => {
    expect(classifyAuthCallbackError({ code: "flow_state_expired" })).toBe(
      "expired"
    )
    expect(classifyAuthCallbackError({ code: "flow_state_not_found" })).toBe(
      "replayed"
    )
    expect(classifyAuthCallbackError({ code: "bad_code_verifier" })).toBe(
      "malformed"
    )
    expect(classifyAuthCallbackError(new Error("secret provider detail"))).toBe(
      "provider_failed"
    )
  })

  it("returns safe user copy without exposing provider details", () => {
    expect(getAuthCallbackFailureMessage("expired")).toContain("expired")
    expect(getAuthCallbackFailureMessage("replayed")).toContain("already used")
    expect(getAuthCallbackFailureMessage("provider_failed")).not.toContain(
      "provider"
    )
  })
})
