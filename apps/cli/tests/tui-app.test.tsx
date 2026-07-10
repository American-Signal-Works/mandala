import React from "react"
import { render } from "ink-testing-library"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  MandalaTui,
  matchingCommands,
  resolveTuiWidth,
  type CreateTuiSession,
  type TuiSessionController,
  type TuiSessionIo,
} from "../src/tui-app.js"

const selectedItem = {
  companyId: "20000000-0000-4000-8000-000000000001",
  id: "40000000-0000-4000-8000-000000000001",
  status: "approved",
  title: "Review purchase order",
}

afterEach(() => vi.restoreAllMocks())

describe("Ink TUI", () => {
  it("bounds live terminal widths and rejects implausible resize values", () => {
    expect(resolveTuiWidth(40, 80)).toBe(40)
    expect(resolveTuiWidth(119, 80)).toBe(119)
    expect(resolveTuiWidth(200, 80)).toBe(120)
    expect(resolveTuiWidth(1_190, 119)).toBe(119)
    expect(resolveTuiWidth(Number.POSITIVE_INFINITY, 100)).toBe(100)
  })

  it("renders a transient filtered slash palette without moving the slash", async () => {
    const harness = createHarness()
    const terminal = render(
      <MandalaTui
        color={false}
        createSession={harness.createSession}
        width={100}
      />
    )
    await waitFor(() => terminal.lastFrame()?.includes("Ask Mandala") === true)

    terminal.stdin.write("/")
    await waitFor(
      () => terminal.lastFrame()?.includes("/purchase-requests") === true
    )
    expect(terminal.lastFrame()).toContain("Up/Down select")

    terminal.stdin.write("pur")
    await waitFor(() => terminal.lastFrame()?.includes("> /pur") === true)
    expect(terminal.lastFrame()).toContain("/purchase-requests")

    terminal.stdin.write("\u001b")
    await waitFor(
      () => terminal.lastFrame()?.includes("Up/Down select") === false
    )
    expect(terminal.lastFrame()).toContain("> /pur")
    terminal.unmount()
  })

  it("completes argument commands with exactly one separating space", async () => {
    const harness = createHarness()
    const terminal = render(
      <MandalaTui
        color={false}
        createSession={harness.createSession}
        width={100}
      />
    )
    await waitFor(() => terminal.lastFrame()?.includes("Ask Mandala") === true)

    terminal.stdin.write("/op")
    await waitFor(() => terminal.lastFrame()?.includes("/open") === true)
    terminal.stdin.write("\t")
    await waitFor(() => terminal.lastFrame()?.includes("> /open") === true)

    terminal.stdin.write("1")
    await waitFor(() => terminal.lastFrame()?.includes("> /open 1") === true)
    terminal.stdin.write("\r")
    await waitFor(() => harness.lines.includes("/open 1"))

    expect(harness.lines).toEqual(["/open 1"])
    expect(harness.lines).not.toContain("/open1")
    terminal.unmount()
  })

  it("runs no-argument commands without moving the slash", async () => {
    const harness = createHarness()
    const terminal = render(
      <MandalaTui
        color={false}
        createSession={harness.createSession}
        width={100}
      />
    )
    await waitFor(() => terminal.lastFrame()?.includes("Ask Mandala") === true)
    terminal.stdin.write("/quit")
    await waitFor(() => terminal.lastFrame()?.includes("> /quit") === true)
    terminal.stdin.write("\r")
    await waitFor(() => harness.lines.includes("/quit"))

    expect(harness.lines).toEqual(["/quit"])
    expect(harness.lines).not.toContain("/ quit")
    terminal.unmount()
  })

  it("keeps loading transient and routes confirmation answers through the composer", async () => {
    const harness = createHarness({ confirmOnApprove: true })
    const terminal = render(
      <MandalaTui
        color={false}
        createSession={harness.createSession}
        width={100}
      />
    )
    await waitFor(() => terminal.lastFrame()?.includes("Ask Mandala") === true)

    terminal.stdin.write("/approve")
    await waitFor(() => terminal.lastFrame()?.includes("> /approve") === true)
    terminal.stdin.write("\r")
    await waitFor(
      () => terminal.lastFrame()?.includes("Approve this draft? [y/N]") === true
    )
    terminal.stdin.write("y")
    await waitFor(
      () =>
        terminal.lastFrame()?.includes("Approve this draft? [y/N] y") === true
    )
    terminal.stdin.write("\r")
    await waitFor(() => terminal.lastFrame()?.includes("Approved.") === true)

    expect(terminal.lastFrame()).not.toContain("Working...")
    expect(terminal.lastFrame()).toContain("Approve this draft? [y/N] y")
    terminal.unmount()
  })

  it("recalls submitted turns with Up and restores the empty draft with Down", async () => {
    const harness = createHarness()
    const terminal = render(
      <MandalaTui
        color={false}
        createSession={harness.createSession}
        width={100}
      />
    )
    await waitFor(() => terminal.lastFrame()?.includes("Ask Mandala") === true)
    terminal.stdin.write("hello")
    await waitFor(() => terminal.lastFrame()?.includes("> hello") === true)
    terminal.stdin.write("\r")
    await waitFor(() => harness.lines.includes("hello"))
    await waitFor(() => terminal.lastFrame()?.includes("Ask Mandala") === true)

    terminal.stdin.write("\u001b[A")
    await waitFor(
      () => (terminal.lastFrame()?.match(/> hello/g) ?? []).length === 2
    )
    terminal.stdin.write("\u001b[B")
    await waitFor(
      () => (terminal.lastFrame()?.match(/> hello/g) ?? []).length === 1
    )
    terminal.unmount()
  })

  it("only offers execute for an approved current selection", () => {
    expect(matchingCommands("/exec", {})).toEqual([])
    expect(
      matchingCommands("/exec", { selectedItem }).map(({ command }) => command)
    ).toEqual(["/execute"])
    expect(
      matchingCommands("/", {
        selectedItem: { ...selectedItem, status: "active" },
      }).map(({ command }) => command)
    ).not.toContain("/execute")
    const denyMatches = matchingCommands("/den", { selectedItem }).map(
      ({ command }) => command
    )
    const quitMatches = matchingCommands("/qui", { selectedItem }).map(
      ({ command }) => command
    )
    expect(denyMatches).toContain("/deny")
    expect(denyMatches).not.toContain("/reject")
    expect(quitMatches).toContain("/quit")
    expect(quitMatches).not.toContain("/exit")
    expect(
      matchingCommands("/rej", { selectedItem }).map(({ command }) => command)
    ).not.toContain("/reject")
    expect(
      matchingCommands("/exit", { selectedItem }).map(({ command }) => command)
    ).not.toContain("/exit")
  })
})

function createHarness(options: { confirmOnApprove?: boolean } = {}) {
  const lines: string[] = []
  let io: TuiSessionIo
  let exitRequested = false
  const createSession: CreateTuiSession = (sessionIo) => {
    io = sessionIo
    const session: TuiSessionController = {
      get exitRequested() {
        return exitRequested
      },
      clearState: vi.fn(),
      handleLine: async (line) => {
        lines.push(line)
        if (line === "/open 1") io.onSnapshot({ selectedItem })
        if (line === "/approve" && options.confirmOnApprove) {
          const answer = await io.ask("Approve this draft? [y/N] ")
          io.append(answer === "y" ? "Approved." : "Cancelled.")
        }
      },
      requestExit: () => {
        exitRequested = true
      },
      start: async () => {
        io.append("Mandala test header")
        io.onSnapshot({ selectedItem })
      },
    }
    return session
  }
  return { createSession, lines }
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let index = 0; index < 250; index += 1) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error("Timed out waiting for Ink render.")
}
