import { Readable, Writable } from "node:stream"
import { describe, expect, it, vi } from "vitest"
import type { CliCommandResult } from "../src/cli.js"
import { CliError } from "../src/errors.js"
import {
  completeSlashCommand,
  getSlashCommand,
  slashCommands,
} from "../src/slash-commands.js"
import { runTui, type TuiDependencies } from "../src/tui.js"

const companyId = "20000000-0000-4000-8000-000000000001"
const otherCompanyId = "20000000-0000-4000-8000-000000000002"
const itemId = "40000000-0000-4000-8000-000000000001"

describe("slash command registry", () => {
  it("discovers the complete strict registry and registered domain view", () => {
    expect(slashCommands.map(({ command }) => command)).toEqual([
      "/",
      "/login",
      "/auth-status",
      "/logout",
      "/companies",
      "/company",
      "/inbox",
      "/purchase-requests",
      "/fixtures",
      "/run-fixture",
      "/open",
      "/refresh",
      "/recommendation",
      "/evidence",
      "/draft",
      "/history",
      "/approve",
      "/reject",
      "/deny",
      "/rework",
      "/edit",
      "/execute",
      "/unselect",
      "/context",
      "/clear",
      "/help",
      "/exit",
      "/quit",
    ])
    expect(getSlashCommand("/purchase-requests")?.view).toMatchObject({
      includedItemTypes: ["procurement_reorder_review"],
      includedStatuses: ["active", "blocked", "approved"],
    })
    expect(completeSlashCommand("/pur")[0]).toEqual(["/purchase-requests"])
  })
})

describe("interactive TUI", () => {
  it("fails an unknown slash command closed", async () => {
    const execute = fakeExecute({ authenticated: false })
    const { stderr } = await session("/not-registered\n/exit\n", execute)

    expect(execute).toHaveBeenCalledTimes(1)
    expect(execute).toHaveBeenCalledWith(["context"], expect.any(Object))
    expect(stderr.value).toContain("unknown_slash_command")
  })

  it("keeps a bare slash as a transient palette trigger", async () => {
    const execute = fakeExecute({ authenticated: false })
    const { stderr, stdout } = await session("/\n/exit\n", execute)

    expect(stdout.value).not.toContain("Available Commands")
    expect(stdout.value).not.toContain("/purchase-requests")
    expect(stderr.value).not.toContain("unknown_slash_command")
  })

  it("resolves an item row only from the last rendered work list", async () => {
    const execute = fakeExecute()
    await session("/inbox\n/open 1\n/exit\n", execute)

    expect(commandCalls(execute)).toContainEqual(["work", "show", itemId])
  })

  it("clears item selection and row maps when the company changes", async () => {
    const execute = fakeExecute()
    const { stderr } = await session(
      "/inbox\n/open 1\n/companies\n/company 1\n/approve\n/open 1\n/exit\n",
      execute
    )

    expect(commandCalls(execute)).toContainEqual([
      "company",
      "use",
      otherCompanyId,
    ])
    expect(commandCalls(execute)).not.toContainEqual([
      "work",
      "approve",
      itemId,
    ])
    expect(stderr.value).toContain("Select a work item first")
    expect(stderr.value).toContain("refresh its row numbers")
  })

  it("redraws identity context after company switch and logout", async () => {
    const execute = fakeExecute()
    const { stdout } = await session(
      "/companies\n/company 1\n/logout\n/exit\n",
      execute
    )

    expect(stdout.value).toContain("Other Company · Sandbox")
    expect(stdout.value).toContain("(none) · Sandbox")
    expect(commandCalls(execute)).toContainEqual(["auth", "logout"])
  })

  it("dispatches approve and deny through canonical typed CLI paths", async () => {
    const execute = fakeExecute()
    await session(
      "/inbox\n/open 1\n/approve\n/deny --reason Duplicate request\n/exit\n",
      execute
    )

    const calls = commandCalls(execute)
    expect(calls).toContainEqual(["work", "approve", itemId, "--execute"])
    expect(calls).toContainEqual([
      "work",
      "reject",
      itemId,
      "--reason",
      "Duplicate request",
    ])
    expect(
      calls.filter(
        (args) => args[0] === "work" && args[1] === "show" && args[2] === itemId
      )
    ).toHaveLength(3)
  })

  it("dispatches rework, edit, and execution through typed CLI paths", async () => {
    const execute = fakeExecute()
    await session(
      "/inbox\n/open 1\n/rework --reason Needs review\n/edit --set /lines/0/quantity=24 --reason Adjust quantity\n/execute\n/exit\n",
      execute
    )

    const calls = commandCalls(execute)
    expect(calls).toContainEqual([
      "work",
      "rework",
      itemId,
      "--reason",
      "Needs review",
    ])
    expect(calls).toContainEqual([
      "work",
      "edit",
      itemId,
      "--set",
      "/lines/0/quantity=24",
      "--reason",
      "Adjust quantity",
    ])
    expect(calls).toContainEqual(["work", "execute", itemId])
  })

  it("deduplicates repeated warnings before acknowledgement", async () => {
    const execute = fakeExecute({ warning: "Recent sales spike." })
    await session("/inbox\n/open 1\n/approve\ny\n/exit\n", execute)

    expect(commandCalls(execute)).toContainEqual([
      "work",
      "approve",
      itemId,
      "--ack-warnings",
      "--execute",
    ])
  })

  it("redacts pointer-sensitive edits in the real TUI confirmation", async () => {
    const secret = "must-not-render"
    const base = fakeExecute()
    const execute = vi.fn(
      async (
        args: string[],
        dependencies: Parameters<NonNullable<TuiDependencies["execute"]>>[1]
      ): Promise<CliCommandResult> => {
        if (args[0] === "work" && args[1] === "edit") {
          const confirmed = await dependencies?.confirm?.({
            actionType: "mock_purchase_order",
            changes: [{ pointer: "/rawToken", value: secret }],
            companyName: "Example Company",
            draft: {
              ...workItemDetail().draft,
              payload: { rawToken: secret },
              workflowRunId: "30000000-0000-4000-8000-000000000001",
              workflowItemId: itemId,
              status: "pending_review" as const,
              updatedAt: "2026-07-09T12:00:00.000Z",
            },
            intent: {
              kind: "record_decision",
              companyId,
              itemId,
              decision: "edit",
              patches: [{ pointer: "/rawToken", value: secret }],
              reason: "Rotate capability",
              warningsAcknowledged: false,
              risk: "state_change",
            },
            item: {
              ...workItem(),
              createdAt: "2026-07-09T12:00:00.000Z",
              resolutionState: {},
              status: "active" as const,
              updatedAt: "2026-07-09T12:00:00.000Z",
              workflowRunId: "30000000-0000-4000-8000-000000000001",
            },
          })
          return confirmed
            ? { ok: true, data: { item: { id: itemId, status: "approved" } } }
            : {
                ok: false,
                error: new CliError("command_cancelled", "Cancelled."),
              }
        }
        return base(args, dependencies)
      }
    ) as NonNullable<TuiDependencies["execute"]> & ReturnType<typeof vi.fn>

    const { stdout } = await session(
      `/inbox\n/open 1\n/edit --set /rawToken=${secret} --reason Rotate capability\ny\n/exit\n`,
      execute,
      true
    )

    expect(stdout.value).toContain("[REDACTED]")
    expect(stdout.value).not.toContain(secret)
  })

  it("rejects a mutation without a target or selected item", async () => {
    const execute = fakeExecute({ authenticated: false })
    const { stderr } = await session("/approve\n/exit\n", execute)

    expect(commandCalls(execute)).toEqual([["context"]])
    expect(stderr.value).toContain("Select a work item first")
  })

  it("routes normal text to the existing chat command", async () => {
    const execute = fakeExecute({ authenticated: false })
    await session("show me what needs attention\n/exit\n", execute)

    expect(commandCalls(execute)).toContainEqual([
      "chat",
      "show me what needs attention",
    ])
  })

  it("answers a greeting locally without invoking the workflow parser", async () => {
    const execute = fakeExecute({ authenticated: false })
    const { stdout } = await session("hello\n/exit\n", execute)

    expect(commandCalls(execute)).toEqual([["context"]])
    expect(stdout.value).toContain("Hello. What would you like to work on?")
    expect(stdout.value).not.toContain("unsupported_command")
  })

  it("answers capability questions with the available command list", async () => {
    const execute = fakeExecute({ authenticated: false })
    const { stdout } = await session("what can you do?\n/exit\n", execute)

    expect(commandCalls(execute)).toEqual([["context"]])
    expect(stdout.value).toContain("I can help you review work")
    expect(stdout.value).toContain("commands")
  })

  it("humanizes unsupported conversational outcomes without parser metadata", async () => {
    const execute = fakeExecute({
      authenticated: false,
      chatResult: {
        parserKind: "langchain",
        trace: { traceId: "must-not-render" },
        controlRequestId: "must-not-render",
        outcome: {
          status: "blocked",
          reasonCode: "unsupported_command",
          reasons: ["The request is outside the supported boundary."],
        },
      },
    })
    const { stdout } = await session(
      "do something unsupported\n/exit\n",
      execute
    )

    expect(stdout.value).toContain("I couldn't map that")
    expect(stdout.value).not.toContain("parserKind")
    expect(stdout.value).not.toContain("traceId")
    expect(stdout.value).not.toContain("must-not-render")
  })

  it("unwraps successful conversational results before rendering", async () => {
    const execute = fakeExecute({
      authenticated: false,
      chatResult: {
        parser: {
          parserKind: "langchain",
          trace: { traceId: "must-not-render" },
        },
        result: { items: [] },
      },
    })
    const { stdout } = await session("show current work\n/exit\n", execute)

    expect(stdout.value).toContain("No work items matched that request.")
    expect(stdout.value).toContain("No work items")
    expect(stdout.value).not.toContain("parserKind")
    expect(stdout.value).not.toContain("must-not-render")
  })

  it("uses the actionable inbox view for attention requests", async () => {
    const execute = fakeExecute({
      authenticated: false,
      chatResult: {
        parser: { parserKind: "langchain" },
        result: {
          items: [
            {
              ...workItem(),
              id: "40000000-0000-4000-8000-000000000002",
              status: "executed",
              title: "Completed request",
            },
            {
              ...workItem(),
              title: "Actionable request",
            },
          ],
        },
      },
    })
    const { stdout } = await session(
      "show me what needs attention\n/exit\n",
      execute
    )

    expect(stdout.value).toContain("1 item needs your review.")
    expect(stdout.value).toContain("Actionable request")
    expect(stdout.value).not.toContain("Completed request")
  })

  it("answers an empty attention request without a large empty table", async () => {
    const execute = fakeExecute({
      authenticated: false,
      chatResult: {
        parser: { parserKind: "langchain" },
        result: { items: [] },
      },
    })
    const { stdout } = await session(
      "show me what needs attention\n/exit\n",
      execute
    )

    expect(stdout.value).toContain("Your inbox is clear.")
    expect(stdout.value).not.toContain("No work items")
  })

  it.each([
    ["explicit exit", "/exit\n"],
    ["EOF", ""],
  ])("exits gracefully on %s", async (_label, input) => {
    const execute = fakeExecute({ authenticated: false })
    await expect(session(input, execute)).resolves.toMatchObject({
      exitCode: 0,
    })
  })
})

async function session(
  input: string,
  execute: NonNullable<TuiDependencies["execute"]>,
  useRealConfirmation = false
) {
  const stdout = new CaptureStream()
  const stderr = new CaptureStream()
  const exitCode = await runTui({
    ...(useRealConfirmation
      ? {}
      : { confirm: vi.fn().mockResolvedValue(true) }),
    environment: {},
    execute,
    stderr,
    stdin: Readable.from([input]),
    stdout,
  })
  return { exitCode, stderr, stdout }
}

function fakeExecute(
  options: {
    authenticated?: boolean
    chatResult?: unknown
    warning?: string
  } = {}
) {
  let authenticated = options.authenticated ?? true
  let activeCompanyId = companyId
  return vi.fn(async (args: string[]): Promise<CliCommandResult> => {
    if (args[0] === "context") {
      return {
        ok: true,
        data: authenticated
          ? {
              authenticated: true,
              company: {
                id: activeCompanyId,
                name:
                  activeCompanyId === otherCompanyId
                    ? "Other Company"
                    : "Example Company",
              },
              mode: "mock",
              user: { email: "user@example.com" },
            }
          : {
              authenticated: false,
              company: null,
              mode: "mock",
              user: null,
            },
      }
    }
    if (args[0] === "company" && args[1] === "list") {
      return {
        ok: true,
        data: {
          companies: [
            {
              id: otherCompanyId,
              name: "Other Company",
              role: "approver",
            },
          ],
        },
      }
    }
    if (args[0] === "company" && args[1] === "use") {
      activeCompanyId = args[2] ?? companyId
      return {
        ok: true,
        data: {
          company: { id: args[2], name: "Other Company", role: "approver" },
          mode: "mock",
        },
      }
    }
    if (args[0] === "auth" && args[1] === "logout") {
      authenticated = false
      return { ok: true, data: { authenticated: false } }
    }
    if (args[0] === "work" && args[1] === "list") {
      return { ok: true, data: { items: [workItem()] } }
    }
    if (args[0] === "work" && args[1] === "show") {
      return { ok: true, data: workItemDetail(options.warning) }
    }
    if (args[0] === "work") {
      return {
        ok: true,
        data: { item: { id: args[2], status: "approved" } },
      }
    }
    if (args[0] === "chat") {
      return {
        ok: true,
        data: options.chatResult ?? { response: "ok" },
      }
    }
    return { ok: true, data: {} }
  }) as NonNullable<TuiDependencies["execute"]> & ReturnType<typeof vi.fn>
}

function commandCalls(execute: ReturnType<typeof fakeExecute>): string[][] {
  return execute.mock.calls.map(([args]) => args as string[])
}

function workItem() {
  return {
    id: itemId,
    itemType: "procurement_reorder_review",
    priority: 50,
    status: "active",
    title: "Review reorder request",
    warningCount: 0,
  }
}

function workItemDetail(warning?: string) {
  const warnings = warning ? [warning] : []
  return {
    attempt: null,
    auditEvents: [],
    contextPacket: warning ? { warnings } : null,
    decision: null,
    draft: {
      actionType: "mock_purchase_order",
      editPolicy: {},
      id: "50000000-0000-4000-8000-000000000001",
      payload: { quantity: 12 },
      status: "pending_review",
    },
    evidence: warning ? { warnings } : null,
    item: workItem(),
    recommendation: warning ? { warnings } : null,
  }
}

class CaptureStream extends Writable {
  value = ""
  isTTY = false
  columns = 80

  _write(
    chunk: Buffer | string,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void
  ): void {
    this.value += chunk.toString()
    callback()
  }
}
