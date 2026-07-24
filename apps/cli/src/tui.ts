import { randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"
import type { Readable, Writable } from "node:stream"
import type {
  AgentSummary,
  AgentValidateResponse,
  ControlIntent,
  ContextualChatResponse,
  WorkItemAction,
  WorkItemDetail,
  WorkItemReviewData,
} from "@workspace/control-plane"
import { controlIntentSchema } from "@workspace/control-plane"
import { ApiClient, type ControlApi } from "./api-client.js"
import {
  loginWithDeviceAuthorization,
  loginWithMagicLink,
  SessionManager,
} from "./auth.js"
import type { CliDependencies } from "./cli.js"
import { executeCliCommand, type CliCommandResult } from "./cli.js"
import {
  confirmationDisplay,
  type ConfirmationContext,
  type ConfirmMutation,
} from "./confirmation.js"
import { asCliError, CliError } from "./errors.js"
import { getApiUrl, type RuntimeEnvironment } from "./environment.js"
import { createRuntimeSecureStore } from "./persistence.js"
import {
  getSlashCommand,
  isSlashCommandAvailable,
  parseSlashCommand,
  slashCommands,
  type SlashCommandDefinition,
  type SlashViewDefinition,
} from "./slash-commands.js"
import {
  renderActivityHistory,
  renderAssistantMessage,
  renderDecisionResult,
  renderDraftPreview,
  renderEvidenceSummary,
  renderExecutionResult,
  formatErrorSentence,
  renderHeader,
  renderHumanResult,
  renderInbox,
  renderProcurementReview,
  renderReviewWorkspace,
  renderReviewWorkspaceTabs,
  sanitizeTerminalText,
  type TerminalHeaderContext,
} from "./terminal/index.js"
import {
  projectPromptAnswer,
  resolveTuiWidth,
  runInkTui,
  type CreateTuiSession,
  type TuiChoice,
  type TuiItemWorkspace,
  type TuiSelectedItem,
  type TuiSessionIo,
} from "./tui-app.js"

type ExecuteCliCommand = typeof executeCliCommand
type AgentLifecycleUiAction =
  | "activate"
  | "deactivate"
  | "pause"
  | "resume"
  | "disable"
  | "rollback"

export type TuiDependencies = CliDependencies & {
  execute?: ExecuteCliCommand
}

type RenderOptions = {
  color: boolean
  width: number
}

type ItemRow = TuiSelectedItem

type CompanyRow = {
  id: string
  name: string
}

type FixtureRow = {
  description: string
  id: string
}

type AgentRow = {
  id: string
  name: string
}

type MutationAction =
  | "approve"
  | "reject"
  | "resolve"
  | "rework"
  | "edit"
  | "execute"

type MutationArguments = {
  acknowledgeWarnings: boolean
  assignments: string[]
  reason?: string
  target?: string
}

type ContextualConversationResult = {
  handled: boolean
  rendered?: boolean
  result?: ContextualChatResponse
}

type WorkspaceHeaderSettings = {
  contextStatus: string
  sandboxEnabled?: boolean
  sandboxStatus: string
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export async function runTui(
  dependencies: TuiDependencies = {}
): Promise<number> {
  const stdin = dependencies.stdin ?? process.stdin
  const stdout = dependencies.stdout ?? process.stdout
  const stderr = dependencies.stderr ?? process.stderr
  const terminal =
    (stdin as Readable & { isTTY?: boolean }).isTTY === true &&
    (stdout as Writable & { isTTY?: boolean }).isTTY === true
  const reportedWidth = (stdout as Writable & { columns?: number }).columns
  const renderOptions: RenderOptions = {
    color:
      terminal &&
      (dependencies.environment ?? process.env).NO_COLOR === undefined,
    width: resolveTuiWidth(reportedWidth),
  }
  const createSession = createTuiSessionFactory(dependencies, stdout, stderr)

  if (!terminal) {
    return runScriptedTui({
      createSession,
      stderr,
      stdin,
      stdout,
      renderOptions,
    })
  }
  return runInkTui({
    color: renderOptions.color ?? false,
    createSession,
    stderr,
    stdin,
    stdout,
    width: renderOptions.width ?? 80,
  })
}

export function createTuiSessionFactory(
  dependencies: TuiDependencies,
  stdout: Writable,
  stderr: Writable
): CreateTuiSession {
  const { execute = executeCliCommand, ...cliDependencies } = dependencies
  return (io) =>
    new TuiSession({
      cliDependencies,
      commandStderr: stderr,
      commandStdout: stdout,
      execute,
      io,
    })
}

async function runScriptedTui(input: {
  createSession: CreateTuiSession
  renderOptions: RenderOptions
  stderr: Writable
  stdin: Readable
  stdout: Writable
}): Promise<number> {
  const lines = await readInputLines(input.stdin)
  let cursor = 0
  const nextLine = async () => lines[cursor++] ?? null
  const ask = async (prompt: string) => {
    const answer = await nextLine()
    if (answer !== null)
      writeTo(
        input.stdout,
        `${sanitizeTerminalText(prompt)}${sanitizeTerminalText(projectPromptAnswer(prompt, answer))}`
      )
    return answer
  }
  const session = input.createSession({
    append: (value, kind = "output") =>
      writeTo(kind === "error" ? input.stderr : input.stdout, value),
    ask,
    clearScreen: () => input.stdout.write("\u001b[2J\u001b[H"),
    onSnapshot: () => undefined,
    renderOptions: input.renderOptions,
  })
  try {
    await session.start()
    while (!session.exitRequested) {
      const line = await nextLine()
      if (line === null) break
      if (!line.trim()) continue
      await session.handleLine(line)
    }
    return 0
  } finally {
    session.clearState()
  }
}

async function readInputLines(input: Readable): Promise<string[]> {
  let value = ""
  for await (const chunk of input) value += String(chunk)
  if (!value) return []
  const lines = value.split(/\r?\n/)
  if (lines.at(-1) === "") lines.pop()
  return lines
}

class TuiSession {
  readonly renderOptions: RenderOptions
  exitRequested = false

  private readonly companyRows = new Map<number, CompanyRow>()
  private readonly agentRows = new Map<number, AgentRow>()
  private readonly fixtureRows = new Map<number, FixtureRow>()
  private readonly itemRows = new Map<number, ItemRow>()
  private currentCompanyId?: string
  private currentCompanyName?: string
  private currentEnvironment?: string
  private currentSandboxEnabled?: boolean
  private currentUserEmail?: string
  private currentAuthenticated = false
  private authAbort?: AbortController
  private operationAbort?: AbortController
  private agentApi?: ControlApi
  private currentReview?: WorkItemReviewData
  private selectedItem?: TuiSelectedItem
  private readonly cliDependencies: CliDependencies
  private readonly commandStderr: Writable
  private readonly commandStdout: Writable
  private readonly execute: ExecuteCliCommand
  private readonly io: TuiSessionIo
  private readonly confirm: ConfirmMutation
  private readonly conversationId = randomUUID()

  constructor(input: {
    cliDependencies: CliDependencies
    commandStderr: Writable
    commandStdout: Writable
    execute: ExecuteCliCommand
    io: TuiSessionIo
  }) {
    const login = input.cliDependencies.login ?? loginWithDeviceAuthorization
    const localLogin = input.cliDependencies.localLogin ?? loginWithMagicLink
    this.cliDependencies = {
      ...input.cliDependencies,
      login: (options) =>
        login({
          ...options,
          onAuthorizationRequested: (request) =>
            input.io.append(
              renderAssistantMessage(
                deviceAuthorizationWaitingMessage(request),
                input.io.renderOptions
              )
            ),
          signal: this.authAbort?.signal,
        }),
      localLogin: (options) =>
        localLogin({
          ...options,
          onMagicLinkSent: () =>
            input.io.append(
              renderAssistantMessage(
                magicLinkWaitingMessage(options.email, options.environment),
                input.io.renderOptions
              )
            ),
          signal: this.authAbort?.signal,
        }),
    }
    this.commandStderr = input.commandStderr
    this.commandStdout = input.commandStdout
    this.execute = input.execute
    this.io = input.io
    this.renderOptions = input.io.renderOptions
    this.confirm =
      input.cliDependencies.confirm ??
      createTuiConfirmation(
        input.io.ask,
        input.io.choose,
        input.io.append,
        this.renderOptions
      )
  }

  async start(): Promise<void> {
    const context = await this.loadVerifiedContext()
    if (!context) return

    this.updateCompanyFromContext(context.data)
    const [inbox, settings] =
      isAuthenticatedContext(context.data) && this.currentCompanyId
        ? await Promise.all([
            this.loadInbox(),
            this.loadWorkspaceHeaderSettings(),
          ])
        : [undefined, undefined]
    this.updateWorkspaceSettings(settings)
    if (inbox?.error && isAuthenticationError(inbox.error)) {
      this.writeSignedOutState(inbox.error)
      return
    }
    this.write(
      renderHeader(
        headerContext(context.data, inbox, settings),
        this.renderOptions
      )
    )
    if (inbox?.error) {
      this.writeError(inbox.error)
    }
  }

  async handleLine(line: string): Promise<void> {
    const trimmed = line.trim()
    if (!trimmed.startsWith("/")) {
      await this.handleConversation(trimmed)
      return
    }

    const parsed = parseSlashCommand(trimmed)
    if (!parsed.ok) {
      this.writeError(new CliError(parsed.code, parsed.message))
      return
    }

    const { args, definition } = parsed.value
    try {
      await this.handleSlashCommand(definition, args)
    } catch (error) {
      this.writeError(asCliError(error))
    }
  }

  requestExit(): void {
    this.authAbort?.abort()
    this.operationAbort?.abort()
    this.exitRequested = true
  }

  cancelCurrentOperation(): boolean {
    const operation = this.operationAbort ?? this.authAbort
    if (!operation) return false
    operation.abort()
    return true
  }

  private async handleConversation(input: string): Promise<void> {
    if (this.selectedItem && isRevisionFeedback(input)) {
      this.write(
        renderAssistantMessage(
          "I’ll treat that as feedback for a revised recommendation. It will be recorded as a rework request, not applied as a direct field change.",
          this.renderOptions
        )
      )
      await this.mutate(
        "rework",
        ["--reason", input],
        "/rework [row-or-id] [--reason <reason>]"
      )
      return
    }
    const local = localConversationResponse(input)
    if (local) {
      this.write(renderAssistantMessage(local.message, this.renderOptions))
      if (local.showCommands) this.showHelp()
      return
    }

    const contextual = await this.contextualConversation(input)
    if (contextual.handled) {
      if (!contextual.result) return
      if (contextual.result.route === "command") {
        this.writeConversationResult(
          await this.runCommand(
            contextualCommandArgs(contextual.result.command)
          ),
          input
        )
      } else if (contextual.result.message && !contextual.rendered) {
        this.write(
          renderAssistantMessage(contextual.result.message, this.renderOptions)
        )
      }
      return
    }

    if (this.selectedItem && isReadOnlyQuestion(input)) {
      this.writeConversationResult(
        await this.runCommand([
          "work",
          "ask",
          this.selectedItem.id,
          "--question",
          input,
        ]),
        input
      )
      return
    }

    this.writeConversationResult(await this.runCommand(["chat", input]), input)
  }

  private async contextualConversation(
    input: string
  ): Promise<ContextualConversationResult> {
    if (!this.currentCompanyId) return { handled: false }
    const api = this.getAgentApi()
    const request = {
      companyId: this.currentCompanyId,
      input,
      selectedItemId: this.selectedItem?.id ?? null,
      expectedReviewVersion: this.selectedItem?.reviewVersion ?? null,
      conversationId: this.conversationId,
    }
    if (api.contextualChatStream && this.io.setLiveMessage) {
      const controller = new AbortController()
      this.operationAbort = controller
      let streamed = false
      try {
        const result = await api.contextualChatStream(
          request,
          (cumulativeText) => {
            streamed = true
            this.io.setLiveMessage?.(
              renderAssistantMessage(cumulativeText, this.renderOptions)
            )
          },
          controller.signal
        )
        this.io.setLiveMessage(null)
        this.updateReviewVersion(result.reviewVersion)
        if (streamed && result.route === "question") {
          this.write(renderAssistantMessage(result.message, this.renderOptions))
          return { handled: true, rendered: true, result }
        }
        return { handled: true, result }
      } catch (error) {
        this.io.setLiveMessage(null)
        const parsed = asCliError(error)
        if (parsed.code === "command_cancelled") {
          this.write(
            renderAssistantMessage("Answer stopped.", this.renderOptions)
          )
        } else {
          this.writeError(parsed)
        }
        return { handled: true }
      } finally {
        if (this.operationAbort === controller) this.operationAbort = undefined
      }
    }
    if (!api.contextualChat) return { handled: false }
    try {
      const result = await api.contextualChat(request)
      this.updateReviewVersion(result.reviewVersion)
      return { handled: true, result }
    } catch {
      return { handled: false }
    }
  }

  private updateReviewVersion(reviewVersion: string | null): void {
    if (!this.selectedItem || !reviewVersion) return
    this.selectedItem = { ...this.selectedItem, reviewVersion }
    this.notifySnapshot()
  }

  clearState(): void {
    this.authAbort?.abort()
    this.operationAbort?.abort()
    this.io.setLiveMessage?.(null)
    this.clearCompanyBoundState()
    this.currentCompanyId = undefined
    this.currentCompanyName = undefined
    this.currentEnvironment = undefined
    this.currentUserEmail = undefined
    this.currentAuthenticated = false
    this.notifySnapshot()
  }

  private async handleSlashCommand(
    definition: SlashCommandDefinition,
    args: string[]
  ): Promise<void> {
    if (definition.view) {
      requireNoArguments(args, definition.usage)
      await this.showView(definition.view)
      return
    }

    switch (definition.command) {
      case "/":
        requireNoArguments(args, definition.usage)
        return
      case "/login":
        await this.login(args)
        return
      case "/auth-status": {
        requireNoArguments(args, definition.usage)
        const context = await this.loadVerifiedContext()
        if (!context) return
        this.updateCompanyFromContext(context.data)
        this.writeResult(await this.runCommand(["auth", "status"]))
        return
      }
      case "/logout":
        requireNoArguments(args, definition.usage)
        await this.logout()
        return
      case "/workspace":
        requireNoArguments(args, definition.usage)
        await this.showCompanies(true)
        return
      case "/companies":
        requireNoArguments(args, definition.usage)
        await this.showCompanies(true)
        return
      case "/company":
        await this.switchCompany(args, definition.usage)
        return
      case "/agents":
        requireNoArguments(args, definition.usage)
        await this.showAgents(true)
        return
      case "/agent-list":
        requireNoArguments(args, definition.usage)
        await this.showAgents(false)
        return
      case "/agent-show":
        await this.showAgentCommand(args, definition.usage)
        return
      case "/agent-validate":
        await this.validateAgentSkill(args, definition.usage)
        return
      case "/agent-install":
        await this.installAgentSkill(args, definition.usage)
        return
      case "/agent-test":
        await this.testAgentCommand(args, definition.usage)
        return
      case "/agent-activate":
      case "/agent-deactivate":
        await this.changeAgentStatus(
          definition.command === "/agent-activate" ? "activate" : "deactivate",
          args,
          definition.usage
        )
        return
      case "/agent-pause":
      case "/agent-resume":
      case "/agent-disable":
        await this.changeAgentStatus(
          definition.command.slice("/agent-".length) as Exclude<
            AgentLifecycleUiAction,
            "rollback"
          >,
          args,
          definition.usage
        )
        return
      case "/agent-versions":
        await this.showAgentVersions(args, definition.usage)
        return
      case "/agent-rollback":
        await this.rollbackAgentCommand(args, definition.usage)
        return
      case "/sandbox":
        requireNoArguments(args, definition.usage)
        await this.showSandbox()
        return
      case "/settings":
        requireNoArguments(args, definition.usage)
        await this.showWorkspaceSettings()
        return
      case "/fixtures":
        requireNoArguments(args, definition.usage)
        await this.showFixtures()
        return
      case "/run-fixture":
        await this.runFixture(args, definition.usage)
        return
      case "/open":
        await this.openItem(args, definition.usage)
        return
      case "/refresh":
        requireNoArguments(args, definition.usage)
        await this.refresh()
        return
      case "/recommendation":
      case "/evidence":
      case "/draft":
      case "/history":
      case "/detail":
        requireNoArguments(args, definition.usage)
        await this.showSelectedSection(definition.command.slice(1))
        return
      case "/approve":
      case "/reject":
      case "/deny":
      case "/resolve":
      case "/rework":
      case "/edit":
      case "/execute":
        await this.mutate(
          definition.backendAction as MutationAction,
          args,
          definition.usage
        )
        return
      case "/unselect":
        requireNoArguments(args, definition.usage)
        this.selectedItem = undefined
        this.currentReview = undefined
        this.io.setItemWorkspace?.(null)
        this.notifySnapshot()
        if (!this.io.setItemWorkspace)
          this.write(
            renderHumanResult({ selectedItem: null }, this.renderOptions)
          )
        return
      case "/context":
        requireNoArguments(args, definition.usage)
        await this.showContext()
        return
      case "/clear":
        requireNoArguments(args, definition.usage)
        this.io.clearScreen()
        await this.showHeader()
        return
      case "/help":
        requireNoArguments(args, definition.usage)
        this.showHelp()
        return
      case "/exit":
      case "/quit":
        requireNoArguments(args, definition.usage)
        this.exitRequested = true
        return
    }
  }

  private async login(args: string[]): Promise<void> {
    const local = args[0] === "--local"
    if ((local && args.length !== 2) || (!local && args.length !== 0)) {
      throw new CliError(
        "invalid_arguments",
        "Use /login for hosted sign-in, or /login --local <email> for local engineering."
      )
    }
    if (this.currentUserEmail) {
      this.write(
        renderAssistantMessage(
          `Already signed in as ${this.currentUserEmail}. Use /logout before signing in as a different account.`,
          this.renderOptions
        )
      )
      return
    }
    const controller = new AbortController()
    this.authAbort = controller
    const command = local
      ? ["auth", "login", "--local", "--email", args[1] ?? ""]
      : ["auth", "login"]
    const result = await this.runCommand(command).finally(() => {
      if (this.authAbort === controller) this.authAbort = undefined
    })
    if (!result.ok) {
      this.writeError(result.error)
      return
    }
    const loginUser = asRecord(asRecord(result.data)?.user)
    const loginEmail = stringValue(loginUser?.email)
    this.write(
      renderAssistantMessage(
        `Signed in${loginEmail ? ` as ${loginEmail}` : ""}.`,
        this.renderOptions
      )
    )
    this.clearState()
    await this.showHeader()
    await this.showCompanies(true)
  }

  private async logout(): Promise<void> {
    const result = await this.runCommand(["auth", "logout"])
    if (!result.ok) {
      this.writeError(result.error)
      return
    }
    this.write(renderAssistantMessage("Signed out.", this.renderOptions))
    this.clearState()
    await this.showHeader()
  }

  private async showCompanies(interactive = false): Promise<void> {
    const result = await this.runCommand(["company", "list"])
    if (!result.ok) {
      this.writeError(result.error)
      return
    }
    const companies = arrayFrom(result.data, "companies")
    this.companyRows.clear()
    const numbered = companies.map((company, index) => {
      const record = asRecord(company)
      const id = stringValue(record?.id)
      const name = stringValue(record?.name)
      if (id && name) this.companyRows.set(index + 1, { id, name })
      return { ...record, row: index + 1 }
    })
    const choices = numbered.map((company) => {
      const record = asRecord(company)
      const row = String(record?.row ?? "-")
      const name = stringValue(record?.name) ?? "Unnamed workspace"
      const role = stringValue(record?.role)
      return `${row}. ${sanitizeTerminalText(name)}${role ? ` · ${sanitizeTerminalText(role)}` : ""}`
    })
    if (interactive && this.io.choose && this.companyRows.size > 0) {
      const selected = await this.io.choose(
        "Choose workspace",
        numbered.flatMap<TuiChoice>((company) => {
          const record = asRecord(company)
          const id = stringValue(record?.id)
          const name = stringValue(record?.name)
          if (!id || !name) return []
          const role = stringValue(record?.role)
          const current = id === this.currentCompanyId ? "current" : undefined
          return [
            {
              value: id,
              label: name,
              description: [role, current].filter(Boolean).join(" · "),
            },
          ]
        })
      )
      if (selected) await this.selectCompany(selected)
      return
    }
    this.write(
      choices.length > 0
        ? [
            "Available workspaces",
            ...choices,
            "",
            "Choose one with /company 1.",
          ].join("\n")
        : "No workspaces are available for this account."
    )
  }

  private async showSandbox(): Promise<void> {
    if (!this.currentAuthenticated) {
      this.writeError(
        new CliError("unauthorized", "Sign in with /login first.")
      )
      return
    }
    const result = await this.runCommand(["sandbox", "open"])
    if (!result.ok) {
      this.writeError(result.error)
      return
    }
    this.writeResult(result)

    const candidates = arrayFrom(result.data, "candidates")
      .map(asRecord)
      .filter((candidate): candidate is Record<string, unknown> =>
        Boolean(candidate)
      )
    if (!this.io.choose || candidates.length === 0) return
    const decisions = new Map<
      string,
      {
        action: "approved" | "edited" | "rejected" | "rework" | "executed"
        quantity?: number
      }
    >()

    while (true) {
      const selected = await this.io.choose("Choose from Sandbox Inbox", [
        ...candidates.flatMap<TuiChoice>((candidate) => {
          const sku = stringValue(candidate.sku)
          if (!sku) return []
          const recommendation = asRecord(candidate.recommendation)
          const status = stringValue(recommendation?.status)?.replaceAll(
            "_",
            " "
          )
          const quantity = recommendation?.quantity
          const temporary = decisions.get(sku)?.action
          return [
            {
              value: sku,
              label: stringValue(candidate.productName) ?? sku,
              description: [
                sku,
                typeof quantity === "number"
                  ? `recommend ${quantity}`
                  : undefined,
                temporary ? `temporary ${temporary}` : status,
              ]
                .filter(Boolean)
                .join(" · "),
            },
          ]
        }),
        {
          value: "done",
          label: "End Sandbox session",
          description: "Discard every temporary decision",
        },
      ])
      if (!selected || selected === "done") return
      const candidate = candidates.find(
        (entry) => stringValue(entry.sku) === selected
      )
      if (!candidate) continue
      const previous = decisions.get(selected)
      const availableActions = sandboxAvailableActions(candidate, previous)
      this.write(
        renderReviewWorkspace(
          sandboxReviewProjection(candidate, availableActions, previous),
          this.renderOptions
        )
      )
      const action = await this.io.choose("Choose next action", [
        ...availableActions.map(workItemActionChoice),
        {
          value: "back",
          label: "Back to Sandbox Inbox",
          description: "Leave this candidate unchanged",
        },
      ])
      if (!action || action === "back") continue

      let quantity: number | undefined
      if (action === "edit") {
        const answer = await this.io.ask("Temporary order quantity: ")
        quantity = answer?.trim() ? Number(answer.trim()) : Number.NaN
        if (!Number.isFinite(quantity) || quantity <= 0) {
          this.writeError(
            new CliError(
              "invalid_arguments",
              "Enter a quantity greater than zero. Nothing was changed."
            )
          )
          continue
        }
      }

      const confirmed = await this.io.choose(
        "Confirm temporary Sandbox action",
        [
          {
            value: "confirm",
            label: "Simulate only",
            description: "Keep this result only until the Sandbox session ends",
          },
          {
            value: "cancel",
            label: "Cancel",
            description: "Make no temporary change",
          },
        ]
      )
      if (confirmed !== "confirm") continue

      const temporaryAction =
        action === "approve"
          ? "approved"
          : action === "edit"
            ? "edited"
            : action === "reject"
              ? "rejected"
              : action === "execute"
                ? "executed"
                : "rework"
      decisions.set(selected, { action: temporaryAction, quantity })
      this.write(
        renderReviewWorkspace(
          sandboxReviewProjection(
            candidate,
            sandboxAvailableActions(candidate, {
              action: temporaryAction,
              quantity,
            }),
            { action: temporaryAction, quantity }
          ),
          this.renderOptions
        )
      )
    }
  }

  private async switchCompany(args: string[], usage: string): Promise<void> {
    if (args.length !== 1)
      throw new CliError("invalid_arguments", `Use: ${usage}.`)
    const companyId = this.resolveCompanyTarget(args[0] ?? "")
    await this.selectCompany(companyId)
  }

  private async selectCompany(companyId: string): Promise<void> {
    const result = await this.runCommand(["company", "use", companyId])
    if (!result.ok) {
      this.writeError(result.error)
      return
    }
    this.clearCompanyBoundState()
    this.currentCompanyId = companyId
    const selectedCompany = asRecord(asRecord(result.data)?.company)
    const selectedName = stringValue(selectedCompany?.name)
    this.write(
      renderAssistantMessage(
        `Workspace selected${selectedName ? `: ${selectedName}` : "."}`,
        this.renderOptions
      )
    )
    await this.showHeader()
  }

  private async showAgents(interactive: boolean): Promise<void> {
    let agents = await this.loadAgents()
    if (agents.length === 0) {
      if (interactive && this.io.choose) {
        const selected = await this.io.choose("No agents installed", [
          {
            value: "cancel",
            label: "Back",
            description: "Leave this workspace unchanged",
          },
          {
            value: "install",
            label: "Install from SKILL.md",
            description: "Validate a skill file, then review before installing",
          },
        ])
        if (selected === "install") {
          const path = await this.io.ask("Path to SKILL.md: ")
          if (path?.trim()) await this.installAgentFromFile(path.trim())
        }
        return
      }
      this.write(
        renderAssistantMessage(
          "No agents are installed in this workspace yet.",
          this.renderOptions
        )
      )
      return
    }
    if (!interactive || !this.io.choose) {
      this.write(renderAgentList(agents, this.renderOptions))
      return
    }

    while (true) {
      const selected = await this.io.choose(
        "Choose an agent",
        agents.map((agent) => ({
          value: agent.id,
          label: agent.name,
          description: agentChoiceDescription(agent),
        }))
      )
      if (!selected) return
      const agent = agents.find(({ id }) => id === selected)
      if (!agent) continue
      this.write(renderAgentOverview(agent, this.renderOptions))
      if (!(await this.showAgentMenu(agent))) return
      agents = await this.loadAgents()
    }
  }

  private async showAgentCommand(args: string[], usage: string): Promise<void> {
    if (args.length !== 1)
      throw new CliError("invalid_arguments", `Use: ${usage}.`)
    const agent = await this.resolveAgentTarget(args[0] ?? "")
    this.write(renderAgentOverview(agent, this.renderOptions))
    this.write(renderAgentSetup(agent, this.renderOptions))
  }

  private async validateAgentSkill(
    args: string[],
    usage: string
  ): Promise<void> {
    if (args.length !== 1)
      throw new CliError("invalid_arguments", `Use: ${usage}.`)
    const skillMarkdown = await readAgentSkillFile(args[0] ?? "")
    const result = await this.getAgentApi().validateAgent({
      companyId: this.requireCompanyId(),
      skillMarkdown,
    })
    this.write(renderAgentValidation(result, this.renderOptions))
  }

  private async installAgentSkill(
    args: string[],
    usage: string
  ): Promise<void> {
    if (args.length !== 1)
      throw new CliError("invalid_arguments", `Use: ${usage}.`)
    await this.installAgentFromFile(args[0] ?? "")
  }

  private async installAgentFromFile(path: string): Promise<void> {
    const companyId = this.requireCompanyId()
    const skillMarkdown = await readAgentSkillFile(path)
    const api = this.getAgentApi()
    const validation = await api.validateAgent({ companyId, skillMarkdown })
    this.write(renderAgentValidation(validation, this.renderOptions))
    if (!validation.valid || !validation.preview) {
      this.write(
        renderAssistantMessage(
          "Nothing was installed. Fix the issues above, then validate the skill again.",
          this.renderOptions
        )
      )
      return
    }
    const confirmed = await this.confirmAgentInstall(validation.preview)
    if (!confirmed) {
      this.write(
        renderAssistantMessage(
          "The agent was not installed.",
          this.renderOptions
        )
      )
      return
    }
    const result = await api.installAgent({
      companyId,
      skillMarkdown,
      activate: false,
    })
    this.write(
      renderAssistantMessage(
        `${result.agent.name} v${result.agent.version} is installed but inactive. Run a Sandbox test before activating it.`,
        this.renderOptions
      )
    )
    this.write(renderAgentOverview(result.agent, this.renderOptions))
  }

  private async confirmAgentInstall(
    preview: NonNullable<AgentValidateResponse["preview"]>
  ): Promise<boolean> {
    this.write(
      renderAgentFields(
        "Confirm agent installation",
        [
          ["Agent", preview.name],
          ["Version", preview.version],
          ["Workflow", preview.workflowKey],
          ["Connections", String(preview.capabilities.length)],
          ["Initial status", "Inactive"],
        ],
        this.renderOptions
      )
    )
    if (this.io.choose) {
      const selected = await this.io.choose("Install this agent?", [
        {
          value: "cancel",
          label: "Cancel",
          description: "Do not install anything",
        },
        {
          value: "install",
          label: "Install inactive agent",
          description: "Install this version, then run a Sandbox test",
        },
      ])
      return selected === "install"
    }
    const answer = await this.io.ask(
      "Install this inactive agent? Type yes to confirm: "
    )
    return answer !== null && isYes(answer)
  }

  private async testAgentCommand(args: string[], usage: string): Promise<void> {
    if (args.length !== 1)
      throw new CliError("invalid_arguments", `Use: ${usage}.`)
    const agent = await this.resolveAgentTarget(args[0] ?? "")
    await this.runAgentTest(agent)
  }

  private async changeAgentStatus(
    action: Exclude<AgentLifecycleUiAction, "rollback">,
    args: string[],
    usage: string
  ): Promise<void> {
    if (args.length !== 1)
      throw new CliError("invalid_arguments", `Use: ${usage}.`)
    const agent = await this.resolveAgentTarget(args[0] ?? "")
    if (action === "activate" && hasAgentSetupBlocker(agent)) {
      this.write(renderAgentSetup(agent, this.renderOptions))
      throw new CliError(
        "agent_setup_incomplete",
        "This agent cannot be activated until the setup issues above are fixed."
      )
    }
    await this.runAgentLifecycleAction(agent, action)
  }

  private async rollbackAgentCommand(
    args: string[],
    usage: string
  ): Promise<void> {
    if (args.length !== 2)
      throw new CliError("invalid_arguments", `Use: ${usage}.`)
    const agent = await this.resolveAgentTarget(args[0] ?? "")
    const version = args[1]?.trim()
    if (!version) throw new CliError("invalid_arguments", `Use: ${usage}.`)
    await this.runAgentLifecycleAction(agent, "rollback", version)
  }

  private async showAgentVersions(
    args: string[],
    usage: string
  ): Promise<void> {
    if (args.length !== 1)
      throw new CliError("invalid_arguments", `Use: ${usage}.`)
    const selected = await this.resolveAgentTarget(args[0] ?? "")
    const versions = (await this.loadAgents())
      .filter(({ workflowKey }) => workflowKey === selected.workflowKey)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    this.write(renderAgentVersions(selected, versions, this.renderOptions))
  }

  private async showAgentMenu(initialAgent: AgentSummary): Promise<boolean> {
    if (!this.io.choose) return false
    let agent = initialAgent
    while (true) {
      const blockers = hasAgentSetupBlocker(agent)
      const choices: TuiChoice[] = [
        {
          value: "overview",
          label: "Overview",
          description: "See status, version, and workflow details",
        },
        {
          value: "setup",
          label: blockers ? "Fix setup issues" : "Connections and permissions",
          description: blockers
            ? "See exactly what must be connected or permitted"
            : "Review the systems and access this agent uses",
        },
      ]
      if (agent.status !== "archived")
        choices.push({
          value: "test",
          label: "Run a Sandbox test",
          description: "Use safe test data without changing a live system",
        })
      if (agent.active)
        choices.push({
          value: "pause",
          label: "Pause",
          description: "Stop new work while keeping this version resumable",
        })
      else if (agent.status === "paused")
        choices.push({
          value: "resume",
          label: "Resume",
          description: "Run a fresh Sandbox readiness check before new work",
        })
      else if (agent.status !== "archived" && !blockers)
        choices.push({
          value: "activate",
          label: "Activate",
          description: "Allow this validated version to start new work",
        })
      if (!["archived", "disabled"].includes(agent.status))
        choices.push({
          value: "disable",
          label: "Disable",
          description: "Block this agent until a deliberate later change",
        })
      if (agent.status !== "archived")
        choices.push({
          value: "rollback",
          label: "Restore an earlier version",
          description: `Current installed version is ${agent.version}`,
        })
      choices.push({ value: "back", label: "Back to Agents" })

      const selected = await this.io.choose(`Agent · ${agent.name}`, choices)
      if (!selected) return false
      if (selected === "back") return true
      if (selected === "overview") {
        this.write(renderAgentOverview(agent, this.renderOptions))
        continue
      }
      if (selected === "setup") {
        this.write(renderAgentSetup(agent, this.renderOptions))
        continue
      }
      if (selected === "test") {
        agent = await this.runAgentTest(agent)
        continue
      }
      if (selected === "rollback") {
        const version = await this.io.ask("Version to restore: ")
        if (!version?.trim()) continue
        agent =
          (await this.runAgentLifecycleAction(
            agent,
            "rollback",
            version.trim()
          )) ?? agent
        continue
      }
      if (
        selected === "activate" ||
        selected === "deactivate" ||
        selected === "pause" ||
        selected === "resume" ||
        selected === "disable"
      ) {
        agent = (await this.runAgentLifecycleAction(agent, selected)) ?? agent
      }
    }
  }

  private async runAgentTest(agent: AgentSummary): Promise<AgentSummary> {
    const result = await this.getAgentApi().testAgent(agent.id, {
      companyId: this.requireCompanyId(),
    })
    this.write(renderAgentTestResult(agent, result, this.renderOptions))
    const refreshed = await this.loadAgents()
    return refreshed.find(({ id }) => id === agent.id) ?? agent
  }

  private async runAgentLifecycleAction(
    agent: AgentSummary,
    action: AgentLifecycleUiAction,
    version?: string
  ): Promise<AgentSummary | undefined> {
    const confirmed = await this.confirmAgentLifecycle(agent, action, version)
    if (!confirmed) {
      this.write(
        renderAssistantMessage(
          `${agent.name} was not changed.`,
          this.renderOptions
        )
      )
      return undefined
    }
    const api = this.getAgentApi()
    const request = {
      companyId: this.requireCompanyId(),
      expectedVersion: agent.stateVersion,
      reason: "Confirmed in the Mandala terminal.",
      ...(version ? { version } : {}),
    }
    const result =
      action === "activate"
        ? await api.activateAgent(agent.id, request)
        : action === "deactivate"
          ? await api.deactivateAgent(agent.id, request)
          : action === "pause"
            ? await api.pauseAgent(agent.id, request)
            : action === "resume"
              ? await api.resumeAgent(agent.id, request)
              : action === "disable"
                ? await api.disableAgent(agent.id, request)
                : await api.rollbackAgent(agent.id, request)
    this.write(
      renderAgentLifecycleResult(result.agent, action, this.renderOptions)
    )
    return result.agent
  }

  private async confirmAgentLifecycle(
    agent: AgentSummary,
    action: AgentLifecycleUiAction,
    version?: string
  ): Promise<boolean> {
    const effect = agentLifecycleEffect(action, agent, version)
    this.write(
      renderHumanResult(
        {
          agent: agent.name,
          currentStatus: agentStatusLabel(agent),
          proposedChange: effect,
        },
        { ...this.renderOptions, title: "Confirm agent change" }
      )
    )
    if (this.io.choose) {
      const selected = await this.io.choose("Confirm agent change", [
        {
          value: "cancel",
          label: "Cancel",
          description: "Leave the agent unchanged",
        },
        {
          value: "confirm",
          label: agentLifecycleActionLabel(action, version),
          description: effect,
        },
      ])
      return selected === "confirm"
    }
    const answer = await this.io.ask(
      `${agentLifecycleActionLabel(action, version)}? Type yes to confirm: `
    )
    return answer !== null && isYes(answer)
  }

  private async loadAgents(): Promise<AgentSummary[]> {
    const result = await this.getAgentApi().listAgents(this.requireCompanyId())
    this.agentRows.clear()
    result.agents.forEach((agent, index) => {
      this.agentRows.set(index + 1, { id: agent.id, name: agent.name })
    })
    return result.agents
  }

  private async resolveAgentTarget(target: string): Promise<AgentSummary> {
    const agents = await this.loadAgents()
    const agentId = isRowNumber(target)
      ? this.agentRows.get(Number(target))?.id
      : target
    if (!agentId || !uuidPattern.test(agentId))
      throw new CliError(
        "invalid_target",
        "Use a row from /agent-list or a full agent ID."
      )
    const agent = agents.find(({ id }) => id === agentId)
    if (!agent)
      throw new CliError(
        "agent_not_found",
        "That agent is not installed in the selected workspace."
      )
    return agent
  }

  private requireCompanyId(): string {
    if (!this.currentCompanyId)
      throw new CliError(
        "company_required",
        "Choose a workspace before managing agents."
      )
    return this.currentCompanyId
  }

  private getAgentApi(): ControlApi {
    if (this.agentApi) return this.agentApi
    if (this.cliDependencies.api) {
      this.agentApi = this.cliDependencies.api
      return this.agentApi
    }
    const environment = this.cliDependencies.environment ?? process.env
    const store =
      this.cliDependencies.store ?? createRuntimeSecureStore(environment)
    const session =
      this.cliDependencies.session ?? new SessionManager(store, environment)
    this.agentApi = new ApiClient(getApiUrl(environment), session)
    return this.agentApi
  }

  private async showView(view: SlashViewDefinition): Promise<void> {
    this.itemRows.clear()
    const result = await this.runCommand([...view.backendArgs])
    if (!result.ok) {
      this.writeError(result.error)
      return
    }
    const numbered = this.showViewData(result.data, view, !this.io.choose)
    if (!this.io.choose || numbered.length === 0) {
      if (this.io.choose && numbered.length === 0)
        this.writeViewData(numbered, view)
      return
    }
    const choices = numbered.flatMap<TuiChoice>((item) => {
      const record = asRecord(item)
      const title = stringValue(record?.title)
      const row = record?.row
      if (typeof row !== "number" || !title) return []
      const status = stringValue(record?.status) ?? "unknown"
      const priority = priorityLabel(record?.priority)
      const source = workItemSource(record)
      const warnings = nonNegativeNumber(record?.warningCount)
      return [
        {
          value: String(row),
          label: title,
          description: [
            status,
            priority,
            source,
            warnings
              ? `${warnings} warning${warnings === 1 ? "" : "s"}`
              : undefined,
          ]
            .filter(Boolean)
            .join(" · "),
        },
      ]
    })
    while (true) {
      const selected = await this.io.choose(
        `Choose from ${view.label}`,
        choices
      )
      if (!selected) return
      const detail = await this.fetchCanonicalItem(selected)
      if (!detail) return
      this.writeItemOverview(detail)
      if (this.io.setItemWorkspace) return
      const returnToList = await this.showItemMenu(detail, true)
      if (!returnToList) return
    }
  }

  private showViewData(
    value: unknown,
    view: SlashViewDefinition,
    render = true
  ): unknown[] {
    const visible = filterWorkItems(value, view)
    const numbered = visible.map((item, index) => {
      const record = asRecord(item)
      const id = stringValue(record?.id)
      const title = stringValue(record?.title)
      const status = stringValue(record?.status)
      if (id && title && status && this.currentCompanyId) {
        this.itemRows.set(index + 1, {
          companyId: this.currentCompanyId,
          id,
          itemType: stringValue(record?.itemType),
          nextAction: nextActionForStatus(status),
          owner: workItemOwner(record),
          priority: priorityLabel(record?.priority),
          source: workItemSource(record),
          status,
          title,
          warningCount: nonNegativeNumber(record?.warningCount),
        })
      }
      return record
        ? {
            ...record,
            row: index + 1,
            owner: workItemOwner(record) ?? null,
            source: workItemSource(record) ?? null,
            waiting: record.updatedAt ?? record.createdAt ?? null,
          }
        : item
    })
    if (render) this.writeViewData(numbered, view)
    return numbered
  }

  private writeViewData(numbered: unknown[], view: SlashViewDefinition): void {
    this.write(
      renderInbox(
        {
          items: numbered,
          listLabel: view.label,
          workspaceName: this.currentCompanyName ?? null,
        },
        {
          ...this.renderOptions,
          title: view.label,
        }
      )
    )
  }

  private async showFixtures(): Promise<void> {
    const result = await this.runCommand(["workflow", "fixture", "list"])
    if (!result.ok) {
      this.writeError(result.error)
      return
    }
    const scenarios = arrayFrom(result.data, "scenarios")
    this.fixtureRows.clear()
    const numbered = scenarios.map((scenario, index) => {
      const record = asRecord(scenario)
      const id = stringValue(record?.id)
      const description = stringValue(record?.description)
      if (id) {
        this.fixtureRows.set(index + 1, {
          description: description ?? "",
          id,
        })
      }
      return { ...record, row: index + 1 }
    })
    if (this.io.choose && numbered.length > 0) {
      const choices = numbered.flatMap<TuiChoice>((scenario) => {
        const record = asRecord(scenario)
        const id = stringValue(record?.id)
        if (!id) return []
        return [
          {
            value: id,
            label: fixtureLabel(id),
            description: stringValue(record?.description),
          },
        ]
      })
      const selected = await this.io.choose("Choose a sandbox fixture", choices)
      if (!selected) return
      const action = await this.io.choose(
        `Fixture · ${fixtureLabel(selected)}`,
        [
          {
            value: "cancel",
            label: "Cancel",
            description: "Do not create sandbox work",
          },
          {
            value: "run",
            label:
              selected === "synthetic_agent_run"
                ? "Run test agent"
                : "Run fixture",
            description:
              selected === "synthetic_agent_run"
                ? "Generate synthetic commerce data and analyze it with read-only tools"
                : `Create this scenario in ${this.currentCompanyName ?? "the selected Sandbox workspace"}`,
          },
        ]
      )
      if (action === "run")
        await this.runFixture([selected], "/run-fixture <row-or-id>")
      return
    }
    this.write(
      numbered.length > 0
        ? renderHumanResult(
            { ...asRecord(result.data), scenarios: numbered },
            this.renderOptions
          )
        : renderAssistantMessage(
            "No sandbox fixtures are available.",
            this.renderOptions
          )
    )
  }

  private async runFixture(args: string[], usage: string): Promise<void> {
    if (args.length !== 1)
      throw new CliError("invalid_arguments", `Use: ${usage}.`)
    const target = args[0] ?? ""
    const scenarioId = isRowNumber(target)
      ? this.fixtureRows.get(Number(target))?.id
      : target
    if (!scenarioId)
      throw new CliError(
        "invalid_target",
        "That fixture row is not present in the last rendered fixture list."
      )
    const result = await this.runCommand([
      "workflow",
      "fixture",
      "run",
      scenarioId,
    ])
    this.writeResult(result)
    if (result.ok) {
      const data = asRecord(result.data)
      const dataset = asRecord(data?.dataset)
      const agentRun = asRecord(data?.agentRun)
      const productCount = numericValue(dataset?.productCount)
      const salesRecordCount = numericValue(dataset?.salesRecordCount)
      const eventCount = numericValue(dataset?.businessEventCount)
      const toolCallCount = numericValue(agentRun?.toolCallCount)
      this.write(
        renderAssistantMessage(
          dataset
            ? `Mandala Bean Co. test agent finished. It analyzed ${formatCount(productCount)} products, ${formatCount(salesRecordCount)} daily sales records, and ${formatCount(eventCount)} business events using ${formatCount(toolCallCount)} read-only tool calls. Open /inbox to review its recommendation.`
            : "Fixture finished. Open /inbox to review any work it created.",
          this.renderOptions
        )
      )
    }
  }

  private async openItem(args: string[], usage: string): Promise<void> {
    if (args.length !== 1)
      throw new CliError("invalid_arguments", `Use: ${usage}.`)
    const canonical = await this.fetchCanonicalItem(args[0])
    if (!canonical) return
    this.writeItemOverview(canonical)
    if (this.io.choose && !this.io.setItemWorkspace)
      await this.showItemMenu(canonical, false)
  }

  private async showItemMenu(
    detail: WorkItemDetail,
    returnToList: boolean
  ): Promise<boolean> {
    if (!this.io.choose) return false
    while (true) {
      const choices = (this.currentReview?.availableActions ?? []).map(
        workItemActionChoice
      )
      choices.push(
        {
          value: "detail",
          label: "Complete diagnostics",
          description: "Show every canonical field",
        },
        {
          value: "back",
          label: returnToList ? "Back to Inbox" : "Close menu",
        }
      )

      const selected = await this.io.choose("Choose next action", choices)
      if (!selected || selected === "back") return returnToList
      if (selected === "detail") {
        await this.showSelectedSection("detail")
        continue
      }
      const changed = await this.mutate(
        selected as MutationAction,
        [],
        mutationUsage(selected as MutationAction)
      )
      if (changed) return false
    }
  }

  private async refresh(): Promise<void> {
    if (this.selectedItem) {
      const canonical = await this.fetchCanonicalItem()
      if (canonical) this.writeItemOverview(canonical)
      return
    }
    const inbox = getSlashCommand("/inbox")?.view
    if (inbox) await this.showView(inbox)
  }

  private async showSelectedSection(section: string): Promise<void> {
    const detail = await this.fetchCanonicalItem()
    if (!detail) return
    if (section === "draft") {
      if (detail.draft)
        this.write(renderDraftPreview(detail.draft, this.renderOptions))
      else this.write(renderHumanResult({ draft: null }, this.renderOptions))
      return
    }
    if (section === "history") {
      this.write(renderActivityHistory(detail, this.renderOptions))
      return
    }
    if (section === "detail") {
      this.write(renderHumanResult(detail, this.renderOptions))
      return
    }
    this.write(
      section === "recommendation" &&
        detail.item.itemType === "procurement_reorder_review"
        ? renderProcurementReview(detail, this.renderOptions)
        : section === "recommendation"
          ? renderHumanResult(
              { recommendation: detail.recommendation },
              { ...this.renderOptions, title: "Recommendation" }
            )
          : renderEvidenceSummary(detail, this.renderOptions)
    )
  }

  private async mutate(
    action: MutationAction,
    args: string[],
    usage: string
  ): Promise<boolean> {
    const parsed = parseMutationArguments(args, usage)
    const detail = await this.fetchCanonicalItem(parsed.target)
    if (!detail || !this.selectedItem) return false
    this.writeItemOverview(detail)

    if (action === "edit" && parsed.assignments.length === 0) {
      const assignment = await this.io.ask(
        "Edit assignment (JSON Pointer, for example /lines/0/quantity=24): "
      )
      if (assignment === null) {
        return false
      }
      if (!assignment.trim())
        throw new CliError(
          "clarification_required",
          "Enter a JSON Pointer assignment for the draft edit."
        )
      parsed.assignments.push(assignment.trim())
    }

    if (["edit", "reject", "rework"].includes(action) && !parsed.reason) {
      const reason = await this.io.ask("Reason: ")
      if (reason === null) {
        return false
      }
      if (!reason.trim())
        throw new CliError(
          "clarification_required",
          "Enter the reason to record with this decision."
        )
      parsed.reason = reason.trim()
    }

    const warnings = collectWarnings(detail)
    if (
      (action === "approve" || action === "edit") &&
      warnings.length > 0 &&
      !parsed.acknowledgeWarnings
    ) {
      const warningPrompt = `Acknowledge ${warnings.length} current warning${warnings.length === 1 ? "" : "s"}?`
      const acknowledged = this.io.choose
        ? (await this.io.choose(warningPrompt, [
            {
              value: "cancel",
              label: "Cancel",
              description: "Do not submit a decision",
            },
            {
              value: "acknowledge",
              label: "Acknowledge warnings",
              description: "Continue to the decision preview",
            },
          ])) === "acknowledge"
        : isYes((await this.io.ask(`${warningPrompt} [y/N] `)) ?? "")
      if (!acknowledged) {
        this.write(
          renderAssistantMessage(
            "Cancelled. Warnings were not acknowledged, so no decision was submitted.",
            this.renderOptions
          )
        )
        return false
      }
      parsed.acknowledgeWarnings = true
    }

    const command = mutationCommand(action, this.selectedItem.id, parsed)
    if (action === "approve") command.push("--execute")
    const previousStatus = this.selectedItem.status
    const result = await this.runCommand(command)
    if (!result.ok) {
      if (result.error.code === "command_cancelled") {
        this.write(
          renderAssistantMessage(
            "Cancelled. No workflow state changed.",
            this.renderOptions
          )
        )
        return false
      }
      if (result.error.code === "api_unavailable") {
        this.write(
          formatErrorSentence(unavailableMutationMessage(action)),
          "error"
        )
        return false
      }
      if (action === "approve") {
        const refreshedDetail = await this.fetchCanonicalItem(undefined, false)
        if (
          refreshedDetail?.item.status === "approved" &&
          refreshedDetail.decision
        ) {
          this.write(
            renderDecisionResult(
              decisionResultProjection(refreshedDetail.decision, {
                action,
                actorEmail: this.currentUserEmail,
                nextStatus: refreshedDetail.item.status,
                parsed,
                previousStatus,
              }),
              this.renderOptions
            )
          )
          this.writeError(result.error)
          this.write(
            renderAssistantMessage(
              "Approval was recorded, but execution did not complete. Review the error, then use /execute to retry the approved action.",
              this.renderOptions
            )
          )
          return true
        }
        this.writeError(result.error)
        this.write(
          renderAssistantMessage(
            "Approval state could not be verified. Do not approve again. Use /refresh or /history to confirm the decision; if it is approved, use /execute to retry.",
            this.renderOptions
          )
        )
        return false
      }
      this.writeError(result.error)
      return false
    }
    this.updateSelectedStatus(result.data)
    const refreshedDetail = await this.fetchCanonicalItem()
    this.writeMutationResult(action, result.data, {
      detail,
      parsed,
      previousStatus,
      refreshedDetail,
    })
    // A mutation can reorder or remove rows. Require the user to reopen the
    // relevant list before a numeric row target can be used again.
    this.itemRows.clear()
    return true
  }

  private async fetchCanonicalItem(
    target?: string,
    writeError = true
  ): Promise<WorkItemDetail | undefined> {
    const itemId = target
      ? this.resolveItemTarget(target)
      : this.requireSelectedItem().id
    const result = await this.runCommand(["work", "show", itemId])
    if (!result.ok) {
      if (writeError) this.writeError(result.error)
      return undefined
    }
    const detail = result.data as WorkItemDetail
    const item = asRecord(asRecord(result.data)?.item)
    const id = stringValue(item?.id)
    const title = stringValue(item?.title)
    const status = stringValue(item?.status)
    if (!id || !title || !status || !this.currentCompanyId) {
      throw new CliError(
        "invalid_command_result",
        "The canonical work item response is incomplete."
      )
    }
    let review: WorkItemReviewData | undefined
    try {
      review = await this.getAgentApi().getWorkItemReview(
        this.currentCompanyId,
        id
      )
    } catch {
      review = undefined
    }
    this.currentReview = review
    this.selectedItem = {
      companyId: this.currentCompanyId,
      id,
      itemType: stringValue(item?.itemType),
      nextAction: review
        ? nextActionForActions(review.availableActions)
        : "Refresh to load the current review actions",
      owner: workItemOwner(item),
      priority: priorityLabel(item?.priority),
      reviewVersion: review?.version,
      source: workItemSource(item, detail),
      status,
      title,
      warningCount: collectWarnings(detail).length,
    }
    this.notifySnapshot()
    this.syncItemWorkspace(detail)
    return detail
  }

  private requireSelectedItem(): TuiSelectedItem {
    if (!this.selectedItem)
      throw new CliError(
        "selection_required",
        "Select a work item with /open, or provide a row or full item ID."
      )
    if (
      !this.currentCompanyId ||
      this.selectedItem.companyId !== this.currentCompanyId
    ) {
      this.selectedItem = undefined
      throw new CliError(
        "selection_required",
        "The previous work-item selection does not belong to the current company."
      )
    }
    return this.selectedItem
  }

  private resolveItemTarget(target: string): string {
    if (isRowNumber(target)) {
      const row = this.itemRows.get(Number(target))
      if (!row || row.companyId !== this.currentCompanyId)
        throw new CliError(
          "invalid_target",
          "That item row is not present in the last rendered work-item list."
        )
      return row.id
    }
    if (!uuidPattern.test(target))
      throw new CliError(
        "invalid_target",
        "Use a row from the last rendered work-item list or a full item UUID."
      )
    return target
  }

  private resolveCompanyTarget(target: string): string {
    if (isRowNumber(target)) {
      const company = this.companyRows.get(Number(target))
      if (!company)
        throw new CliError(
          "invalid_target",
          "That company row is not present in the last rendered company list."
        )
      return company.id
    }
    if (!uuidPattern.test(target))
      throw new CliError(
        "invalid_target",
        "Use a row from the last rendered company list or a full company UUID."
      )
    return target
  }

  private async showContext(): Promise<void> {
    const result = await this.loadVerifiedContext()
    if (!result) return
    this.updateCompanyFromContext(result.data)
    this.write(renderHumanResult(result.data, this.renderOptions))
  }

  private async showWorkspaceSettings(): Promise<void> {
    const status = await this.runCommand(["context", "status"])
    if (!status.ok) {
      this.writeError(status.error)
      return
    }
    const current = asRecord(status.data)
    const provider = stringValue(current?.provider)
    const sandboxEnabled = current?.sandboxEnabled
    const configurationVersion = numericValue(current?.configurationVersion)
    if (
      !current ||
      (provider !== "off" && provider !== "supermemory") ||
      typeof sandboxEnabled !== "boolean" ||
      !Number.isInteger(configurationVersion) ||
      !configurationVersion ||
      configurationVersion < 1
    ) {
      this.writeError(
        new CliError(
          "invalid_api_response",
          "The server returned incomplete workspace settings."
        )
      )
      return
    }

    this.write(workspaceSettingsSummary(current, this.renderOptions))
    if (!this.io.choose) {
      this.write(
        renderAssistantMessage(
          "Use the non-interactive context and sandbox set commands to change these settings.",
          this.renderOptions
        )
      )
      return
    }

    const setting = await this.io.choose("Choose a workspace setting", [
      {
        value: "context",
        label: "Context provider",
        description: provider === "off" ? "Off" : "Supermemory · not ready",
      },
      {
        value: "sandbox",
        label: "Sandbox safety",
        description: sandboxEnabled ? "On" : "Off",
      },
      { value: "cancel", label: "Back", description: "Change nothing" },
    ])
    if (!setting || setting === "cancel") return

    let command: string[]
    let weakensSafety = false
    if (setting === "context") {
      const nextProvider = await this.io.choose("Choose Context provider", [
        {
          value: "off",
          label: "Off",
          description: "Do not retrieve or index external Context",
        },
        {
          value: "supermemory",
          label: "Supermemory · not ready",
          description: "Save the selection only; no provider call is made",
        },
        { value: "cancel", label: "Cancel", description: "Change nothing" },
      ])
      if (!nextProvider || nextProvider === "cancel") return
      if (nextProvider === provider) {
        this.write(
          renderAssistantMessage(
            `Context is already ${nextProvider === "off" ? "Off" : "set to Supermemory (not ready)"}. Nothing changed.`,
            this.renderOptions
          )
        )
        return
      }
      weakensSafety = provider === "off" && nextProvider === "supermemory"
      command = ["context", "set", nextProvider]
    } else {
      const nextSandbox = await this.io.choose("Choose Sandbox safety", [
        {
          value: "on",
          label: "On",
          description: "Keep the write firewall enabled",
        },
        {
          value: "off",
          label: "Off",
          description: "Remove this workspace safety control",
        },
        { value: "cancel", label: "Cancel", description: "Change nothing" },
      ])
      if (!nextSandbox || nextSandbox === "cancel") return
      const nextEnabled = nextSandbox === "on"
      if (nextEnabled === sandboxEnabled) {
        this.write(
          renderAssistantMessage(
            `Sandbox safety is already ${nextEnabled ? "On" : "Off"}. Nothing changed.`,
            this.renderOptions
          )
        )
        return
      }
      weakensSafety = sandboxEnabled && !nextEnabled
      command = ["sandbox", "set", nextSandbox]
    }

    if (weakensSafety) {
      const confirmation = await this.io.choose(
        "This change weakens workspace safety. Continue?",
        [
          {
            value: "cancel",
            label: "Cancel",
            description: "Keep the safer current setting",
          },
          {
            value: "continue",
            label: "Continue",
            description: "A reason is required and the change is audited",
          },
        ]
      )
      if (confirmation !== "continue") {
        this.write(
          renderAssistantMessage(
            "Cancelled. Workspace settings were not changed.",
            this.renderOptions
          )
        )
        return
      }
      command.push("--confirm")
    }

    const reason = (
      await this.io.ask("Reason for this audited change: ")
    )?.trim()
    if (!reason || reason.length > 1_000) {
      this.writeError(
        new CliError(
          "invalid_arguments",
          "Enter a reason from 1 to 1,000 characters. Nothing was changed."
        )
      )
      return
    }
    const result = await this.runCommand([
      ...command,
      "--expected-version",
      String(configurationVersion),
      "--reason",
      reason,
    ])
    if (!result.ok) {
      this.writeError(result.error)
      return
    }
    const updated = asRecord(result.data)
    this.write(
      updated
        ? workspaceSettingsSummary(updated, this.renderOptions)
        : renderHumanResult(result.data, this.renderOptions)
    )
    if (typeof updated?.sandboxEnabled === "boolean") {
      this.currentSandboxEnabled = updated.sandboxEnabled
      this.notifySnapshot()
    }
  }

  private async showHeader(): Promise<void> {
    const result = await this.loadVerifiedContext()
    if (!result) return
    this.updateCompanyFromContext(result.data)
    const [inbox, settings] =
      isAuthenticatedContext(result.data) && this.currentCompanyId
        ? await Promise.all([
            this.loadInbox(),
            this.loadWorkspaceHeaderSettings(),
          ])
        : [undefined, undefined]
    this.updateWorkspaceSettings(settings)
    if (inbox?.error && isAuthenticationError(inbox.error)) {
      this.writeSignedOutState(inbox.error)
      return
    }
    this.write(
      renderHeader(
        headerContext(result.data, inbox, settings),
        this.renderOptions
      )
    )
    if (inbox?.error) {
      this.writeError(inbox.error)
    }
  }

  private async loadVerifiedContext(): Promise<
    Extract<CliCommandResult, { ok: true }> | undefined
  > {
    const context = await this.runCommand(["context"])
    if (!context.ok) {
      if (isAuthenticationError(context.error))
        this.writeSignedOutState(context.error)
      else this.writeUnverifiedState(context.error)
      return undefined
    }
    if (!isAuthenticatedContext(context.data)) {
      this.writeSignedOutState(
        new CliError("unauthorized", "Sign in with /login first.")
      )
      return undefined
    }

    const sessionProbe = await this.runCommand(["company", "list"])
    if (!sessionProbe.ok) {
      if (isAuthenticationError(sessionProbe.error))
        this.writeSignedOutState(sessionProbe.error)
      else this.writeUnverifiedState(sessionProbe.error)
      return undefined
    }
    return context
  }

  private writeSignedOutState(error: CliError): void {
    this.clearState()
    this.write(
      renderHeader(
        {
          contextStatus: "Sign in required",
          mode: "sandbox",
          sandboxStatus: "Sign in required",
        },
        this.renderOptions
      )
    )
    this.writeError(error)
  }

  private writeUnverifiedState(error: CliError): void {
    this.clearState()
    this.write(
      renderHeader(
        {
          contextStatus: "Unavailable",
          mode: "sandbox",
          sandboxStatus: "Unavailable",
        },
        this.renderOptions
      )
    )
    this.writeError(error)
  }

  private showHelp(): void {
    const groups = new Map<string, SlashCommandDefinition[]>()
    for (const definition of slashCommands) {
      if (
        !definition.paletteVisible ||
        !isSlashCommandAvailable(definition, this.selectedItem?.status) ||
        (definition.command === "/login" && this.currentAuthenticated) ||
        (definition.command === "/logout" && !this.currentAuthenticated)
      )
        continue
      const current = groups.get(definition.group) ?? []
      current.push(definition)
      groups.set(definition.group, current)
    }
    this.write(
      [...groups]
        .map(([group, definitions]) =>
          renderHumanResult(
            definitions.map(({ command, description, usage }) => ({
              command,
              description,
              usage,
            })),
            { ...this.renderOptions, title: group }
          )
        )
        .join("\n\n")
    )
  }

  private async loadInbox(): Promise<{
    error?: CliError
    items?: unknown[]
    itemCount?: number
    warningCount?: number
  }> {
    const view = getSlashCommand("/inbox")?.view
    if (!view) return {}
    const result = await this.runCommand([...view.backendArgs])
    if (!result.ok) return { error: result.error }
    const items = filterWorkItems(result.data, view)
    return {
      items,
      itemCount: items.length,
      warningCount: countItemsWithWarnings(items),
    }
  }

  private async loadWorkspaceHeaderSettings(): Promise<WorkspaceHeaderSettings> {
    const unavailable = {
      contextStatus: "Unavailable",
      sandboxStatus: "Unavailable",
    }
    const result = await this.runCommand(["context", "status"])
    if (!result.ok) return unavailable
    const status = asRecord(result.data)
    if (!status) return unavailable
    const provider = stringValue(status.provider)
    const readiness = stringValue(status.readiness)
    const sandboxEnabled = status.sandboxEnabled
    if (
      (provider !== "off" && provider !== "supermemory") ||
      typeof sandboxEnabled !== "boolean"
    ) {
      return unavailable
    }
    const contextStatus =
      provider === "off"
        ? "Off"
        : readiness === "ready"
          ? "Supermemory"
          : readiness === "error"
            ? "Supermemory (error)"
            : "Supermemory (not ready)"
    return {
      contextStatus,
      sandboxEnabled,
      sandboxStatus: sandboxEnabled ? "On" : "Off",
    }
  }

  private updateWorkspaceSettings(
    settings: WorkspaceHeaderSettings | undefined
  ): void {
    this.currentSandboxEnabled = settings?.sandboxEnabled
    this.notifySnapshot()
  }

  private updateCompanyFromContext(value: unknown): void {
    const source = asRecord(value)
    const company = asRecord(source?.company)
    const nextCompanyId = stringValue(company?.id)
    if (nextCompanyId !== this.currentCompanyId) {
      this.clearCompanyBoundState()
      this.currentCompanyId = nextCompanyId
    }
    this.currentCompanyName = stringValue(company?.name)
    this.currentEnvironment = stringValue(source?.mode) ?? "sandbox"
    this.currentUserEmail = stringValue(asRecord(source?.user)?.email)
    this.currentAuthenticated = isAuthenticatedContext(value)
    this.notifySnapshot()
  }

  private updateSelectedStatus(value: unknown): void {
    if (!this.selectedItem) return
    const status = statusFromMutationResult(value)
    if (status)
      this.selectedItem = {
        ...this.selectedItem,
        nextAction: nextActionForStatus(status),
        status,
      }
    this.notifySnapshot()
  }

  private clearCompanyBoundState(): void {
    this.selectedItem = undefined
    this.currentReview = undefined
    this.io.setItemWorkspace?.(null)
    this.agentRows.clear()
    this.companyRows.clear()
    this.fixtureRows.clear()
    this.itemRows.clear()
    this.currentSandboxEnabled = undefined
    this.notifySnapshot()
  }

  private notifySnapshot(): void {
    this.io.onSnapshot({
      environment: this.currentEnvironment,
      nextAction: this.selectedItem
        ? this.selectedItem.nextAction
        : this.currentCompanyId
          ? "Open inbox"
          : this.currentAuthenticated
            ? "Select workspace"
            : "Sign in",
      sandboxEnabled: this.currentSandboxEnabled,
      selectedItem: this.selectedItem,
      userEmail: this.currentUserEmail,
      workspace: this.currentCompanyName
        ? { id: this.currentCompanyId, name: this.currentCompanyName }
        : undefined,
    })
  }

  private writeItemOverview(detail: WorkItemDetail): void {
    if (this.io.setItemWorkspace) return
    this.write(
      renderReviewWorkspace(
        {
          detail: productItemDetail(
            detail,
            this.currentReview
              ? nextActionForActions(this.currentReview.availableActions)
              : "Refresh to load the current review actions"
          ),
          review: this.currentReview ?? null,
        },
        this.renderOptions
      )
    )
  }

  private syncItemWorkspace(detail: WorkItemDetail): void {
    if (!this.io.setItemWorkspace || !this.selectedItem) return
    const reviewInput = {
      detail: productItemDetail(
        detail,
        this.currentReview
          ? nextActionForActions(this.currentReview.availableActions)
          : "Refresh to load the current review actions"
      ),
      review: this.currentReview ?? null,
    }
    const workspace: TuiItemWorkspace = {
      itemId: this.selectedItem.id,
      tabs: renderReviewWorkspaceTabs(reviewInput, this.renderOptions),
      actions: (this.currentReview?.availableActions ?? []).map(
        workItemActionChoice
      ),
    }
    this.io.setItemWorkspace(workspace)
  }

  private writeMutationResult(
    action: MutationAction,
    value: unknown,
    context: {
      detail: WorkItemDetail
      parsed: MutationArguments
      previousStatus: string
      refreshedDetail?: WorkItemDetail
    }
  ): void {
    const source = asRecord(value)
    if (action === "execute") {
      this.write(
        renderExecutionResult(
          executionResultProjection(
            value,
            context.refreshedDetail ?? context.detail
          ),
          this.renderOptions
        )
      )
      return
    }

    const resultDecision =
      action === "approve" && source && "execution" in source
        ? source.decision
        : value
    const rawDecision = context.refreshedDetail?.decision ?? resultDecision
    this.write(
      renderDecisionResult(
        decisionResultProjection(rawDecision, {
          action,
          actorEmail: this.currentUserEmail,
          nextStatus:
            statusFromMutationResult(resultDecision) ??
            context.refreshedDetail?.item.status,
          parsed: context.parsed,
          previousStatus: context.previousStatus,
        }),
        this.renderOptions
      )
    )
    if (action === "approve" && source && "execution" in source) {
      this.write(
        renderExecutionResult(
          executionResultProjection(
            source.execution,
            context.refreshedDetail ?? context.detail
          ),
          this.renderOptions
        )
      )
    }
  }

  private async runCommand(args: string[]): Promise<CliCommandResult> {
    try {
      return await this.execute(args, {
        ...this.cliDependencies,
        confirm: this.confirm,
        stderr: this.commandStderr,
        stdout: this.commandStdout,
      })
    } catch (error) {
      return { ok: false, error: asCliError(error) }
    }
  }

  private writeResult(result: CliCommandResult): void {
    if (result.ok)
      this.write(renderHumanResult(result.data, this.renderOptions))
    else this.writeError(result.error)
  }

  private writeConversationResult(
    result: CliCommandResult,
    input: string
  ): void {
    if (!result.ok) {
      this.writeError(result.error)
      return
    }

    const outcome = conversationalOutcome(result.data)
    if (outcome) {
      this.write(
        renderAssistantMessage(
          conversationalOutcomeMessage(outcome),
          this.renderOptions
        )
      )
      return
    }

    const source = asRecord(result.data)
    const answer = stringValue(source?.answer)
    if (answer) {
      this.write(renderAssistantMessage(answer, this.renderOptions))
      return
    }
    const payload =
      source && "parser" in source && "result" in source
        ? source.result
        : result.data
    const payloadRecord = asRecord(payload)
    const itemCount = Array.isArray(payloadRecord?.items)
      ? payloadRecord.items.length
      : undefined
    if (itemCount !== undefined && isAttentionRequest(input)) {
      const inboxView = getSlashCommand("/inbox")?.view
      if (inboxView) {
        const actionableCount = filterWorkItems(payload, inboxView).length
        if (actionableCount === 0) {
          this.itemRows.clear()
          this.write(
            renderAssistantMessage("Your inbox is clear.", this.renderOptions)
          )
          return
        }
        this.write(
          renderAssistantMessage(
            `${actionableCount} ${actionableCount === 1 ? "item needs" : "items need"} your review.`,
            this.renderOptions
          )
        )
        this.showViewData(payload, inboxView)
        return
      }
    }
    this.write(
      renderAssistantMessage(
        itemCount === 0
          ? "No work items matched that request."
          : "Here is what I found.",
        this.renderOptions
      )
    )
    this.write(renderHumanResult(payload, this.renderOptions))
  }

  private writeError(error: CliError): void {
    this.write(
      formatErrorSentence(actionableErrorMessage(error) ?? error.message),
      "error"
    )
  }

  private write(
    value: string,
    kind: "error" | "output" | "prompt" | "user" = "output"
  ): void {
    if (!value) return
    this.io.append(value, kind)
  }
}

function contextualCommandArgs(value: unknown): string[] {
  const parsed = controlIntentSchema.safeParse(value)
  if (!parsed.success) {
    throw new CliError(
      "invalid_intent",
      "The server returned an invalid typed command. Nothing was changed."
    )
  }
  return explicitCommandArgs(parsed.data)
}

function explicitCommandArgs(intent: ControlIntent): string[] {
  switch (intent.kind) {
    case "run_fixture":
      return ["workflow", "fixture", "run", intent.scenarioId]
    case "list_work_items":
      return intent.status
        ? ["work", "list", "--status", intent.status]
        : ["work", "list"]
    case "inspect_work_item":
      return ["work", "show", intent.itemId]
    case "execute_mock_action":
      return ["work", "execute", intent.itemId]
    case "record_decision": {
      const action =
        intent.decision === "request_rework" ? "rework" : intent.decision
      const args = ["work", action, intent.itemId]
      for (const patch of intent.patches ?? []) {
        args.push("--set", `${patch.pointer}=${JSON.stringify(patch.value)}`)
      }
      if (intent.reason) args.push("--reason", intent.reason)
      if (intent.warningsAcknowledged) args.push("--ack-warnings")
      return args
    }
  }
}

type AgentTestRunResult = Awaited<ReturnType<ControlApi["testAgent"]>>

function renderAgentList(
  agents: AgentSummary[],
  options: RenderOptions
): string {
  return [
    `Agents · ${agents.length} installed`,
    ...agents.map(
      (agent, index) =>
        `${index + 1}. ${sanitizeTerminalText(agent.name)} · ${agentStatusLabel(agent)} · v${sanitizeTerminalText(agent.version)}${hasAgentSetupBlocker(agent) ? " · setup needed" : ""}`
    ),
    "",
    "Open the guided menu with /agents or inspect one with /agent-show 1.",
  ]
    .map((line) => fitAgentLine(line, options.width))
    .join("\n")
}

function renderAgentOverview(
  agent: AgentSummary,
  options: RenderOptions
): string {
  const ready = agent.capabilities.filter(
    ({ status }) => status === "resolved"
  ).length
  const fields: Array<[string, string]> = [
    ["Status", agentStatusLabel(agent)],
    ["Version", agent.version],
    ["Workflow", agent.workflowKey],
    ["Type", agent.workflowType],
    [
      "Connections",
      `${ready}/${agent.capabilities.length} ready${hasAgentSetupBlocker(agent) ? " · setup needed" : ""}`,
    ],
    ["Last updated", agent.updatedAt],
    ["Next step", agentNextStep(agent)],
  ]
  return renderAgentFields(`Agent · ${agent.name}`, fields, options)
}

function renderAgentSetup(agent: AgentSummary, options: RenderOptions): string {
  const lines = [
    `Connections & permissions · ${sanitizeTerminalText(agent.name)}`,
  ]
  if (agent.capabilities.length === 0)
    lines.push("No external connections are required.")
  for (const capability of agent.capabilities) {
    const ready = capability.status === "resolved"
    lines.push(
      `${ready ? "Ready" : "Needs setup"} · ${sanitizeTerminalText(capability.alias)} · ${capability.access} access`
    )
    if (!ready)
      lines.push(`  What to do: ${agentCapabilityResolution(capability)}`)
  }
  for (const diagnostic of agent.diagnostics) {
    lines.push(
      `${diagnostic.severity === "error" ? "Must fix" : "Check"} · ${sanitizeTerminalText(diagnostic.message)}`
    )
    if (diagnostic.resolution)
      lines.push(`  What to do: ${sanitizeTerminalText(diagnostic.resolution)}`)
  }
  if (!hasAgentSetupBlocker(agent) && agent.diagnostics.length === 0)
    lines.push("Everything needed by this agent is ready.")
  return lines.map((line) => fitAgentLine(line, options.width)).join("\n")
}

function renderAgentValidation(
  result: AgentValidateResponse,
  options: RenderOptions
): string {
  const lines = [
    result.valid ? "Agent skill is valid" : "Agent skill needs changes",
  ]
  if (result.preview) {
    lines.push(
      `Agent · ${sanitizeTerminalText(result.preview.name)}`,
      `Version · ${sanitizeTerminalText(result.preview.version)}`,
      `Workflow · ${sanitizeTerminalText(result.preview.workflowKey)}`,
      `Connections · ${result.preview.capabilities.length}`
    )
  }
  for (const diagnostic of result.diagnostics) {
    lines.push(
      `${diagnostic.severity === "error" ? "Must fix" : "Check"} · ${sanitizeTerminalText(diagnostic.message)}`
    )
    if (diagnostic.resolution)
      lines.push(`  What to do: ${sanitizeTerminalText(diagnostic.resolution)}`)
  }
  if (result.valid)
    lines.push("Next step · Install this version, then run a Sandbox test.")
  return lines.map((line) => fitAgentLine(line, options.width)).join("\n")
}

function renderAgentVersions(
  selected: AgentSummary,
  versions: AgentSummary[],
  options: RenderOptions
): string {
  return [
    `Installed versions · ${sanitizeTerminalText(selected.name)}`,
    ...versions.map(
      (agent, index) =>
        `${index + 1}. v${sanitizeTerminalText(agent.version)} · ${agentStatusLabel(agent)} · installed ${sanitizeTerminalText(agent.createdAt)}`
    ),
    "",
    `Restore one with /agent-rollback ${selected.id} <version>.`,
  ]
    .map((line) => fitAgentLine(line, options.width))
    .join("\n")
}

function renderAgentTestResult(
  agent: AgentSummary,
  result: AgentTestRunResult,
  options: RenderOptions
): string {
  const next =
    result.status === "waiting_for_approval"
      ? "Open the inbox to review the work it proposed."
      : result.status === "blocked"
        ? "Review the agent setup details, fix the issue, and test again."
        : result.status === "suppressed"
          ? "No review item was created because the safety rules suppressed it."
          : "The Sandbox test completed without requiring review."
  return renderAgentFields(
    `Sandbox test · ${agent.name}`,
    [
      ["Result", readableAgentRunStatus(result.status)],
      ["Run", result.workflowRunId],
      ["Inbox item", result.itemId ?? "None"],
      ["Next step", next],
    ],
    options
  )
}

function renderAgentLifecycleResult(
  agent: AgentSummary,
  action: AgentLifecycleUiAction,
  options: RenderOptions
): string {
  const message =
    action === "activate"
      ? `${agent.name} is active and can start new work.`
      : action === "deactivate" || action === "pause"
        ? `${agent.name} is paused and will not start new work.`
        : action === "resume"
          ? `${agent.name} is active again after a readiness check.`
          : action === "disable"
            ? `${agent.name} is disabled and cannot start work.`
            : `${agent.name} was restored to version ${agent.version}.`
  return renderAssistantMessage(message, options)
}

function renderAgentFields(
  title: string,
  fields: Array<[string, string]>,
  options: RenderOptions
): string {
  const labelWidth = Math.min(
    22,
    Math.max(10, ...fields.map(([label]) => label.length + 2))
  )
  return [
    sanitizeTerminalText(title),
    ...fields.map(([label, value]) =>
      fitAgentLine(
        `${sanitizeTerminalText(label).padEnd(labelWidth)}${sanitizeTerminalText(value)}`,
        options.width
      )
    ),
  ].join("\n")
}

function fitAgentLine(value: string, width: number): string {
  // Preserve the complete remediation text. Ink and the terminal handle visual
  // wrapping, while truncation could hide the exact connector or permission fix.
  void width
  return sanitizeTerminalText(value)
}

function agentChoiceDescription(agent: AgentSummary): string {
  return [
    agentStatusLabel(agent),
    `v${agent.version}`,
    hasAgentSetupBlocker(agent) ? "setup needed" : "ready",
  ].join(" · ")
}

function agentStatusLabel(agent: AgentSummary): string {
  if (agent.active) return "Active"
  switch (agent.status) {
    case "draft":
      return "Draft"
    case "ready":
      return "Ready"
    case "paused":
      return "Paused"
    case "disabled":
      return "Disabled"
    case "inactive":
      return "Inactive"
    case "archived":
      return "Archived"
    case "invalid":
      return "Needs setup"
    default:
      return "Inactive"
  }
}

function hasAgentSetupBlocker(agent: AgentSummary): boolean {
  return (
    agent.diagnostics.some(({ severity }) => severity === "error") ||
    agent.capabilities.some(({ status }) => status !== "resolved")
  )
}

function agentNextStep(agent: AgentSummary): string {
  if (agent.status === "archived") return "Install a newer version if needed"
  if (hasAgentSetupBlocker(agent))
    return "Fix the connection or permission setup"
  if (agent.active) return "Run a Sandbox test or deactivate it"
  return "Run a Sandbox test, then activate it"
}

function agentCapabilityResolution(
  capability: AgentSummary["capabilities"][number]
): string {
  const name = sanitizeTerminalText(capability.alias)
  switch (capability.status) {
    case "missing":
      return `Connect a system that provides ${name}.`
    case "ambiguous":
      return `Choose which connected system ${name} should use.`
    case "unhealthy":
      return `Reconnect the system used for ${name}, then try again.`
    case "unauthorized":
      return `Allow ${capability.access} access to ${name} in the connected system.`
    case "schema_drift":
      return `Refresh the ${name} connection because its available fields changed.`
    default:
      return `${name} is ready.`
  }
}

function readableAgentRunStatus(status: AgentTestRunResult["status"]): string {
  switch (status) {
    case "waiting_for_approval":
      return "Waiting for your review"
    case "blocked":
      return "Blocked safely"
    case "suppressed":
      return "No action needed"
    case "completed":
      return "Completed"
  }
}

function agentLifecycleEffect(
  action: AgentLifecycleUiAction,
  agent: AgentSummary,
  version?: string
): string {
  if (action === "activate")
    return "This version may start new work in this workspace."
  if (action === "deactivate" || action === "pause")
    return "No new work will start. Existing history is preserved."
  if (action === "resume")
    return "A fresh Sandbox run checks readiness and current bindings before new work resumes."
  if (action === "disable")
    return "New and queued work stays blocked until a deliberate later change."
  return `Restore version ${version ?? "selected"} instead of version ${agent.version}.`
}

function agentLifecycleActionLabel(
  action: AgentLifecycleUiAction,
  version?: string
): string {
  if (action === "activate") return "Activate agent"
  if (action === "deactivate") return "Deactivate agent"
  if (action === "pause") return "Pause agent"
  if (action === "resume") return "Resume agent"
  if (action === "disable") return "Disable agent"
  return `Restore version ${version ?? "selected"}`
}

function createTuiConfirmation(
  ask: TuiSessionIo["ask"],
  choose: TuiSessionIo["choose"],
  append: TuiSessionIo["append"],
  renderOptions: RenderOptions
): ConfirmMutation {
  return async (context: ConfirmationContext) => {
    const display = confirmationDisplay(context)
    if (context.intent.kind === "record_decision") {
      append(
        renderDecisionResult(
          {
            preview: true,
            item: context.item ?? null,
            decision: context.intent.decision,
            reason: context.intent.reason ?? null,
            warnings: context.warnings ?? [],
            warningsAcknowledged: context.intent.warningsAcknowledged,
          },
          renderOptions
        )
      )
      if ((context.changes?.length ?? 0) > 0) {
        append(
          renderHumanResult(
            { materialChanges: display.changes },
            { ...renderOptions, title: "Material Changes" }
          )
        )
      }
    } else if (context.intent.kind === "execute_mock_action") {
      append(
        renderExecutionResult(
          {
            preview: true,
            actionType: context.actionType ?? null,
            draft: context.draft ?? null,
            item: context.item ?? null,
            mode: "mock",
            status: "awaiting_confirmation",
          },
          renderOptions
        )
      )
    } else {
      append(
        renderHumanResult(
          { confirmation: display },
          { ...renderOptions, title: "Confirmation" }
        )
      )
    }
    if (context.draft) {
      append(renderDraftPreview(context.draft, renderOptions))
    }
    if (choose) {
      const answer = await choose(confirmationPrompt(context, false), [
        {
          value: "cancel",
          label: "Cancel",
          description: "Leave the workflow unchanged",
        },
        confirmationChoice(context),
      ])
      return answer === "confirm"
    }
    const answer = await ask(confirmationPrompt(context, true))
    return answer !== null && isYes(answer)
  }
}

function parseMutationArguments(
  args: string[],
  usage: string
): MutationArguments {
  const parsed: MutationArguments = {
    acknowledgeWarnings: false,
    assignments: [],
  }
  let index = 0
  if (args[0] && !args[0].startsWith("--")) {
    parsed.target = args[0]
    index = 1
  }

  while (index < args.length) {
    const option = args[index]
    if (option === "--ack-warnings") {
      parsed.acknowledgeWarnings = true
      index += 1
      continue
    }
    if (option === "--set") {
      const assignment = args[index + 1]
      if (!assignment || assignment.startsWith("--"))
        throw new CliError("invalid_arguments", `Use: ${usage}.`)
      parsed.assignments.push(assignment)
      index += 2
      continue
    }
    if (option === "--reason") {
      const reasonParts: string[] = []
      index += 1
      while (index < args.length && !args[index]?.startsWith("--")) {
        reasonParts.push(args[index] ?? "")
        index += 1
      }
      if (!reasonParts.length)
        throw new CliError("invalid_arguments", `Use: ${usage}.`)
      parsed.reason = reasonParts.join(" ")
      continue
    }
    throw new CliError("invalid_arguments", `Use: ${usage}.`)
  }
  return parsed
}

function mutationCommand(
  action: MutationAction,
  itemId: string,
  parsed: MutationArguments
): string[] {
  const command = ["work", action, itemId]
  for (const assignment of parsed.assignments) {
    command.push("--set", assignment)
  }
  if (parsed.reason) command.push("--reason", parsed.reason)
  if (parsed.acknowledgeWarnings) command.push("--ack-warnings")
  return command
}

function mutationUsage(action: MutationAction): string {
  switch (action) {
    case "approve":
      return "/approve [row-or-id] [--ack-warnings]"
    case "edit":
      return "/edit [row-or-id] [--set <pointer=value>] [--reason <reason>]"
    case "reject":
      return "/reject [row-or-id] [--reason <reason>]"
    case "resolve":
      return "/resolve [row-or-id]"
    case "rework":
      return "/rework [row-or-id] [--reason <reason>]"
    case "execute":
      return "/execute [row-or-id]"
  }
}

function workItemActionChoice(action: WorkItemAction): TuiChoice {
  switch (action) {
    case "approve":
      return {
        value: "approve",
        label: "Approve",
        description: "Record approval, then review mock execution",
      }
    case "edit":
      return {
        value: "edit",
        label: "Edit and approve",
        description: "Change the draft with a recorded reason",
      }
    case "reject":
      return {
        value: "reject",
        label: "Reject",
        description: "Close the item with a recorded reason",
      }
    case "request_rework":
      return {
        value: "rework",
        label: "Request rework",
        description: "Return the recommendation for revision",
      }
    case "resolve":
      return {
        value: "resolve",
        label: "Resolve",
        description: "Mark this item resolved after confirmation",
      }
    case "execute_mock":
      return {
        value: "execute",
        label: "Execute approved mock action",
        description: "Preview and confirm the downstream action",
      }
  }
}

function nextActionForActions(actions: readonly WorkItemAction[]): string {
  const first = actions[0]
  return first ? workItemActionChoice(first).label : "Return to Inbox"
}

type SandboxTemporaryDecision = {
  action: "approved" | "edited" | "rejected" | "rework" | "executed"
  quantity?: number
}

function sandboxAvailableActions(
  candidate: Record<string, unknown>,
  decision?: SandboxTemporaryDecision
): WorkItemAction[] {
  if (decision?.action === "approved" || decision?.action === "edited")
    return ["execute_mock"]
  if (decision) return []
  const actions = Array.isArray(candidate.availableActions)
    ? candidate.availableActions
    : []
  return actions.filter(isWorkItemAction)
}

const workItemActions = new Set<WorkItemAction>([
  "approve",
  "edit",
  "reject",
  "request_rework",
  "resolve",
  "execute_mock",
])

function isWorkItemAction(value: unknown): value is WorkItemAction {
  return workItemActions.has(value as WorkItemAction)
}

function sandboxReviewProjection(
  candidate: Record<string, unknown>,
  availableActions: readonly WorkItemAction[],
  decision?: SandboxTemporaryDecision
): unknown {
  const inventory = asRecord(candidate.inventory) ?? {}
  const recommendation = asRecord(candidate.recommendation) ?? {}
  const vendor = asRecord(candidate.vendor) ?? {}
  const openPurchaseOrders = asRecord(candidate.openPurchaseOrders) ?? {}
  const sku = stringValue(candidate.sku) ?? "Unknown SKU"
  const productName = stringValue(candidate.productName) ?? sku
  const recommendedQuantity =
    decision?.quantity ?? numericValue(recommendation.quantity)
  const warnings = Array.isArray(recommendation.warnings)
    ? recommendation.warnings
    : []
  const reasons = Array.isArray(recommendation.reasons)
    ? recommendation.reasons
    : []
  const status =
    decision?.action === "approved" || decision?.action === "edited"
      ? "approved"
      : decision?.action === "executed"
        ? "executed"
        : decision?.action === "rejected"
          ? "rejected"
          : recommendation.status === "blocked"
            ? "blocked"
            : "active"
  const sources = Array.isArray(candidate.sources) ? candidate.sources : []
  const decisionSummary = decision
    ? `Temporary ${decision.action}${decision.quantity ? ` at quantity ${decision.quantity}` : ""}. Nothing was written or sent.`
    : undefined

  return {
    sandbox: true,
    availableActions,
    item: {
      itemType: "procurement_reorder_review",
      title: `${productName} · ${sku}`,
      status,
      priority: warnings.length > 0 ? "attention" : "normal",
      owner: "Sandbox reviewer",
      source: sources,
      why: reasons,
      requiredAttention: nextActionForActions(availableActions),
      nextAction: nextActionForActions(availableActions),
    },
    contextPacket: {
      facts: {
        availableInventory: inventory.available,
        currentStock: inventory.onHand,
        allocatedInventory: inventory.allocated,
        backorder: inventory.backorder,
        reorderPoint: inventory.reorderLevel,
        recentSales: candidate.recentSalesUnits,
        openPurchaseOrders,
      },
      sources,
      freshnessState: inventory.pulledAt ?? "unknown",
      warnings,
      createdAt: inventory.pulledAt,
    },
    recommendation: {
      status: recommendation.status,
      rationaleSummary:
        reasons.length > 0
          ? reasons.join(" · ")
          : "No recommendation rationale was provided.",
      warnings,
      output: {
        productTitle: productName,
        recommendedQuantity,
        vendor: vendor.name,
        vendorSku: vendor.vendorSku,
        unitCost: vendor.unitCost,
      },
      freshnessState: inventory.pulledAt ?? "unknown",
    },
    evidence: {
      sourceRefs: sources,
      assumptions: [
        "This review uses a temporary snapshot of real workspace data.",
      ],
      warnings,
      evidence: [inventory, openPurchaseOrders, vendor],
      createdAt: inventory.pulledAt,
    },
    draft: {
      actionType: "create_purchase_order",
      status: decision ? "temporary" : "pending_review",
      payload: {
        vendor: vendor.name,
        lines: [{ sku, quantity: recommendedQuantity }],
      },
    },
    activity: decisionSummary
      ? [
          {
            eventType: "sandbox_decision",
            summary: decisionSummary,
            createdAt: inventory.pulledAt,
          },
        ]
      : [],
  }
}

function filterWorkItems(value: unknown, view: SlashViewDefinition): unknown[] {
  const statuses = new Set(view.includedStatuses)
  const itemTypes = view.includedItemTypes
    ? new Set(view.includedItemTypes)
    : undefined
  return arrayFrom(value, "items").filter((item) => {
    const record = asRecord(item)
    const status = stringValue(record?.status)
    const itemType = stringValue(record?.itemType)
    return (
      status !== undefined &&
      statuses.has(status) &&
      (!itemTypes || (itemType !== undefined && itemTypes.has(itemType)))
    )
  })
}

function countItemsWithWarnings(items: unknown[]): number {
  return items.reduce<number>((total, item) => {
    const warningCount = asRecord(item)?.warningCount
    return (
      total + (typeof warningCount === "number" && warningCount > 0 ? 1 : 0)
    )
  }, 0)
}

function collectWarnings(detail: WorkItemDetail): string[] {
  const warnings = [
    detail.contextPacket,
    detail.recommendation,
    detail.evidence,
  ].flatMap((source) => source?.warnings ?? [])
  return [...new Set(warnings)]
}

function decisionResultProjection(
  value: unknown,
  context: {
    action: MutationAction
    actorEmail?: string
    nextStatus?: string
    parsed: MutationArguments
    previousStatus: string
  }
): unknown {
  const envelope = asRecord(value) ?? {}
  const decision = asRecord(envelope.decision) ?? envelope
  return {
    ...envelope,
    decision: {
      ...decision,
      action:
        stringValue(decision.kind) ??
        stringValue(decision.decision) ??
        context.action,
      actorEmail: context.actorEmail ?? null,
      reason: context.parsed.reason ?? decision.reason ?? null,
      stateAfter: context.nextStatus ?? null,
      stateBefore: context.previousStatus,
      warningsAcknowledged:
        decision.warningsAcknowledged ?? context.parsed.acknowledgeWarnings,
    },
    nextAction: context.nextStatus
      ? nextActionForStatus(context.nextStatus)
      : "Refresh the item or return to inbox",
  }
}

function executionResultProjection(
  value: unknown,
  detail: WorkItemDetail
): unknown {
  const source = asRecord(value) ?? {}
  const requestSummary = mockActionSummary(detail)
  const resultAttempt = asRecord(source.attempt)
  const canonicalAttempt = asRecord(detail.attempt)
  const auditReference = detail.auditEvents.at(-1)?.id
  const attempt: Record<string, unknown> | undefined =
    resultAttempt || canonicalAttempt
      ? {
          ...resultAttempt,
          ...canonicalAttempt,
          auditReference: auditReference ?? null,
          requestSummary,
        }
      : undefined
  const draftPayload = asRecord(detail.draft?.payload)
  const mode = firstString(attempt?.mode, source.mode, draftPayload?.mode)
  return {
    ...source,
    actionType: detail.draft?.actionType ?? null,
    attempt: attempt ?? source.attempt,
    draft: detail.draft ?? null,
    ...(mode ? { mode } : {}),
    requestSummary,
  }
}

function mockActionSummary(detail: WorkItemDetail): string {
  const payload = asRecord(detail.draft?.payload)
  const line = asRecord(Array.isArray(payload?.lines) ? payload.lines[0] : null)
  const quantity = line?.quantity
  const vendor = stringValue(payload?.vendor)
  if (quantity !== undefined && vendor)
    return `Purchase order · ${String(quantity)} units · ${vendor}`
  if (vendor) return `Purchase order · ${vendor}`
  return detail.draft?.actionType ?? "Approved mock action"
}

function statusFromMutationResult(value: unknown): string | undefined {
  const source = asRecord(value)
  const execution = asRecord(source?.execution)
  const decision = asRecord(source?.decision)
  const item =
    asRecord(execution?.item) ??
    asRecord(decision?.item) ??
    asRecord(source?.item)
  return stringValue(item?.status)
}

function nextActionForDetail(detail: WorkItemDetail): string {
  if (detail.item.status === "approved") return "Execute approved mock action"
  if (detail.item.status === "blocked") return "Inspect blocking evidence"
  if (["executed", "rejected", "resolved"].includes(detail.item.status))
    return "Inspect history or return to inbox"
  if (detail.recommendation?.status === "blocked")
    return "Inspect blocking evidence"
  if (detail.item.itemType === "procurement_reorder_review")
    return "Review recommendation"
  return nextActionForStatus(detail.item.status)
}

function productItemDetail(
  detail: WorkItemDetail,
  nextAction: string = nextActionForDetail(detail)
): unknown {
  return {
    ...detail,
    item: {
      ...detail.item,
      nextAction,
      owner: workItemOwner(asRecord(detail.item)) ?? null,
      requiredAttention: nextAction,
      source: workItemSource(asRecord(detail.item), detail) ?? null,
      why:
        detail.recommendation?.rationaleSummary ??
        detail.auditEvents.at(0)?.summary ??
        null,
    },
  }
}

function nextActionForStatus(status: string): string {
  switch (status) {
    case "approved":
      return "Execute approved mock action"
    case "blocked":
      return "Inspect blocking evidence"
    case "executed":
    case "rejected":
    case "resolved":
      return "Inspect history or return to inbox"
    default:
      return "Review and decide"
  }
}

function nonNegativeNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined
}

function priorityLabel(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined
  if (value >= 80) return "Urgent"
  if (value >= 50) return "Normal"
  return "Low"
}

function workItemOwner(
  item: Record<string, unknown> | undefined
): string | undefined {
  const resolution = asRecord(item?.resolutionState)
  return firstString(
    item?.owner,
    item?.assignedRole,
    resolution?.owner,
    resolution?.assignedRole,
    resolution?.role
  )
}

function workItemSource(
  item: Record<string, unknown> | undefined,
  detail?: WorkItemDetail
): string | undefined {
  const resolution = asRecord(item?.resolutionState)
  const firstSource = asRecord(detail?.contextPacket?.sources[0])
  return firstString(
    item?.source,
    resolution?.source,
    firstSource?.source,
    firstSource?.system
  )
}

function firstString(...values: unknown[]): string | undefined {
  return values.find(
    (value): value is string => typeof value === "string" && value.trim() !== ""
  )
}

function localConversationResponse(
  input: string
): { message: string; showCommands: boolean } | undefined {
  const normalized = input
    .trim()
    .toLowerCase()
    .replace(/[!?.]+$/g, "")
    .replace(/\s+/g, " ")
  if (
    /^(?:hi|hello|hello there|hey|good morning|good afternoon|good evening)(?: mandala)?$/.test(
      normalized
    )
  ) {
    return {
      message:
        "Hello. What would you like to work on? Type / to see available commands.",
      showCommands: false,
    }
  }
  if (
    /^(?:help|what can you do|what do you do|how can you help|show(?: me)?(?: the)?(?: available)? commands)$/.test(
      normalized
    )
  ) {
    return {
      message:
        "I can help you review work, inspect evidence and drafts, make decisions, and execute approved mock actions.",
      showCommands: true,
    }
  }
  return undefined
}

function isAttentionRequest(input: string): boolean {
  return /\b(?:inbox|actionable|needs? attention|needs? (?:my |our |your )?review|what[^.?!]{0,60}(?:review|action))\b/i.test(
    input
  )
}

function isRevisionFeedback(input: string): boolean {
  return /\b(?:revise|revision|rework|correct|correction|recalculate|try again|change the recommendation|adjust the recommendation)\b/i.test(
    input
  )
}

function isReadOnlyQuestion(input: string): boolean {
  const normalized = input.trim()
  return (
    normalized.endsWith("?") ||
    /^(?:who|what|when|where|why|how|is|are|am|was|were|can|could|should|would|will|do|does|did|has|have|had)\b/i.test(
      normalized
    ) ||
    /^(?:tell me|explain|describe|assess|evaluate|walk me through)\b/i.test(
      normalized
    )
  )
}

function conversationalOutcome(
  value: unknown
): Record<string, unknown> | undefined {
  const source = asRecord(value)
  const nested = asRecord(source?.outcome)
  const candidate = nested ?? source
  const status = stringValue(candidate?.status)
  return status === "blocked" || status === "clarification_required"
    ? candidate
    : undefined
}

function conversationalOutcomeMessage(
  outcome: Record<string, unknown>
): string {
  const status = stringValue(outcome.status)
  if (status === "clarification_required") {
    const questions = stringArray(outcome.questions)
    return questions.length > 0
      ? `I need one detail before I can continue: ${questions.join(" ")}`
      : "I need a little more detail before I can continue."
  }

  if (stringValue(outcome.reasonCode) === "unsupported_command") {
    return "I couldn't map that to a supported workflow action. Type / to see available commands."
  }
  const reasons = stringArray(outcome.reasons)
  return reasons.length > 0
    ? `I can't do that: ${reasons.join(" ")}`
    : "I can't complete that request within the current workflow boundary."
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : []
}

function requireNoArguments(args: string[], usage: string): void {
  if (args.length) throw new CliError("invalid_arguments", `Use: ${usage}.`)
}

function isAuthenticatedContext(value: unknown): boolean {
  return asRecord(value)?.authenticated === true
}

function headerContext(
  value: unknown,
  inbox?: { itemCount?: number; warningCount?: number },
  settings?: WorkspaceHeaderSettings
): TerminalHeaderContext {
  const source = asRecord(value)
  const company = asRecord(source?.company)
  const user = asRecord(source?.user)
  return {
    companyName: stringValue(company?.name) ?? null,
    contextStatus: settings?.contextStatus ?? null,
    inboxCount: inbox?.itemCount ?? null,
    mode: stringValue(source?.mode) ?? "sandbox",
    sandboxStatus: settings?.sandboxStatus ?? null,
    userEmail: stringValue(user?.email) ?? null,
    warningCount: inbox?.warningCount ?? null,
  }
}

function isRowNumber(value: string): boolean {
  return /^[1-9][0-9]*$/.test(value)
}

function isYes(value: string): boolean {
  const normalized = value.trim().toLowerCase()
  return normalized === "y" || normalized === "yes"
}

function arrayFrom(value: unknown, key: string): unknown[] {
  const candidate = asRecord(value)?.[key]
  return Array.isArray(candidate) ? candidate : []
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

function numericValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function workspaceSettingsSummary(
  status: Record<string, unknown>,
  options: RenderOptions
): string {
  const provider = stringValue(status.provider)
  const readiness = stringValue(status.readiness)
  const sandboxEnabled = status.sandboxEnabled === true
  const version = numericValue(status.configurationVersion)
  return renderHumanResult(
    {
      context: {
        provider:
          provider === "supermemory" ? "Supermemory (not ready)" : "Off",
        readiness: readiness ?? "unavailable",
        providerOperational:
          asRecord(status.providerStatus)?.operational === true,
        indexingCoverage: "unavailable",
        synchronizationLag: "unavailable",
      },
      sandboxSafety: sandboxEnabled ? "On" : "Off",
      configurationVersion: version ?? "unavailable",
    },
    { ...options, title: "Workspace settings" }
  )
}

function formatCount(value: number | undefined): string {
  return value === undefined ? "the generated" : value.toLocaleString("en-US")
}

function confirmationPrompt(
  context: ConfirmationContext,
  includeTypedHint: boolean
): string {
  const suffix = includeTypedHint ? " [y/N] " : ""
  if (context.intent.kind === "execute_mock_action") {
    return `Execute this approved action in Sandbox?${suffix}`
  }
  if (context.intent.kind === "record_decision") {
    if (context.intent.decision === "approve") {
      return `Approve this draft?${suffix}`
    }
    if (context.intent.decision === "edit") {
      return `Approve this edited draft?${suffix}`
    }
  }
  return `Continue?${suffix}`
}

function confirmationChoice(context: ConfirmationContext): TuiChoice {
  if (context.intent.kind === "execute_mock_action") {
    return {
      value: "confirm",
      label: "Run mock execution",
      description: "No live external record will be created",
    }
  }
  if (context.intent.kind === "record_decision") {
    const edited = context.intent.decision === "edit"
    return {
      value: "confirm",
      label: edited ? "Approve edited draft" : "Record decision",
      description: edited
        ? "Save the edit and record approval"
        : "Submit this reviewed decision",
    }
  }
  return {
    value: "confirm",
    label: "Continue",
    description: "Proceed with the previewed change",
  }
}

function fixtureLabel(id: string): string {
  const label = id.replaceAll("_", " ")
  return `${label.charAt(0).toUpperCase()}${label.slice(1)}`
}

function actionableErrorMessage(error: CliError): string | undefined {
  if (error.code === "session_expired") {
    return "Your saved sign-in expired or was revoked and has been cleared. Sign in again with /login."
  }
  if (error.code === "unknown_local_user") {
    return "That email is not part of the local demo. Use /login --local seed@example.com, then open http://127.0.0.1:54324 and choose the newest message."
  }
  if (error.code === "magic_link_failed") {
    return "Mandala could not send the sign-in link. Confirm local Supabase is running, then retry /login --local seed@example.com."
  }
  if (error.code === "auth_callback_timeout") {
    return "The sign-in link was not opened before the wait ended. Retry /login --local seed@example.com, then open the newest message at http://127.0.0.1:54324."
  }
  if (error.code === "auth_cancelled") {
    return "Sign in cancelled. Your previous session was not changed."
  }
  if (error.code === "network_error" || error.code === "api_unavailable") {
    return "The local Mandala API is not running. From the Backdesk repository, start it with pnpm dev, then retry /refresh."
  }
  if (error.code === "unauthorized") {
    return "Sign in first. Use /login."
  }
  if (error.code === "test_agent_unavailable") {
    return "The Sandbox test agent could not complete its model run. Confirm the local API has MANDALA_TEST_AGENT_ENABLED=true plus AI Gateway and LangSmith settings, then run it again. No Inbox item was created."
  }
  if (error.code === "selection_required") {
    return "Select a work item first. Open /inbox, then choose a row with /open 1."
  }
  if (error.code === "invalid_target") {
    return `${error.message} Open the relevant list again to refresh its row numbers.`
  }
  return undefined
}

function unavailableMutationMessage(action: MutationAction): string {
  const recovery =
    "From the Backdesk repository, start the API with pnpm dev, then retry."
  if (action === "execute") {
    return `The local Mandala API is not running, so no execution request was sent. The existing approval remains recorded. ${recovery}`
  }
  return `The local Mandala API is not running, so no decision request was sent and workflow state did not change. ${recovery}`
}

async function readAgentSkillFile(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8")
  } catch {
    throw new CliError(
      "skill_file_unavailable",
      `Mandala could not read ${path || "that skill file"}. Check the path and try again.`
    )
  }
}

function magicLinkWaitingMessage(
  email: string,
  environment: RuntimeEnvironment
): string {
  const configuredUrl = environment.MANDALA_SUPABASE_URL
  const hostname = configuredUrl ? new URL(configuredUrl).hostname : "127.0.0.1"
  const local = ["127.0.0.1", "localhost", "[::1]"].includes(hostname)
  return local
    ? "Magic link sent. Open http://127.0.0.1:54324 on this Mac, choose the newest message, and click its link. Mandala will continue automatically. Press Escape to cancel."
    : `Magic link sent to ${email}. Open it on this machine to continue. Press Escape to cancel.`
}

function deviceAuthorizationWaitingMessage(request: {
  browserOpened: boolean
}) {
  return request.browserOpened
    ? "A browser window was opened for Mandala sign-in. Sign in with Microsoft, Google, or your email magic link. Mandala will continue automatically, then let you choose a workspace here. Press Escape to cancel."
    : "Mandala could not open the browser sign-in page."
}

function isAuthenticationError(error: CliError): boolean {
  return new Set(["session_expired", "unauthorized"]).has(error.code)
}

function writeTo(stream: Writable, value: string): void {
  if (!value) return
  stream.write(value.endsWith("\n") ? value : `${value}\n`)
}
