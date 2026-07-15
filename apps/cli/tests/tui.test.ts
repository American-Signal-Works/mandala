import { Readable, Writable } from "node:stream"
import { resolve } from "node:path"
import type { AgentSummary } from "@workspace/control-plane"
import { describe, expect, it, vi } from "vitest"
import type { ControlApi } from "../src/api-client.js"
import type { CliCommandResult } from "../src/cli.js"
import { CliError } from "../src/errors.js"
import {
  completeSlashCommand,
  getSlashCommand,
  parseSlashCommand,
  slashCommands,
} from "../src/slash-commands.js"
import {
  createTuiSessionFactory,
  runTui,
  type TuiDependencies,
} from "../src/tui.js"
import type { TuiChoice, TuiSessionIo } from "../src/tui-app.js"

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
      "/workspace",
      "/companies",
      "/company",
      "/agents",
      "/agent-list",
      "/agent-show",
      "/agent-validate",
      "/agent-install",
      "/agent-test",
      "/agent-activate",
      "/agent-deactivate",
      "/agent-pause",
      "/agent-resume",
      "/agent-disable",
      "/agent-versions",
      "/agent-rollback",
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
      "/detail",
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
    expect(parseSlashCommand("/inbxo")).toMatchObject({
      ok: false,
      message: expect.stringContaining("Did you mean /inbox?"),
    })
  })
})

describe("interactive TUI", () => {
  it("uses a safe nested fixture picker before running sandbox data", async () => {
    const base = fakeExecute()
    const execute = vi.fn(async (args: string[]): Promise<CliCommandResult> => {
      if (
        args[0] === "workflow" &&
        args[1] === "fixture" &&
        args[2] === "list"
      ) {
        return {
          ok: true,
          data: {
            scenarios: [
              {
                id: "clean_reorder",
                description: "Creates a reviewable baseline recommendation.",
              },
            ],
          },
        }
      }
      if (
        args[0] === "workflow" &&
        args[1] === "fixture" &&
        args[2] === "run"
      ) {
        return { ok: true, data: { scenario: args[3], status: "created" } }
      }
      return base(args)
    }) as NonNullable<TuiDependencies["execute"]> & ReturnType<typeof vi.fn>
    const stdout = new CaptureStream()
    const stderr = new CaptureStream()
    const selections = ["clean_reorder", "cancel"]
    const prompts: string[] = []
    const createSession = createTuiSessionFactory({ execute }, stdout, stderr)
    const controller = createSession({
      append: (value) => stdout.write(`${value}\n`),
      ask: async () => null,
      choose: async (prompt, choices) => {
        prompts.push(prompt)
        const selected = selections.shift()
        expect(choices.map(({ value }) => value)).toContain(selected)
        return selected ?? null
      },
      clearScreen: () => undefined,
      onSnapshot: () => undefined,
      renderOptions: { color: false, width: 100 },
    })
    await controller.start()
    await controller.handleLine("/fixtures")

    expect(prompts).toEqual([
      "Choose a sandbox fixture",
      "Fixture · Clean reorder",
    ])
    expect(commandCalls(execute)).not.toContainEqual([
      "workflow",
      "fixture",
      "run",
      "clean_reorder",
    ])
    expect(stdout.value).not.toContain("| #")

    selections.push("clean_reorder", "run")
    await controller.handleLine("/fixtures")
    expect(commandCalls(execute)).toContainEqual([
      "workflow",
      "fixture",
      "run",
      "clean_reorder",
    ])
    expect(stdout.value).toContain("Open /inbox")
  })

  it("explains the Mandala Bean Co. test-agent run in the guided picker", async () => {
    const base = fakeExecute()
    const execute = vi.fn(async (args: string[]): Promise<CliCommandResult> => {
      if (
        args[0] === "workflow" &&
        args[1] === "fixture" &&
        args[2] === "list"
      ) {
        return {
          ok: true,
          data: {
            scenarios: [
              {
                id: "synthetic_agent_run",
                description:
                  "Builds Mandala Bean Co. with 1,200 products plus sales/events.",
              },
            ],
          },
        }
      }
      if (
        args[0] === "workflow" &&
        args[1] === "fixture" &&
        args[2] === "run"
      ) {
        return {
          ok: true,
          data: {
            dataset: {
              businessName: "Mandala Bean Co.",
              productCount: 1_200,
              salesRecordCount: 108_000,
              businessEventCount: 366,
            },
            agentRun: { toolCallCount: 5 },
          },
        }
      }
      return base(args)
    }) as NonNullable<TuiDependencies["execute"]> & ReturnType<typeof vi.fn>
    const stdout = new CaptureStream()
    const stderr = new CaptureStream()
    const selections = ["synthetic_agent_run", "run"]
    const actionChoices: TuiChoice[][] = []
    const controller = createTuiSessionFactory(
      { execute },
      stdout,
      stderr
    )({
      append: (value) => stdout.write(`${value}\n`),
      ask: async () => null,
      choose: async (_prompt, choices) => {
        actionChoices.push([...choices])
        return selections.shift() ?? null
      },
      clearScreen: () => undefined,
      onSnapshot: () => undefined,
      renderOptions: { color: false, width: 100 },
    })

    await controller.start()
    await controller.handleLine("/fixtures")

    expect(actionChoices[1]).toContainEqual(
      expect.objectContaining({ label: "Run test agent" })
    )
    expect(stdout.value).toContain("Mandala Bean Co. test agent finished")
    expect(stdout.value).toContain("1,200 products")
    expect(stdout.value).toContain("108,000 daily sales records")
    expect(stdout.value).toContain("5 read-only tool calls")
  })

  it("guides users through agent setup issues in plain language", async () => {
    const agent = testAgentSummary({
      status: "invalid",
      capabilities: [
        {
          id: "inventory.read",
          alias: "store inventory",
          access: "read",
          version: "1",
          connectorId: null,
          status: "missing",
        },
      ],
    })
    const api = agentControlApi(agent)
    const stdout = new CaptureStream()
    const stderr = new CaptureStream()
    const selections = [agent.id, "setup", "back", null]
    const prompts: string[] = []
    const controller = createTuiSessionFactory(
      { api, execute: fakeExecute() },
      stdout,
      stderr
    )({
      append: (value) => stdout.write(`${value}\n`),
      ask: async () => null,
      choose: async (prompt) => {
        prompts.push(prompt)
        return selections.shift() ?? null
      },
      clearScreen: () => undefined,
      onSnapshot: () => undefined,
      renderOptions: { color: false, width: 100 },
    })

    await controller.start()
    await controller.handleLine("/agents")

    expect(prompts).toContain("Choose an agent")
    expect(prompts).toContain(`Agent · ${agent.name}`)
    expect(stdout.value).toContain(
      "Needs setup · store inventory · read access"
    )
    expect(stdout.value).toContain(
      "What to do: Connect a system that provides store inventory."
    )
  })

  it("defaults agent activation to Cancel and runs only after confirmation", async () => {
    const inactive = testAgentSummary({ status: "inactive", active: false })
    const active = { ...inactive, status: "active" as const, active: true }
    const activateAgent = vi.fn(async () => ({
      agent: active,
      action: "activated",
    }))
    const api = agentControlApi(inactive, { activateAgent })
    const stdout = new CaptureStream()
    const stderr = new CaptureStream()
    const confirmationChoices: TuiChoice[][] = []
    const selections: Array<string | null> = [
      inactive.id,
      "activate",
      "cancel",
      "back",
      null,
      inactive.id,
      "activate",
      "confirm",
      "back",
      null,
    ]
    const controller = createTuiSessionFactory(
      { api, execute: fakeExecute() },
      stdout,
      stderr
    )({
      append: (value) => stdout.write(`${value}\n`),
      ask: async () => null,
      choose: async (prompt, choices) => {
        if (prompt === "Confirm agent change")
          confirmationChoices.push([...choices])
        return selections.shift() ?? null
      },
      clearScreen: () => undefined,
      onSnapshot: () => undefined,
      renderOptions: { color: false, width: 100 },
    })

    await controller.start()
    await controller.handleLine("/agents")
    expect(activateAgent).not.toHaveBeenCalled()
    expect(confirmationChoices[0]?.[0]).toMatchObject({
      value: "cancel",
      label: "Cancel",
    })

    await controller.handleLine("/agents")
    expect(activateAgent).toHaveBeenCalledWith(inactive.id, {
      companyId,
      expectedVersion: inactive.stateVersion,
      reason: "Confirmed in the Mandala terminal.",
    })
    expect(stdout.value).toContain("is active and can start new work")
  })

  it("shows the review item created by a Sandbox agent test", async () => {
    const agent = testAgentSummary({ status: "active", active: true })
    const testAgent = vi.fn(async () => ({
      agentId: agent.id,
      workflowRunId: "30000000-0000-4000-8000-000000000009",
      status: "waiting_for_approval" as const,
      itemId,
    }))
    const api = agentControlApi(agent, { testAgent })
    const stdout = new CaptureStream()
    const stderr = new CaptureStream()
    const selections: Array<string | null> = [agent.id, "test", "back", null]
    const controller = createTuiSessionFactory(
      { api, execute: fakeExecute() },
      stdout,
      stderr
    )({
      append: (value) => stdout.write(`${value}\n`),
      ask: async () => null,
      choose: async () => selections.shift() ?? null,
      clearScreen: () => undefined,
      onSnapshot: () => undefined,
      renderOptions: { color: false, width: 100 },
    })

    await controller.start()
    await controller.handleLine("/agents")

    expect(testAgent).toHaveBeenCalledWith(agent.id, { companyId })
    expect(stdout.value).toContain("Waiting for your review")
    expect(stdout.value).toContain("Open the inbox to review")
  })

  it("offers safe guided installation when the workspace has no agents", async () => {
    const agent = testAgentSummary()
    const skillFile = resolve(
      process.cwd(),
      "../../skills/procurement-reorder/SKILL.md"
    )
    const validateAgent = vi.fn(async () => ({
      valid: true,
      diagnostics: [],
      preview: {
        workflowKey: agent.workflowKey,
        workflowType: agent.workflowType,
        name: agent.name,
        version: agent.version,
        sourceDigest: agent.skillDigest,
        manifestDigest: agent.manifestDigest,
        graph: [],
        capabilities: [],
      },
    }))
    const installAgent = vi.fn(async () => ({ agent, created: true }))
    const api = agentControlApi(agent, {
      listAgents: vi.fn(async () => ({ agents: [] })),
      validateAgent,
      installAgent,
    })
    const stdout = new CaptureStream()
    const stderr = new CaptureStream()
    const confirmations: TuiChoice[][] = []
    const selections: Array<string | null> = ["install", "cancel", "install"]
    const controller = createTuiSessionFactory(
      { api, execute: fakeExecute() },
      stdout,
      stderr
    )({
      append: (value) => stdout.write(`${value}\n`),
      ask: async (prompt) =>
        prompt === "Path to SKILL.md: " ? skillFile : null,
      choose: async (prompt, choices) => {
        if (prompt === "Install this agent?") confirmations.push([...choices])
        return selections.shift() ?? null
      },
      clearScreen: () => undefined,
      onSnapshot: () => undefined,
      renderOptions: { color: false, width: 100 },
    })

    await controller.start()
    await controller.handleLine("/agents")

    expect(confirmations[0]?.[0]).toMatchObject({
      value: "cancel",
      label: "Cancel",
    })
    expect(installAgent).not.toHaveBeenCalled()
    expect(stdout.value).toContain("The agent was not installed")

    await controller.handleLine(`/agent-install ${skillFile}`)

    expect(validateAgent).toHaveBeenCalledWith(
      expect.objectContaining({ companyId })
    )
    expect(installAgent).toHaveBeenCalledWith({
      companyId,
      skillMarkdown: expect.any(String),
      activate: false,
    })
    expect(stdout.value).toContain("is installed but inactive")
    expect(stdout.value).toContain("Run a Sandbox test before activating it")
  })

  it("defaults interactive decision confirmation to Cancel", async () => {
    const base = fakeExecute()
    const confirmationChoices: TuiChoice[][] = []
    const execute = vi.fn(
      async (
        args: string[],
        dependencies: Parameters<NonNullable<TuiDependencies["execute"]>>[1]
      ): Promise<CliCommandResult> => {
        if (args[0] === "work" && args[1] === "approve") {
          const detail = workItemDetail()
          const confirmed = await dependencies?.confirm?.({
            actionType: detail.draft.actionType,
            companyName: "Example Company",
            draft: { ...detail.draft, status: "pending_review" as const },
            intent: {
              kind: "record_decision",
              companyId,
              itemId,
              decision: "approve",
              warningsAcknowledged: false,
              risk: "state_change",
            },
            item: { ...detail.item, status: "active" as const },
            warnings: [],
          })
          return confirmed
            ? base(args)
            : {
                ok: false,
                error: new CliError("command_cancelled", "Cancelled."),
              }
        }
        return base(args)
      }
    ) as NonNullable<TuiDependencies["execute"]> & ReturnType<typeof vi.fn>
    const stdout = new CaptureStream()
    const stderr = new CaptureStream()
    const createSession = createTuiSessionFactory({ execute }, stdout, stderr)
    const controller = createSession({
      append: (value) => stdout.write(`${value}\n`),
      ask: async () => null,
      choose: async (_prompt, choices) => {
        confirmationChoices.push([...choices])
        return choices[0]?.value ?? null
      },
      clearScreen: () => undefined,
      onSnapshot: () => undefined,
      renderOptions: { color: false, width: 100 },
    })
    await controller.start()
    await controller.handleLine(`/approve ${itemId}`)

    expect(confirmationChoices).toHaveLength(1)
    expect(confirmationChoices[0]?.[0]).toMatchObject({
      value: "cancel",
      label: "Cancel",
    })
    expect(stdout.value).toContain("Cancelled. No workflow state changed.")
  })

  it("turns an expired session into a guided signed-out recovery state", async () => {
    const execute = vi.fn(async (args: string[]): Promise<CliCommandResult> => {
      if (args[0] === "context") {
        return {
          ok: false,
          error: new CliError("session_expired", "Expired."),
        }
      }
      return { ok: true, data: {} }
    }) as NonNullable<TuiDependencies["execute"]> & ReturnType<typeof vi.fn>

    const { stderr, stdout } = await session("/exit\n", execute)

    expect(stderr.value).toContain("saved local sign-in expired")
    expect(stderr.value).toContain("/login seed@example.com")
    expect(stderr.value).not.toContain("| Field")
    expect(stdout.value).toContain("Next action")
    expect(stdout.value).toContain("Sign in with /login")
  })

  it("explains the seeded local account after an unknown-email login", async () => {
    const base = fakeExecute({ authenticated: false })
    const execute = vi.fn(async (args: string[]): Promise<CliCommandResult> => {
      if (args[0] === "auth" && args[1] === "login") {
        return {
          ok: false,
          error: new CliError("unknown_local_user", "Unknown local user."),
        }
      }
      return base(args)
    }) as NonNullable<TuiDependencies["execute"]> & ReturnType<typeof vi.fn>

    const { stderr } = await session(
      "/login unknown@example.com\n/exit\n",
      execute
    )

    expect(stderr.value).toContain("not part of the local demo")
    expect(stderr.value).toContain("/login seed@example.com")
    expect(stderr.value).toContain("http://127.0.0.1:54324")
    expect(stderr.value).not.toContain("| Field")
  })

  it("does not start another magic-link flow while already signed in", async () => {
    const execute = fakeExecute()
    const { stdout } = await session(
      "/login seed@example.com\n/exit\n",
      execute
    )

    expect(stdout.value).toContain("Already signed in as user@example.com")
    expect(stdout.value).toContain("Use /logout")
    expect(commandCalls(execute)).not.toContainEqual([
      "auth",
      "login",
      "--email",
      "seed@example.com",
    ])
  })

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

  it("starts signed-in users on a useful home summary", async () => {
    const execute = fakeExecute()
    const { stdout } = await session("/exit\n", execute)

    expect(stdout.value).toContain("Home")
    expect(stdout.value).toContain("Workspace")
    expect(stdout.value).toContain("Example Company")
    expect(stdout.value).toContain("Active work")
    expect(stdout.value).toContain("Open the inbox to review work")
    expect(commandCalls(execute).slice(0, 2)).toEqual([
      ["context"],
      ["work", "list"],
    ])
  })

  it("renders explicit inbox row ownership and a focused item overview", async () => {
    const execute = fakeExecute()
    const { stdout } = await session("/inbox\n/open 1\n/exit\n", execute)

    expect(stdout.value).toContain("Rows belong to this inbox view")
    expect(stdout.value).toContain("Inbox item")
    expect(stdout.value).toContain("Review reorder request")
    expect(stdout.value).toContain("Why it exists")
    expect(stdout.value).toContain("Next action")
    expect(stdout.value).not.toContain("Context Packet")
    expect(stdout.value).not.toContain("Audit Events")
  })

  it("guides workspace, inbox, item, and review through nested choices", async () => {
    const execute = fakeExecute()
    const stdout = new CaptureStream()
    const stderr = new CaptureStream()
    const transcript: string[] = []
    const prompts: string[] = []
    const selections: Array<string | null> = [
      otherCompanyId,
      "1",
      "review",
      "back",
      "back",
      null,
    ]
    const choose: NonNullable<TuiSessionIo["choose"]> = vi.fn(
      async (prompt: string, choices: readonly TuiChoice[]) => {
        prompts.push(prompt)
        const selected = selections.shift() ?? null
        if (selected !== null)
          expect(choices.map(({ value }) => value)).toContain(selected)
        return selected
      }
    )
    const controller = createTuiSessionFactory(
      { execute },
      stdout,
      stderr
    )({
      append: (value) => transcript.push(value),
      ask: async () => null,
      choose,
      clearScreen: () => undefined,
      onSnapshot: () => undefined,
      renderOptions: { color: false, width: 100 },
    })

    await controller.start()
    await controller.handleLine("/workspace")
    await controller.handleLine("/inbox")

    expect(prompts).toEqual([
      "Choose workspace",
      "Choose from Inbox",
      "Choose next action",
      "Choose a decision",
      "Choose next action",
      "Choose from Inbox",
    ])
    expect(commandCalls(execute)).toContainEqual([
      "company",
      "use",
      otherCompanyId,
    ])
    expect(commandCalls(execute)).toContainEqual(["work", "show", itemId])
    expect(transcript.join("\n")).toContain("Review · Review reorder request")
  })

  it("projects recommendation, evidence, and history as product views", async () => {
    const execute = fakeExecute({ warning: "Recent sales spike." })
    const { stdout } = await session(
      "/inbox\n/open 1\n/recommendation\n/evidence\n/history\n/detail\n/exit\n",
      execute
    )

    expect(stdout.value).toContain("Review · Review reorder request")
    expect(stdout.value).toContain("Suggested quantity")
    expect(stdout.value).toContain("Evidence & freshness")
    expect(stdout.value).toContain("Assumptions")
    expect(stdout.value).toContain("Activity & history")
    expect(stdout.value).toContain("Context Packet")
    expect(stdout.value).toContain("Recommendation created")
  })

  it("resolves an item row only from the last rendered work list", async () => {
    const execute = fakeExecute()
    await session("/inbox\n/open 1\n/exit\n", execute)

    expect(commandCalls(execute)).toContainEqual(["work", "show", itemId])
  })

  it("groups help and only shows actions valid for the current selection", async () => {
    const execute = fakeExecute()
    const before = await session("/help\n/exit\n", execute)
    expect(before.stdout.value).toContain("Review work")
    expect(before.stdout.value).not.toContain("/approve")

    const after = await session(
      "/inbox\n/open 1\n/help\n/exit\n",
      fakeExecute()
    )
    expect(after.stdout.value).toContain("Decide")
    expect(after.stdout.value).toContain("/approve")
    expect(after.stdout.value).not.toContain("/execute")
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

  it("invalidates numeric row targets after a mutation changes the inbox", async () => {
    const execute = fakeExecute()
    const { stderr } = await session(
      "/inbox\n/open 1\n/approve\n/open 1\n/exit\n",
      execute
    )

    expect(stderr.value).toContain(
      "Open the relevant list again to refresh its row numbers"
    )
    expect(
      commandCalls(execute).filter(
        (args) => args[0] === "work" && args[1] === "show"
      )
    ).toHaveLength(3)
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
    ).toHaveLength(5)
  })

  it("shows a recorded approval and retry path when downstream execution fails", async () => {
    const base = fakeExecute()
    let approvalRecorded = false
    const execute = vi.fn(async (args: string[]): Promise<CliCommandResult> => {
      if (args[0] === "work" && args[1] === "approve") {
        approvalRecorded = true
        return {
          ok: false,
          error: new CliError("execution_failed", "The mock execution failed."),
        }
      }
      if (args[0] === "work" && args[1] === "show" && approvalRecorded) {
        const detail = workItemDetail()
        return {
          ok: true,
          data: {
            ...detail,
            decision: {
              actionDraftId: detail.draft.id,
              createdAt: "2026-07-09T12:01:00.000Z",
              decision: "approve",
              id: "a0000000-0000-4000-8000-000000000001",
              reason: null,
              warningsAcknowledged: false,
            },
            draft: { ...detail.draft, status: "approved" },
            item: { ...detail.item, status: "approved" },
          },
        }
      }
      return base(args)
    }) as NonNullable<TuiDependencies["execute"]> & ReturnType<typeof vi.fn>

    const { stderr, stdout } = await session(
      "/inbox\n/open 1\n/approve\n/exit\n",
      execute
    )

    expect(stdout.value).toContain("Decision recorded · APPROVE")
    expect(stdout.value).toContain("Approval was recorded")
    expect(stdout.value).toContain("use /execute to retry")
    expect(stderr.value).toContain("execution_failed")
  })

  it("reports one certain no-change error when approval cannot connect", async () => {
    const base = fakeExecute()
    const execute = vi.fn(async (args: string[]): Promise<CliCommandResult> => {
      if (args[0] === "work" && args[1] === "approve") {
        return {
          ok: false,
          error: new CliError(
            "api_unavailable",
            "The API is not accepting connections."
          ),
        }
      }
      return base(args)
    }) as NonNullable<TuiDependencies["execute"]> & ReturnType<typeof vi.fn>

    const { stderr, stdout } = await session(
      "/inbox\n/open 1\n/approve\n/exit\n",
      execute
    )

    expect(
      stderr.value.match(/local Mandala API is not running/g)
    ).toHaveLength(1)
    expect(stderr.value).toContain("no decision request was sent")
    expect(stderr.value).toContain("workflow state did not change")
    expect(stdout.value).not.toContain("Approval state could not be verified")
    expect(
      commandCalls(execute).filter(
        (args) => args[0] === "work" && args[1] === "show"
      )
    ).toHaveLength(2)
  })

  it("silently verifies an ambiguous approval failure before warning", async () => {
    const base = fakeExecute()
    let approvalFailed = false
    const execute = vi.fn(async (args: string[]): Promise<CliCommandResult> => {
      if (args[0] === "work" && args[1] === "approve") {
        approvalFailed = true
        return {
          ok: false,
          error: new CliError("network_error", "The API could not be reached."),
        }
      }
      if (args[0] === "work" && args[1] === "show" && approvalFailed) {
        return {
          ok: false,
          error: new CliError("network_error", "The API could not be reached."),
        }
      }
      return base(args)
    }) as NonNullable<TuiDependencies["execute"]> & ReturnType<typeof vi.fn>

    const { stderr, stdout } = await session(
      "/inbox\n/open 1\n/approve\n/exit\n",
      execute
    )

    expect(
      stderr.value.match(/local Mandala API is not running/g)
    ).toHaveLength(1)
    expect(stdout.value).toContain("Approval state could not be verified")
  })

  it("reports no decision sent for other offline mutations", async () => {
    const base = fakeExecute()
    const execute = vi.fn(async (args: string[]): Promise<CliCommandResult> => {
      if (args[0] === "work" && args[1] === "reject") {
        return {
          ok: false,
          error: new CliError("api_unavailable", "Unavailable."),
        }
      }
      return base(args)
    }) as NonNullable<TuiDependencies["execute"]> & ReturnType<typeof vi.fn>

    const { stderr } = await session(
      "/inbox\n/open 1\n/reject --reason Duplicate\n/exit\n",
      execute
    )

    expect(stderr.value).toContain("no decision request was sent")
    expect(
      stderr.value.match(/local Mandala API is not running/g)
    ).toHaveLength(1)
  })

  it("separates the recorded decision from unmistakable mock execution", async () => {
    const execute = fakeExecute()
    const { stdout } = await session(
      "/inbox\n/open 1\n/approve\n/exit\n",
      execute
    )

    expect(stdout.value).toContain("Decision recorded · APPROVE")
    expect(stdout.value).toContain("user@example.com")
    expect(stdout.value).toContain("active -> approved")
    expect(stdout.value).toContain("Approval execution · MOCK")
    expect(stdout.value).toContain("Purchase order · 24 units · Acme Supply")
    expect(stdout.value).toContain("mock_po_01")
    expect(stdout.value).toContain("No live external record was created")
  })

  it("shows a product decision preview and treats no as a clean cancellation", async () => {
    const base = fakeExecute()
    const execute = vi.fn(
      async (
        args: string[],
        dependencies: Parameters<NonNullable<TuiDependencies["execute"]>>[1]
      ): Promise<CliCommandResult> => {
        if (args[0] === "work" && args[1] === "approve") {
          const detail = workItemDetail()
          const confirmed = await dependencies?.confirm?.({
            actionType: detail.draft.actionType,
            companyName: "Example Company",
            draft: { ...detail.draft, status: "pending_review" as const },
            intent: {
              kind: "record_decision",
              companyId,
              itemId,
              decision: "approve",
              warningsAcknowledged: false,
              risk: "state_change",
            },
            item: { ...detail.item, status: "active" as const },
            warnings: [],
          })
          return confirmed
            ? { ok: true, data: decisionResult("approve", "approved") }
            : {
                ok: false,
                error: new CliError("command_cancelled", "Cancelled."),
              }
        }
        return base(args, dependencies)
      }
    ) as NonNullable<TuiDependencies["execute"]> & ReturnType<typeof vi.fn>

    const { stderr, stdout } = await session(
      "/inbox\n/open 1\n/approve\nn\n/exit\n",
      execute,
      true
    )

    expect(stdout.value).toContain("Confirm decision · APPROVE")
    expect(stdout.value).toContain("Draft Preview")
    expect(stdout.value).toContain("Cancelled. No workflow state changed.")
    expect(stdout.value).not.toContain("Decision recorded")
    expect(stdout.value).not.toContain("Approval state could not be verified")
    expect(stderr.value).not.toContain("command_cancelled")
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

  it("declines warning acknowledgement without an error table or mutation", async () => {
    const execute = fakeExecute({ warning: "Recent sales spike." })
    const { stderr, stdout } = await session(
      "/inbox\n/open 1\n/approve\nn\n/exit\n",
      execute
    )

    expect(stdout.value).toContain("no decision was submitted")
    expect(stderr.value).not.toContain("command_cancelled")
    expect(commandCalls(execute)).not.toContainEqual([
      "work",
      "approve",
      itemId,
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

  it("redacts sensitive guided edit answers in scripted output", async () => {
    const secret = "must-not-be-echoed"
    const { stdout } = await session(
      `/inbox\n/open 1\n/edit\n/password=${secret}\nRotate credential\n/exit\n`,
      fakeExecute()
    )

    expect(stdout.value).toContain("/password=[REDACTED]")
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

  it("routes selected-item correction feedback to confirmed rework instead of direct mutation", async () => {
    const execute = fakeExecute()
    const { stdout } = await session(
      "/inbox\n/open 1\nPlease revise the quantity using the latest sales trend\n/exit\n",
      execute
    )

    expect(commandCalls(execute)).toContainEqual([
      "work",
      "rework",
      itemId,
      "--reason",
      "Please revise the quantity using the latest sales trend",
    ])
    expect(stdout.value).toContain("rework request")
    expect(stdout.value).toContain("not applied as a direct field change")
  })

  it("answers a selected-item question without invoking the action parser or a mutation", async () => {
    const execute = fakeExecute()
    const question = "Is 648 a good quantity for this?"
    const { stdout } = await session(
      `/inbox\n/open 1\n${question}\n/exit\n`,
      execute
    )

    expect(commandCalls(execute)).toContainEqual([
      "work",
      "ask",
      itemId,
      "--question",
      question,
    ])
    expect(commandCalls(execute)).not.toContainEqual(["chat", question])
    expect(
      commandCalls(execute).some(
        (args) =>
          args[0] === "work" &&
          ["approve", "edit", "reject", "rework", "execute"].includes(
            args[1] ?? ""
          )
      )
    ).toBe(false)
    expect(stdout.value).toContain("648 units covers about 40 days")
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
    expect(stdout.value).toContain("Actionable r")
    expect(stdout.value).not.toContain("Completed request")
  })

  it("executes the contextual endpoint's typed selected-item command without reparsing", async () => {
    const execute = fakeExecute()
    const contextualChat = vi.fn(async () => ({
      route: "command" as const,
      message: "Review and confirm this action.",
      companyId,
      selectedItemId: itemId,
      reviewVersion: "2026-07-09T12:00:00.000Z",
      command: {
        kind: "record_decision",
        companyId,
        itemId,
        decision: "approve",
        warningsAcknowledged: false,
        risk: "state_change",
      },
      confirmationRequired: true,
      mutated: false,
    }))
    const stdout = new CaptureStream()
    const stderr = new CaptureStream()

    await runTui({
      api: agentControlApi(testAgentSummary(), { contextualChat }),
      confirm: vi.fn().mockResolvedValue(true),
      environment: {},
      execute,
      stderr,
      stdin: Readable.from([
        "/inbox\n/open 1\nCan you approve it?\n/exit\n",
      ]),
      stdout,
    })

    expect(contextualChat).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId,
        input: "Can you approve it?",
        selectedItemId: itemId,
      })
    )
    expect(execute).toHaveBeenCalledWith(
      ["work", "approve", itemId],
      expect.any(Object)
    )
    expect(execute).not.toHaveBeenCalledWith(
      ["chat", "Can you approve it?"],
      expect.any(Object)
    )
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
  let detailState = workItemDetail(options.warning) as MutableWorkItemDetail
  let currentStatus = detailState.item.status
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
      return {
        ok: true,
        data: {
          items: ["active", "blocked", "approved"].includes(currentStatus)
            ? [{ ...workItem(), status: currentStatus }]
            : [],
        },
      }
    }
    if (args[0] === "work" && args[1] === "show") {
      return { ok: true, data: detailState }
    }
    if (args[0] === "work" && args[1] === "ask") {
      return {
        ok: true,
        data: {
          answer:
            "648 units covers about 40 days at the recent sales rate. Check storage capacity and minimum order constraints before deciding.",
          model: "injected-test-model",
          durationMs: 1,
          trace: null,
        },
      }
    }
    if (args[0] === "work" && args[1] === "execute") {
      currentStatus = "executed"
      detailState = completedDetail(detailState, "approve", currentStatus, true)
      return { ok: true, data: executionResult("executed") }
    }
    if (args[0] === "work" && args[1] === "approve") {
      currentStatus = "executed"
      detailState = completedDetail(detailState, "approve", currentStatus, true)
      return {
        ok: true,
        data: {
          decision: decisionResult("approve", "approved"),
          execution: executionResult("executed"),
        },
      }
    }
    if (
      args[0] === "work" &&
      ["edit", "reject", "rework"].includes(args[1] ?? "")
    ) {
      const action = args[1] ?? "edit"
      const status =
        action === "reject"
          ? "rejected"
          : action === "rework"
            ? "active"
            : "approved"
      currentStatus = status
      detailState = completedDetail(detailState, action, status, false)
      return { ok: true, data: decisionResult(action, status) }
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

function completedDetail(
  detail: MutableWorkItemDetail,
  action: string,
  status: string,
  executed: boolean
) {
  const createdAt = "2026-07-09T12:01:00.000Z"
  const decision = {
    actionDraftId: detail.draft.id,
    createdAt,
    decision: action === "rework" ? "request_rework" : action,
    id: "a0000000-0000-4000-8000-000000000001",
    reason: action === "approve" ? null : "Manager feedback",
    warningsAcknowledged: false,
  }
  const attempt = executed
    ? {
        actionDraftId: detail.draft.id,
        actionType: "mock_purchase_order",
        completedAt: createdAt,
        createdAt,
        decisionId: decision.id,
        errorMessage: null,
        id: "b0000000-0000-4000-8000-000000000001",
        mockExternalId: "mock_po_01",
        mode: "mock" as const,
        resultPayload: { outcome: "Purchase order simulated" },
        status: "succeeded" as const,
      }
    : null
  return {
    ...detail,
    attempt,
    decision,
    draft: {
      ...detail.draft,
      status: executed
        ? "executed"
        : action === "reject"
          ? "rejected"
          : "approved",
    },
    item: { ...detail.item, status },
  }
}

type MutableWorkItemDetail = Omit<
  ReturnType<typeof workItemDetail>,
  "attempt" | "decision"
> & {
  attempt: unknown
  decision: unknown
}

function commandCalls(execute: ReturnType<typeof fakeExecute>): string[][] {
  return execute.mock.calls.map(([args]) => args as string[])
}

function testAgentSummary(overrides: Partial<AgentSummary> = {}): AgentSummary {
  return {
    id: "a0000000-0000-4000-8000-000000000009",
    companyId,
    workflowKey: "inventory-replenishment",
    workflowType: "procurement_reorder_review",
    name: "Inventory replenishment",
    version: "1.0.0",
    status: "inactive",
    skillSchemaVersion: "1",
    compilerVersion: "1",
    skillDigest: "a".repeat(64),
    manifestDigest: "b".repeat(64),
    stateVersion: 1,
    active: false,
    capabilities: [],
    diagnostics: [],
    createdAt: "2026-07-13T12:00:00.000Z",
    updatedAt: "2026-07-13T12:00:00.000Z",
    ...overrides,
  }
}

function agentControlApi(
  agent: AgentSummary,
  overrides: Partial<ControlApi> = {}
): ControlApi {
  const unsupported = async () => {
    throw new Error("This API method is not used by the TUI test.")
  }
  return {
    listAgents: vi.fn(async () => ({ agents: [agent] })),
    installAgent: unsupported,
    validateAgent: vi.fn(async () => ({
      valid: false,
      diagnostics: [],
      preview: null,
    })),
    testAgent: vi.fn(async () => ({
      agentId: agent.id,
      workflowRunId: "30000000-0000-4000-8000-000000000009",
      status: "completed" as const,
      itemId: null,
    })),
    activateAgent: unsupported,
    deactivateAgent: unsupported,
    pauseAgent: unsupported,
    resumeAgent: unsupported,
    disableAgent: unsupported,
    rollbackAgent: unsupported,
    listCompanies: unsupported,
    listWorkItems: unsupported,
    getWorkItem: unsupported,
    getWorkItemReview: unsupported,
    askWorkItem: unsupported,
    runFixture: unsupported,
    recordDecision: unsupported,
    issueExecutionToken: unsupported,
    execute: unsupported,
    parseControlIntent: unsupported,
    recordControlRequest: unsupported,
    transitionControlRequest: unsupported,
    ...overrides,
  }
}

function workItem() {
  return {
    createdAt: "2026-07-09T12:00:00.000Z",
    draft: null,
    id: itemId,
    itemType: "procurement_reorder_review",
    priority: 50,
    resolutionState: { owner: "operations" },
    status: "active",
    title: "Review reorder request",
    updatedAt: "2026-07-09T12:00:00.000Z",
    warningCount: 0,
    workflowRunId: "30000000-0000-4000-8000-000000000001",
  }
}

function workItemDetail(warning?: string) {
  const warnings = warning ? [warning] : []
  return {
    attempt: null,
    auditEvents: [
      {
        createdAt: "2026-07-09T12:00:00.000Z",
        eventType: "recommendation_created",
        id: "70000000-0000-4000-8000-000000000001",
        payload: {},
        summary: "Recommendation created",
        trace: {},
      },
    ],
    contextPacket: {
      createdAt: "2026-07-09T12:00:00.000Z",
      facts: {
        availableInventory: 8,
        recent30DaySales: 31,
        reorderPoint: 12,
      },
      freshnessState: "fresh",
      id: "60000000-0000-4000-8000-000000000001",
      memoryRefs: [],
      sources: [{ source: "ShipHero inventory" }],
      warnings,
    },
    decision: null,
    draft: {
      actionType: "mock_purchase_order",
      editPolicy: {},
      id: "50000000-0000-4000-8000-000000000001",
      payload: {
        lines: [{ quantity: 24, sku: "SKU-1042" }],
        mode: "mock",
        vendor: "Acme Supply",
      },
      status: "pending_review",
      updatedAt: "2026-07-09T12:00:00.000Z",
      workflowItemId: itemId,
      workflowRunId: "30000000-0000-4000-8000-000000000001",
    },
    evidence: {
      assumptions: ["Fixture data is synthetic."],
      createdAt: "2026-07-09T12:00:00.000Z",
      evidence: [{ label: "reorder_point", value: 12 }],
      id: "80000000-0000-4000-8000-000000000001",
      sourceRefs: [{ source: "ShipHero inventory" }],
      warnings,
    },
    item: {
      createdAt: "2026-07-09T12:00:00.000Z",
      id: itemId,
      itemType: "procurement_reorder_review",
      priority: 50,
      resolutionState: { owner: "operations" },
      status: "active",
      title: "Review reorder request",
      updatedAt: "2026-07-09T12:00:00.000Z",
      workflowRunId: "30000000-0000-4000-8000-000000000001",
    },
    recommendation: {
      confidence: 0.86,
      createdAt: "2026-07-09T12:00:00.000Z",
      freshnessState: "fresh",
      id: "90000000-0000-4000-8000-000000000001",
      output: { recommendedQuantity: 24 },
      rationaleSummary: "Order 24 units from Acme Supply.",
      status: "ready_for_review",
      warningState: warnings.length ? "warn" : "pass",
      warnings,
    },
  }
}

function decisionResult(kind: string, status: string) {
  return {
    decision: {
      id: "a0000000-0000-4000-8000-000000000001",
      kind,
      warningsAcknowledged: false,
    },
    draft: {
      actionType: "mock_purchase_order",
      id: "50000000-0000-4000-8000-000000000001",
      status: kind === "reject" ? "rejected" : "approved",
    },
    item: { id: itemId, status },
  }
}

function executionResult(status: string) {
  return {
    attempt: {
      actionType: "mock_purchase_order",
      id: "b0000000-0000-4000-8000-000000000001",
      mockExternalId: "mock_po_01",
      mode: "mock",
      status: "succeeded",
    },
    draft: {
      id: "50000000-0000-4000-8000-000000000001",
      status: "executed",
    },
    item: { id: itemId, status },
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
