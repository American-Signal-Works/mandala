import { describe, expect, it } from "vitest"
import { modelTextSafetyViolation } from "./model-text-safety"

describe("model text safety", () => {
  it.each([
    "ghp_abcdefghijklmnopqrstuvwxyz1234567890",
    "github_pat_abcdefghijklmnopqrstuvwxyz1234567890",
    "xox" + "b-1234567890-abcdefghijklmnopqrstuv",
    "AKIA1234567890ABCDEF",
    `AIza${"A".repeat(35)}`,
  ])("rejects provider credential format %s", (value) => {
    expect(modelTextSafetyViolation(value)).toBe("credential_or_pii")
  })

  it("does not mistake ordinary provider discussion for a credential", () => {
    expect(modelTextSafetyViolation("Reconnect GitHub and Slack.")).toBeNull()
  })
})
