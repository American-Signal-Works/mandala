import { afterEach, describe, expect, it, vi } from "vitest"

import {
  AUTH_SUCCESS_PATH,
  getAuthCallbackUrl,
  getEmailRedirectTo,
  getSafePostAuthPath,
} from "./redirect"

describe("auth redirect helpers", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("builds the email callback URL from configured site URL", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://preview.vercel.app/")

    expect(getEmailRedirectTo()).toBe(
      "https://preview.vercel.app/callback"
    )
  })

  it("falls back to the current browser origin for email callbacks", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "")

    expect(getEmailRedirectTo()).toBe(
      "http://localhost:3000/callback"
    )
  })

  it("keeps callback URLs on the success screen by default", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://mandala.md")

    expect(getAuthCallbackUrl()).toBe(
      "https://mandala.md/callback?next=%2Flogin%3Fauth%3Dsuccess"
    )
  })

  it("tags callback URLs with the method when provided", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://mandala.md")

    expect(getAuthCallbackUrl(AUTH_SUCCESS_PATH, "google")).toBe(
      "https://mandala.md/callback?next=%2Flogin%3Fauth%3Dsuccess&method=google"
    )
  })

  it("rejects external and unapproved post-auth redirects", () => {
    expect(getSafePostAuthPath("https://evil.example.com/")).toBe(
      AUTH_SUCCESS_PATH
    )
    expect(getSafePostAuthPath("/settings")).toBe(AUTH_SUCCESS_PATH)
    expect(getSafePostAuthPath("/login?auth=success")).toBe(AUTH_SUCCESS_PATH)
    expect(getSafePostAuthPath("/")).toBe(AUTH_SUCCESS_PATH)
  })
})
