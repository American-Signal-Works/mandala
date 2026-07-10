import { describe, expect, it } from "vitest"
import { getApiUrl, getSupabaseEnvironment } from "../src/environment.js"

describe("CLI endpoint security", () => {
  it("uses loopback-only defaults for local development", () => {
    expect(getApiUrl({})).toBe("http://127.0.0.1:3000")
    expect(getSupabaseEnvironment({})).toMatchObject({
      url: "http://127.0.0.1:54321",
      anonKey: expect.any(String),
    })
  })

  it.each([
    "http://localhost:3000",
    "http://127.0.0.1:54321",
    "http://[::1]:3000",
    "https://api.example.test",
  ])("accepts secure or loopback endpoint %s", (url) => {
    expect(getApiUrl({ MANDALA_API_URL: url })).toBe(url)
  })

  it("rejects remote plaintext API and Supabase endpoints", () => {
    expect(() =>
      getApiUrl({ MANDALA_API_URL: "http://api.example.test" })
    ).toThrowError(/must use HTTPS/)
    expect(() =>
      getSupabaseEnvironment({
        MANDALA_SUPABASE_URL: "http://supabase.example.test",
        MANDALA_SUPABASE_ANON_KEY: "anon-key",
      })
    ).toThrowError(/must use HTTPS/)
  })
})
