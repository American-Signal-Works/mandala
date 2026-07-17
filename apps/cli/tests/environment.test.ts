import { describe, expect, it } from "vitest"
import { join } from "node:path"
import { getApiUrl, getSupabaseEnvironment } from "../src/environment.js"
import { resolveConfigDirectory } from "../src/persistence.js"

describe("CLI endpoint security", () => {
  it("uses production by default and loopback only in explicit local mode", () => {
    expect(getApiUrl({})).toBe("https://mandala.md")
    expect(getApiUrl({ MANDALA_ENV: "local" })).toBe("http://127.0.0.1:3000")
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

describe("platform config paths", () => {
  it("uses the Windows roaming application-data directory", () => {
    const applicationData = "C:\\Users\\Example\\AppData\\Roaming"
    expect(
      resolveConfigDirectory(
        { APPDATA: applicationData },
        { homeDirectory: "C:\\Users\\Example", platform: "win32" }
      )
    ).toBe(join(applicationData, "Mandala"))
  })

  it("falls back to the conventional Windows profile directory", () => {
    const homeDirectory = "C:\\Users\\Example"
    expect(
      resolveConfigDirectory({}, { homeDirectory, platform: "win32" })
    ).toBe(join(homeDirectory, "AppData", "Roaming", "Mandala"))
  })

  it("keeps an explicit config directory on every platform", () => {
    expect(
      resolveConfigDirectory(
        { MANDALA_CONFIG_DIR: "D:\\MandalaData" },
        { homeDirectory: "C:\\Users\\Example", platform: "win32" }
      )
    ).toBe("D:\\MandalaData")
  })
})
