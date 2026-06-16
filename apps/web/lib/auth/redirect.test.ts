import { afterEach, describe, expect, it, vi } from "vitest"

import { getEmailRedirectTo } from "./redirect"

describe("auth redirect helpers", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("builds the email callback URL from configured site URL", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://preview.vercel.app/")

    expect(getEmailRedirectTo()).toBe("https://preview.vercel.app/callback")
  })

  it("falls back to the current browser origin for email callbacks", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "")

    expect(getEmailRedirectTo()).toBe("http://localhost:3000/callback")
  })
})
