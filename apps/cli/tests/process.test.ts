import { execFile } from "node:child_process"
import { constants } from "node:fs"
import { access, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { promisify } from "node:util"
import { describe, expect, it } from "vitest"

const executeFile = promisify(execFile)

describe("spawned mandala executable", () => {
  it.skipIf(process.platform === "win32")(
    "keeps the built command executable on POSIX systems",
    async () => {
      await expect(
        access("dist/index.js", constants.X_OK)
      ).resolves.toBeUndefined()
    }
  )

  it("launches in a pseudo-terminal and exits through a slash command", async () => {
    const output = await runExpect(`
      set timeout 10
      set entry $env(MANDALA_ENTRY)
      spawn -noecho $entry
      stty rows 40 columns 120
      expect "Mandala"
      expect "Ask Mandala"
      send "/quit"
      expect "> /quit"
      send "\\r"
      expect eof
    `)
    if (output === null) return

    expect(output).toContain("Mandala")
    expect(output).not.toContain("Available Commands")
  }, 15_000)

  it("exits a pseudo-terminal session on Ctrl-C", async () => {
    const output = await runExpect(`
      set timeout 10
      set entry $env(MANDALA_ENTRY)
      spawn -noecho $entry
      expect "Mandala"
      expect "Ask Mandala"
      send "\\003"
      expect eof
    `)
    if (output === null) return

    expect(output).toContain("Mandala")
  })

  it("prints bounded help and exits when no terminal is attached", async () => {
    const { stdout, stderr } = await executeFile(
      process.execPath,
      ["dist/index.js"],
      { cwd: process.cwd() }
    )

    expect(stderr).toBe("")
    expect(stdout).toContain("mandala [command]")
    expect(stdout).toContain("Interactive session")
  })

  it("emits stable help JSON from a real child process", async () => {
    const { stdout, stderr } = await executeFile(
      process.execPath,
      ["dist/index.js", "help", "--json"],
      { cwd: process.cwd() }
    )

    expect(stderr).toBe("")
    expect(JSON.parse(stdout)).toMatchObject({
      ok: true,
      data: { usage: expect.stringContaining("mandala auth login") },
    })
  })

  it("treats shell syntax as inert text without invoking a shell", async () => {
    const phrase = "run fixture $(printf MANDALA_SHELL_EXECUTED)"
    const { stdout, stderr } = await executeFile(
      process.execPath,
      ["dist/index.js", "parse", phrase, "--json"],
      { cwd: process.cwd() }
    )

    expect(stderr).toBe("")
    expect(JSON.parse(stdout)).toMatchObject({
      ok: true,
      data: { status: "blocked", reasonCode: "multi_action_or_shell_syntax" },
    })
    expect(stdout).not.toContain("MANDALA_SHELL_EXECUTED")
  })
})

async function runExpect(script: string): Promise<string | null> {
  const expectPath = "/usr/bin/expect"
  try {
    await access(expectPath, constants.X_OK)
  } catch {
    return null
  }

  const configDirectory = await mkdtemp(join(tmpdir(), "mandala-pty-"))
  try {
    const { stdout } = await executeFile(expectPath, ["-c", script], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        MANDALA_CONFIG_DIR: configDirectory,
        MANDALA_ENTRY: resolve("dist/index.js"),
      },
    })
    return stdout
  } finally {
    await rm(configDirectory, { force: true, recursive: true })
  }
}
