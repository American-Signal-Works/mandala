import { EventEmitter } from "node:events"
import React from "react"
import { render } from "ink-testing-library"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  MandalaTui,
  RESIZE_SETTLE_MS,
  clipItemWorkspaceContent,
  createSettledResizeOutput,
  inkRenderConfiguration,
  itemWorkspaceContentLines,
  matchingCommands,
  operationLabelForLine,
  projectComposerValue,
  resolveTuiWidth,
  sanitizeItemWorkspaceContent,
  windowItemActions,
  wrapItemWorkspaceContent,
  workspaceActionCommand,
  type CreateTuiSession,
  type TuiItemWorkspace,
  type TuiSessionController,
  type TuiSessionIo,
} from "../src/tui-app.js"

const selectedItem = {
  companyId: "20000000-0000-4000-8000-000000000001",
  id: "40000000-0000-4000-8000-000000000001",
  status: "approved",
  title: "Review purchase order",
}

const itemWorkspace: TuiItemWorkspace = {
  itemId: selectedItem.id,
  tabs: [
    {
      id: "overview",
      label: "Overview",
      content: "Overview details\nRecommendation details",
    },
    {
      id: "evidence",
      label: "Evidence",
      content: "Evidence current as of 10:42 AM",
    },
    { id: "draft", label: "Draft", content: "Draft quantity 24" },
    { id: "activity", label: "Activity", content: "Evidence refreshed" },
    {
      id: "actions",
      label: "Actions",
      content: "Choose an allowed action below.",
    },
  ],
  actions: [
    { value: "approve", label: "Approve" },
    { value: "edit", label: "Edit and approve" },
  ],
}

afterEach(() => vi.restoreAllMocks())

describe("Ink TUI", () => {
  it("uses coherent full-frame redraws so resize does not enter scrollback", () => {
    expect(inkRenderConfiguration).toMatchObject({
      alternateScreen: false,
      incrementalRendering: false,
    })
    expect(RESIZE_SETTLE_MS).toBeGreaterThanOrEqual(200)
  })

  it("redraws once after a burst of terminal resize events", async () => {
    vi.useFakeTimers()
    const rawOutput = new EventEmitter() as NodeJS.WriteStream
    Object.assign(rawOutput, {
      columns: 80,
      rows: 24,
      write: vi.fn(),
    })
    const settled = createSettledResizeOutput(rawOutput)
    const inkResize = vi.fn()
    const resized = vi.fn()
    settled.output.on("resize", inkResize)
    settled.output.on("resize", resized)

    rawOutput.emit("resize")
    Object.assign(rawOutput, { columns: 100, rows: 30 })
    rawOutput.emit("resize")
    Object.assign(rawOutput, { columns: 120, rows: 36 })
    rawOutput.emit("resize")

    expect(resized).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(RESIZE_SETTLE_MS - 1)
    expect(resized).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(inkResize).not.toHaveBeenCalled()
    expect(resized).toHaveBeenCalledTimes(1)
    expect(settled.output.columns).toBe(120)
    expect(settled.output.rows).toBe(36)

    settled.dispose()
    vi.useRealTimers()
  })

  it("bounds live terminal widths and rejects implausible resize values", () => {
    expect(resolveTuiWidth(39, 80)).toBe(39)
    expect(resolveTuiWidth(40, 80)).toBe(40)
    expect(resolveTuiWidth(119, 80)).toBe(119)
    expect(resolveTuiWidth(200, 80)).toBe(200)
    expect(resolveTuiWidth(240, 80)).toBe(240)
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
    expect(terminal.lastFrame()).toContain("↑↓ move")
    expect(terminal.lastFrame()).toContain("Decide")
    expect(terminal.lastFrame()).toContain("Inspect selected")
    expect(terminal.lastFrame()).toContain("Inbox")
    expect(terminal.lastFrame()).toMatch(/Inbox\n\s*>?\s*\/inbox/)

    terminal.stdin.write("pur")
    await waitFor(() => terminal.lastFrame()?.includes("> /pur") === true)
    expect(terminal.lastFrame()).toContain("/purchase-requests")

    terminal.stdin.write("\u001b")
    await waitFor(() => terminal.lastFrame()?.includes("↑↓ move") === false)
    expect(terminal.lastFrame()).toContain("> /pur")
    terminal.unmount()
  })

  it("recovers close command typos and explains distant searches", async () => {
    const harness = createHarness()
    const terminal = render(
      <MandalaTui
        color={false}
        createSession={harness.createSession}
        width={100}
      />
    )
    await waitFor(() => terminal.lastFrame()?.includes("Ask Mandala") === true)

    terminal.stdin.write("/inbxo")
    await waitFor(() => terminal.lastFrame()?.includes("/inbox") === true)
    expect(terminal.lastFrame()).not.toContain("No command matches")

    terminal.stdin.write("\u0015/zzzzzz")
    await waitFor(
      () => terminal.lastFrame()?.includes("No command matches") === true
    )
    expect(terminal.lastFrame()).toContain("Backspace to revise")
    terminal.stdin.write("\u001b")
    await waitFor(
      () => terminal.lastFrame()?.includes("No command matches") === false
    )
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

    terminal.stdin.write("/run")
    await waitFor(() => terminal.lastFrame()?.includes("/run-fixture") === true)
    terminal.stdin.write("\t")
    await waitFor(
      () => terminal.lastFrame()?.includes("> /run-fixture") === true
    )

    terminal.stdin.write("1")
    await waitFor(
      () => terminal.lastFrame()?.includes("> /run-fixture 1") === true
    )
    terminal.stdin.write("\r")
    await waitFor(() => harness.lines.includes("/run-fixture 1"))

    expect(harness.lines).toEqual(["/run-fixture 1"])
    expect(harness.lines).not.toContain("/run-fixture1")
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

  it("navigates a nested picker with arrows, Enter, and Escape", async () => {
    const harness = createHarness({ choiceOn: "/workspace" })
    const terminal = render(
      <MandalaTui
        color={false}
        createSession={harness.createSession}
        width={100}
      />
    )
    await waitFor(() => terminal.lastFrame()?.includes("Ask Mandala") === true)

    terminal.stdin.write("/workspace")
    await waitFor(() => terminal.lastFrame()?.includes("> /workspace") === true)
    terminal.stdin.write("\r")
    await waitFor(
      () => terminal.lastFrame()?.includes("Choose workspace") === true
    )
    expect(terminal.lastFrame()).toContain("> 1. Mandala Local Demo")
    expect(terminal.lastFrame()).toContain("Enter select")

    terminal.stdin.write("\u001b[B")
    await waitFor(
      () => terminal.lastFrame()?.includes("> 2. Acme Operations") === true
    )
    terminal.stdin.write("\r")
    await waitFor(() => harness.selections.includes("acme"))

    expect(terminal.lastFrame()).not.toContain("Selected: Acme Operations")
    expect(terminal.lastFrame()).toContain("Ask Mandala")
    terminal.unmount()
  })

  it("supports first/last and directional menu controls", async () => {
    const harness = createHarness({ choiceOn: "/workspace" })
    const terminal = render(
      <MandalaTui
        color={false}
        createSession={harness.createSession}
        width={100}
      />
    )
    await waitFor(() => terminal.lastFrame()?.includes("Ask Mandala") === true)

    terminal.stdin.write("/workspace")
    await waitFor(() => terminal.lastFrame()?.includes("> /workspace") === true)
    terminal.stdin.write("\r")
    await waitFor(
      () => terminal.lastFrame()?.includes("Choose workspace") === true
    )
    terminal.stdin.write("\u001b[F")
    await waitFor(
      () => terminal.lastFrame()?.includes("> 2. Acme Operations") === true
    )
    terminal.stdin.write("\u001b[C")
    await waitFor(() => harness.selections.includes("acme"))
    terminal.unmount()
  })

  it("supports numeric menu shortcuts", async () => {
    const harness = createHarness({ choiceOn: "/workspace" })
    const terminal = render(
      <MandalaTui
        color={false}
        createSession={harness.createSession}
        width={100}
      />
    )
    await waitFor(() => terminal.lastFrame()?.includes("Ask Mandala") === true)

    terminal.stdin.write("/workspace")
    await waitFor(() => terminal.lastFrame()?.includes("> /workspace") === true)
    terminal.stdin.write("\r")
    await waitFor(
      () => terminal.lastFrame()?.includes("Choose workspace") === true
    )
    terminal.stdin.write("1")
    await waitFor(() => harness.selections.includes("mandala"))
    terminal.unmount()
  })

  it("uses Ctrl-C to cancel the nearest menu before exiting", async () => {
    const harness = createHarness({ choiceOn: "/workspace" })
    const terminal = render(
      <MandalaTui
        color={false}
        createSession={harness.createSession}
        width={100}
      />
    )
    await waitFor(() => terminal.lastFrame()?.includes("Ask Mandala") === true)

    terminal.stdin.write("/workspace")
    await waitFor(() => terminal.lastFrame()?.includes("> /workspace") === true)
    terminal.stdin.write("\r")
    await waitFor(
      () => terminal.lastFrame()?.includes("Choose workspace") === true
    )
    terminal.stdin.write("\u0003")
    await waitFor(
      () => terminal.lastFrame()?.includes("Choose workspace") === false
    )
    expect(harness.exitRequested()).toBe(false)

    terminal.stdin.write("\u0003")
    await waitFor(() => harness.exitRequested())
  })

  it("runs guided login directly from the palette without requiring an email argument", async () => {
    const harness = createHarness()
    const terminal = render(
      <MandalaTui
        color={false}
        createSession={harness.createSession}
        width={100}
      />
    )
    await waitFor(() => terminal.lastFrame()?.includes("Ask Mandala") === true)
    terminal.stdin.write("/login")
    await waitFor(() => terminal.lastFrame()?.includes("> /login") === true)
    terminal.stdin.write("\r")
    await waitFor(() => harness.lines.includes("/login"))

    expect(harness.lines).toEqual(["/login"])
    terminal.unmount()
  })

  it("keeps loading transient and routes confirmation answers through the composer", async () => {
    const harness = createHarness({
      confirmOnApprove: true,
      snapshot: { selectedItem: { ...selectedItem, status: "active" } },
    })
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

  it("cancels the nearest guided prompt with Escape without exiting", async () => {
    const harness = createHarness({
      confirmOnApprove: true,
      snapshot: { selectedItem: { ...selectedItem, status: "active" } },
    })
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
    terminal.stdin.write("\u001b")
    await waitFor(
      () => terminal.lastFrame()?.includes("No changes were made") === true
    )
    expect(harness.exitRequested()).toBe(false)
    await waitFor(() => terminal.lastFrame()?.includes("Ask Mandala") === true)
    terminal.unmount()
  })

  it("explains that approval remains recorded when execution is cancelled", async () => {
    const harness = createHarness({
      confirmOnApprove: true,
      executeAfterApprove: true,
      snapshot: { selectedItem: { ...selectedItem, status: "active" } },
    })
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
    await waitFor(
      () =>
        terminal
          .lastFrame()
          ?.includes("Execute this approved action in Sandbox? [y/N]") === true
    )
    terminal.stdin.write("\u001b")
    await waitFor(
      () =>
        terminal
          .lastFrame()
          ?.includes("Execution cancelled. The approval remains recorded.") ===
        true
    )
    expect(harness.exitRequested()).toBe(false)
    terminal.unmount()
  })

  it("never displays or retains a pointer-sensitive edit value", async () => {
    const secret = "must-not-enter-transcript"
    expect(projectComposerValue(`/edit --set /rawToken=${secret}`)).toBe(
      "/edit --set /rawToken=[REDACTED]"
    )
    const harness = createHarness()
    const terminal = render(
      <MandalaTui
        color={false}
        createSession={harness.createSession}
        width={100}
      />
    )
    await waitFor(() => terminal.lastFrame()?.includes("Ask Mandala") === true)
    terminal.stdin.write(`/edit --set /rawToken=${secret}`)
    await waitFor(() => terminal.lastFrame()?.includes("*") === true)
    expect(terminal.lastFrame()).not.toContain(secret)
    terminal.stdin.write("\r")
    await waitFor(() => harness.lines.length === 1)
    expect(terminal.lastFrame()).not.toContain(secret)
    expect(terminal.lastFrame()).toContain("/rawToken=[REDACTED]")
    terminal.stdin.write("\u001b[A")
    await waitFor(() => terminal.lastFrame()?.includes("[REDACTED]") === true)
    expect(terminal.lastFrame()).not.toContain(secret)
    terminal.unmount()
  })

  it("uses operation-specific stable progress labels without color", async () => {
    expect(operationLabelForLine("/evidence")).toBe("Loading evidence")
    const harness = createHarness({ pauseOn: "/evidence" })
    const terminal = render(
      <MandalaTui
        color={false}
        createSession={harness.createSession}
        width={100}
      />
    )
    await waitFor(() => terminal.lastFrame()?.includes("Ask Mandala") === true)
    terminal.stdin.write("/evidence")
    await waitFor(() => terminal.lastFrame()?.includes("> /evidence") === true)
    terminal.stdin.write("\r")
    await waitFor(
      () => terminal.lastFrame()?.includes("Loading evidence...") === true
    )
    expect(terminal.lastFrame()).toMatch(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] Loading evidence\.\.\./)
    harness.release()
    await waitFor(() => terminal.lastFrame()?.includes("Ask Mandala") === true)
    terminal.unmount()
  })

  it("renders safe workspace and selected-item context with a next action", async () => {
    const harness = createHarness({
      snapshot: {
        environment: "local mock",
        workspace: { name: "Example workspace" },
        selectedItem: {
          ...selectedItem,
          itemType: "Purchase request",
          priority: "High",
          source: "Inventory signal",
          warningCount: 2,
          nextAction: "Review evidence, then decide",
        },
      },
    })
    const terminal = render(
      <MandalaTui
        color={false}
        createSession={harness.createSession}
        width={100}
      />
    )
    await waitFor(
      () => terminal.lastFrame()?.includes("Example workspace") === true
    )
    expect(terminal.lastFrame()).toContain("2 warnings")
    expect(terminal.lastFrame()).toContain("Review evidence, then decide")
    terminal.unmount()
  })

  it("shows Sandbox Mode beneath the composer only when Sandbox is on", async () => {
    const enabled = createHarness({
      snapshot: {
        sandboxEnabled: true,
        workspace: { name: "Example workspace" },
      },
    })
    const terminal = render(
      <MandalaTui
        color={false}
        createSession={enabled.createSession}
        width={100}
      />
    )
    await waitFor(() => terminal.lastFrame()?.includes("Sandbox Mode") === true)
    expect(terminal.lastFrame()).toMatch(/Ask Mandala[^\n]*\n● Sandbox Mode/)
    terminal.unmount()

    const disabled = createHarness({
      snapshot: {
        sandboxEnabled: false,
        workspace: { name: "Example workspace" },
      },
    })
    const disabledTerminal = render(
      <MandalaTui
        color={false}
        createSession={disabled.createSession}
        width={100}
      />
    )
    await waitFor(
      () => disabledTerminal.lastFrame()?.includes("Ask Mandala") === true
    )
    expect(disabledTerminal.lastFrame()).not.toContain("Sandbox Mode")
    disabledTerminal.unmount()
  })

  it("sanitizes OSC and forged-line controls in persistent context", async () => {
    const injection =
      "safe\u001b]8;;https://evil.example\u0007link\u001b]8;;\u0007\nforged"
    const harness = createHarness({
      snapshot: {
        environment: injection,
        workspace: { name: injection },
        selectedItem: { ...selectedItem, title: injection, source: injection },
      },
    })
    const terminal = render(
      <MandalaTui
        color={false}
        createSession={harness.createSession}
        width={100}
      />
    )
    await waitFor(
      () => terminal.lastFrame()?.includes("safelink forged") === true
    )
    expect(terminal.lastFrame()).not.toContain("\u001b]")
    expect(terminal.lastFrame()).not.toContain("\u0007")
    expect(terminal.lastFrame()).not.toContain("\nforged")
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

  it("updates one live assistant area and commits the finished answer once", async () => {
    const harness = createHarness({ itemWorkspace, streamOn: "why?" })
    const terminal = render(
      <MandalaTui
        color={false}
        createSession={harness.createSession}
        width={100}
      />
    )
    await waitFor(() => terminal.lastFrame()?.includes("Ask Mandala") === true)
    terminal.stdin.write("why?")
    await waitFor(() => terminal.lastFrame()?.includes("> why?") === true)
    terminal.stdin.write("\r")

    await waitFor(
      () => terminal.lastFrame()?.includes("Partial answer") === true
    )
    expect(terminal.lastFrame()).toContain("Responding...")
    expect(terminal.lastFrame()).toContain("[Overview]")
    expect(terminal.lastFrame()).toContain("Overview details")
    expect(terminal.lastFrame()?.match(/Partial answer/g)).toHaveLength(1)
    await waitFor(
      () => terminal.lastFrame()?.includes("Finished streamed answer") === true
    )

    expect(terminal.lastFrame()).not.toContain("Partial answer")
    expect(
      terminal.lastFrame()?.match(/Finished streamed answer/g)
    ).toHaveLength(1)
    terminal.unmount()
  })

  it("switches selected-item tabs in place without sending chat commands", async () => {
    const harness = createHarness({ itemWorkspace })
    const terminal = render(
      <MandalaTui
        color={false}
        createSession={harness.createSession}
        width={100}
      />
    )
    await waitFor(() => terminal.lastFrame()?.includes("[Overview]") === true)
    expect(terminal.lastFrame()).toContain("Overview details")

    terminal.stdin.write("\t")
    await waitFor(() => terminal.lastFrame()?.includes("[Evidence]") === true)

    expect(terminal.lastFrame()).toContain("Evidence current as of 10:42 AM")
    expect(terminal.lastFrame()).not.toContain("Overview details")
    expect(harness.lines).toEqual([])

    terminal.stdin.write("\u001b[Z")
    await waitFor(() => terminal.lastFrame()?.includes("[Overview]") === true)
    terminal.unmount()
  })

  it("keeps tab arrows available to the composer once typing starts", async () => {
    const harness = createHarness({ itemWorkspace })
    const terminal = render(
      <MandalaTui
        color={false}
        createSession={harness.createSession}
        width={100}
      />
    )
    await waitFor(() => terminal.lastFrame()?.includes("[Overview]") === true)

    terminal.stdin.write("ask")
    await waitFor(() => terminal.lastFrame()?.includes("> ask") === true)
    terminal.stdin.write("\u001b[C")
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(terminal.lastFrame()).toContain("[Overview]")
    expect(terminal.lastFrame()).not.toContain("[Evidence]")
    expect(terminal.lastFrame()).toContain("> ask")
    terminal.unmount()
  })

  it("clears a typed question before Escape returns to Inbox", async () => {
    const harness = createHarness({ itemWorkspace })
    const terminal = render(
      <MandalaTui
        color={false}
        createSession={harness.createSession}
        width={100}
      />
    )
    await waitFor(() => terminal.lastFrame()?.includes("[Overview]") === true)

    terminal.stdin.write("ask")
    await waitFor(() => terminal.lastFrame()?.includes("> ask") === true)
    terminal.stdin.write("\u001b")
    await waitFor(() => terminal.lastFrame()?.includes("> ask") === false)

    expect(terminal.lastFrame()).toContain("[Overview]")
    expect(harness.lines).not.toContain("/unselect")
    terminal.stdin.write("\u001b")
    await waitFor(() => harness.lines.includes("/inbox"))
    expect(harness.lines).toContain("/unselect")
    terminal.unmount()
  })

  it("runs only the selected allowed action and Escape returns to Inbox", async () => {
    const harness = createHarness({
      itemWorkspace,
      refreshWorkspaceOnAction: true,
    })
    const terminal = render(
      <MandalaTui
        color={false}
        createSession={harness.createSession}
        width={100}
      />
    )
    await waitFor(() => terminal.lastFrame()?.includes("[Overview]") === true)

    for (let index = 0; index < 4; index += 1) terminal.stdin.write("\u001b[C")
    await waitFor(() => terminal.lastFrame()?.includes("[Actions]") === true)
    terminal.stdin.write("\u001b[B")
    await waitFor(
      () => terminal.lastFrame()?.includes("> Edit and approve") === true
    )
    terminal.stdin.write("\r")
    await waitFor(() => harness.lines.includes("/edit"))
    await waitFor(() => terminal.lastFrame()?.includes("Ask Mandala") === true)

    expect(harness.lines).not.toContain("/approve")
    expect(terminal.lastFrame()).toContain("[Actions]")
    terminal.stdin.write("\u001b")
    await waitFor(() => harness.lines.includes("/inbox"))
    expect(harness.lines).toContain("/unselect")
    terminal.unmount()
  })

  it("clips and scrolls tab content within short terminal heights", () => {
    expect(itemWorkspaceContentLines(12, 0)).toBe(3)
    expect(clipItemWorkspaceContent("1\n2\n3\n4", 3, 1)).toEqual({
      above: 1,
      below: 0,
      text: "2\n3\n4",
    })
    expect(workspaceActionCommand("request_rework")).toBeUndefined()
    expect(workspaceActionCommand("rework")).toBe("/rework")
    expect(sanitizeItemWorkspaceContent("One\nTwo\u001b[2J")).toBe("One\nTwo")
    expect(
      wrapItemWorkspaceContent(
        "one two three four five six seven eight",
        24
      ).split("\n").length
    ).toBeGreaterThan(1)
    expect(windowItemActions(["one", "two", "three"], 2, 1)).toEqual({
      above: 2,
      below: 0,
      items: ["three"],
      start: 2,
    })
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
    const denyMatches = matchingCommands("/den", {
      selectedItem: { ...selectedItem, status: "active" },
    }).map(({ command }) => command)
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
    expect(
      matchingCommands("/", { userEmail: "seed@example.com" }).map(
        ({ command }) => command
      )
    ).not.toContain("/login")
    expect(
      matchingCommands("/", {}).map(({ command }) => command)
    ).not.toContain("/logout")
    const signedInCommands = matchingCommands("/", {
      userEmail: "seed@example.com",
    }).map(({ command }) => command)
    expect(signedInCommands).toContain("/workspace")
    expect(signedInCommands).not.toContain("/companies")
    expect(signedInCommands).not.toContain("/company")
    expect(signedInCommands).not.toContain("/open")
    expect(
      matchingCommands("/inbxo", {}).map(({ command }) => command)
    ).toContain("/inbox")
    expect(matchingCommands("/zzzzzz", {})).toEqual([])
  })

  it("keeps every command category in one contiguous palette section", () => {
    const matches = matchingCommands("/s", {
      userEmail: "seed@example.com",
    })
    const positions = new Map<string, number[]>()
    matches.forEach((definition, index) => {
      positions.set(definition.group, [
        ...(positions.get(definition.group) ?? []),
        index,
      ])
    })

    for (const indexes of positions.values()) {
      expect(indexes.at(-1)! - indexes[0]! + 1).toBe(indexes.length)
    }
    const commands = matches.map(({ command }) => command)
    expect(
      Math.abs(commands.indexOf("/sandbox") - commands.indexOf("/fixtures"))
    ).toBe(1)
    expect(
      Math.abs(commands.indexOf("/inbox") - commands.indexOf("/refresh"))
    ).toBeLessThanOrEqual(2)
  })
})

function createHarness(
  options: {
    choiceOn?: string
    confirmOnApprove?: boolean
    executeAfterApprove?: boolean
    pauseOn?: string
    refreshWorkspaceOnAction?: boolean
    itemWorkspace?: TuiItemWorkspace
    streamOn?: string
    snapshot?: Parameters<TuiSessionIo["onSnapshot"]>[0]
  } = {}
) {
  const lines: string[] = []
  const selections: string[] = []
  let io: TuiSessionIo
  let exitRequested = false
  let releasePause: (() => void) | undefined
  const createSession: CreateTuiSession = (sessionIo) => {
    io = sessionIo
    const session: TuiSessionController = {
      get exitRequested() {
        return exitRequested
      },
      cancelCurrentOperation: () => false,
      clearState: vi.fn(),
      handleLine: async (line) => {
        lines.push(line)
        if (line === "/unselect") {
          io.setItemWorkspace?.(null)
          io.onSnapshot({ workspace: { name: "Mandala Local Demo" } })
        }
        if (line === options.choiceOn) {
          const selected = await io.choose?.("Choose workspace", [
            {
              value: "mandala",
              label: "Mandala Local Demo",
              description: "owner · current",
            },
            {
              value: "acme",
              label: "Acme Operations",
              description: "approver",
            },
          ])
          if (selected) selections.push(selected)
        }
        if (line === options.pauseOn) {
          await new Promise<void>((resolve) => {
            releasePause = resolve
          })
        }
        if (line === options.streamOn) {
          io.setLiveMessage?.("Mandala\nPartial answer")
          await new Promise((resolve) => setTimeout(resolve, 20))
          io.setLiveMessage?.("Mandala\nFinished streamed answer")
          io.append("Mandala\nFinished streamed answer")
          io.setLiveMessage?.(null)
        }
        if (line === "/edit" && options.refreshWorkspaceOnAction)
          io.setItemWorkspace?.({
            ...options.itemWorkspace!,
            actions: [{ value: "execute", label: "Execute mock action" }],
          })
        if (line === "/open 1") io.onSnapshot({ selectedItem })
        if (line === "/approve" && options.confirmOnApprove) {
          const answer = await io.ask("Approve this draft? [y/N] ")
          if (answer === "y") {
            io.append("Approved.")
            if (options.executeAfterApprove)
              await io.ask("Execute this approved action in Sandbox? [y/N] ")
          } else {
            io.append("Cancelled.")
          }
        }
      },
      requestExit: () => {
        exitRequested = true
      },
      start: async () => {
        io.append("Mandala test header")
        io.onSnapshot(options.snapshot ?? { selectedItem })
        if (options.itemWorkspace) io.setItemWorkspace?.(options.itemWorkspace)
      },
    }
    return session
  }
  return {
    createSession,
    exitRequested: () => exitRequested,
    lines,
    selections,
    release: () => releasePause?.(),
  }
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let index = 0; index < 250; index += 1) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error("Timed out waiting for Ink render.")
}
