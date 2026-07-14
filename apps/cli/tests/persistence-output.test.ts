import { mkdtemp, readFile, readdir, stat, symlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Writable } from "node:stream"
import { afterEach, describe, expect, it } from "vitest"
import { redactSecrets, writeFailure, writeSuccess } from "../src/output.js"
import { SecureStore } from "../src/persistence.js"

const directories: string[] = []
const userId = "10000000-0000-4000-8000-000000000001"

afterEach(async () => {
  const { rm } = await import("node:fs/promises")
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true }))
  )
})

describe("secure local persistence", () => {
  it("atomically writes owner-only config and session files", async () => {
    const directory = await temporaryDirectory()
    const store = new SecureStore(directory)

    await store.writeConfig({
      schemaVersion: 1,
      mode: "mock",
      selectedCompany: {
        id: "20000000-0000-4000-8000-000000000001",
        name: "Example",
      },
    })
    await store.writeSession({
      schemaVersion: 1,
      accessToken: "access-secret",
      refreshToken: "refresh-secret",
      expiresAt: 2_000_000_000,
      user: { id: userId, email: "user@example.com" },
    })

    if (process.platform !== "win32") {
      expect((await stat(directory)).mode & 0o777).toBe(0o700)
      expect((await stat(store.configPath)).mode & 0o777).toBe(0o600)
      expect((await stat(store.sessionPath)).mode & 0o777).toBe(0o600)
    }
    expect(await readdir(directory)).toEqual(["config.json", "session.json"])
    expect(await store.readSession()).toMatchObject({
      accessToken: "access-secret",
      refreshToken: "refresh-secret",
    })
  })

  it("deletes the complete credential file on logout", async () => {
    const directory = await temporaryDirectory()
    const store = new SecureStore(directory)
    await store.writeSession({
      schemaVersion: 1,
      accessToken: "access-secret",
      refreshToken: "refresh-secret",
      expiresAt: 2_000_000_000,
      user: { id: userId, email: null },
    })

    await store.deleteSession()

    await expect(store.readSession()).resolves.toBeNull()
  })

  it("protects Windows sessions without storing plaintext tokens", async () => {
    const directory = await temporaryDirectory()
    const sessionProtector = {
      protect: async (value: string) =>
        Buffer.from(value.split("").reverse().join(""), "utf8").toString(
          "base64"
        ),
      unprotect: async (value: string) =>
        Buffer.from(value, "base64")
          .toString("utf8")
          .split("")
          .reverse()
          .join(""),
    }
    const store = new SecureStore(directory, {
      platform: "win32",
      sessionProtector,
    })
    await store.writeSession({
      schemaVersion: 1,
      accessToken: "access-secret",
      refreshToken: "refresh-secret",
      expiresAt: 2_000_000_000,
      user: { id: userId, email: "user@example.com" },
    })

    const source = await readFile(store.sessionPath, "utf8")
    expect(source).toContain('"protection": "windows-dpapi"')
    expect(source).not.toContain("access-secret")
    expect(source).not.toContain("refresh-secret")
    await expect(store.readSession()).resolves.toMatchObject({
      accessToken: "access-secret",
      refreshToken: "refresh-secret",
    })
  })

  it.skipIf(process.platform === "win32")(
    "refuses to write credentials through a symlinked config directory",
    async () => {
      const parent = await temporaryDirectory()
      const target = join(parent, "target")
      const link = join(parent, "linked-config")
      const { mkdir } = await import("node:fs/promises")
      await mkdir(target, { mode: 0o700 })
      await symlink(target, link, "dir")

      const store = new SecureStore(link)
      await expect(
        store.writeSession({
          schemaVersion: 1,
          accessToken: "access-secret",
          refreshToken: "refresh-secret",
          expiresAt: 2_000_000_000,
          user: { id: userId, email: null },
        })
      ).rejects.toMatchObject({ code: "unsafe_config_directory" })
      expect(await readdir(target)).toEqual([])
    }
  )
})

describe("secret-free output", () => {
  it("redacts credential and action-token fields recursively", () => {
    expect(
      redactSecrets({
        accessToken: "access-secret",
        nested: {
          refresh_token: "refresh-secret",
          executionToken: { id: "public", rawToken: "action-secret" },
          password: "password-secret",
          apiKey: "api-secret",
          private_key: "private-secret",
          credential: "credential-secret",
        },
      })
    ).toEqual({
      accessToken: "[REDACTED]",
      nested: {
        refresh_token: "[REDACTED]",
        executionToken: { id: "public", rawToken: "[REDACTED]" },
        password: "[REDACTED]",
        apiKey: "[REDACTED]",
        private_key: "[REDACTED]",
        credential: "[REDACTED]",
      },
    })
  })

  it("emits stable JSON envelopes without bearer values", () => {
    const stdout = new CaptureStream()
    const stderr = new CaptureStream()
    writeSuccess(
      { json: true, stdout, stderr },
      { rawToken: "action-secret", value: 1 }
    )
    writeFailure(
      { json: true, stdout, stderr },
      new Error("Bearer eyJheader.payload.signature should not be rendered")
    )

    expect(stdout.value).toContain('"ok":true')
    expect(stdout.value).not.toContain("action-secret")
    expect(stderr.value).not.toContain("eyJheader.payload.signature")
  })
})

class CaptureStream extends Writable {
  value = ""

  override _write(
    chunk: Buffer | string,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void
  ): void {
    this.value += chunk.toString()
    callback()
  }
}

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "mandala-cli-test-"))
  directories.push(directory)
  return directory
}
