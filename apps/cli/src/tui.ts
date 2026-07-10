import type { Readable, Writable } from "node:stream"
import type { WorkItemDetail } from "@workspace/control-plane"
import type { CliDependencies } from "./cli.js"
import { executeCliCommand, type CliCommandResult } from "./cli.js"
import {
  confirmationDisplay,
  type ConfirmationContext,
  type ConfirmMutation,
} from "./confirmation.js"
import { asCliError, CliError } from "./errors.js"
import {
  getSlashCommand,
  parseSlashCommand,
  slashCommands,
  type SlashCommandDefinition,
  type SlashViewDefinition,
} from "./slash-commands.js"
import {
  renderAssistantMessage,
  renderDraftPreview,
  renderHeader,
  renderHumanResult,
  renderInboxSummary,
  type TerminalHeaderContext,
} from "./terminal/index.js"
import {
  resolveTuiWidth,
  runInkTui,
  type CreateTuiSession,
  type TuiSessionIo,
} from "./tui-app.js"

type ExecuteCliCommand = typeof executeCliCommand

export type TuiDependencies = CliDependencies & {
  execute?: ExecuteCliCommand
}

type RenderOptions = {
  color: boolean
  width: number
}

type SelectedItem = {
  companyId: string
  id: string
  status: string
  title: string
}

type ItemRow = SelectedItem

type CompanyRow = {
  id: string
  name: string
}

type FixtureRow = {
  description: string
  id: string
}

type MutationAction = "approve" | "reject" | "rework" | "edit" | "execute"

type MutationArguments = {
  acknowledgeWarnings: boolean
  assignments: string[]
  reason?: string
  target?: string
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
  const createSession = createSessionFactory(dependencies, stdout, stderr)

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

function createSessionFactory(
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
    if (answer !== null) writeTo(input.stdout, `${prompt}${answer}`)
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
  private readonly fixtureRows = new Map<number, FixtureRow>()
  private readonly itemRows = new Map<number, ItemRow>()
  private currentCompanyId?: string
  private selectedItem?: SelectedItem
  private readonly cliDependencies: CliDependencies
  private readonly commandStderr: Writable
  private readonly commandStdout: Writable
  private readonly execute: ExecuteCliCommand
  private readonly io: TuiSessionIo
  private readonly confirm: ConfirmMutation

  constructor(input: {
    cliDependencies: CliDependencies
    commandStderr: Writable
    commandStdout: Writable
    execute: ExecuteCliCommand
    io: TuiSessionIo
  }) {
    this.cliDependencies = input.cliDependencies
    this.commandStderr = input.commandStderr
    this.commandStdout = input.commandStdout
    this.execute = input.execute
    this.io = input.io
    this.renderOptions = input.io.renderOptions
    this.confirm =
      input.cliDependencies.confirm ??
      createTuiConfirmation(input.io.ask, input.io.append, this.renderOptions)
  }

  async start(): Promise<void> {
    const context = await this.runCommand(["context"])
    if (!context.ok) {
      this.write(renderHeader({ mode: "mock" }, this.renderOptions))
      this.writeError(context.error)
      return
    }

    this.updateCompanyFromContext(context.data)
    const inbox =
      isAuthenticatedContext(context.data) && this.currentCompanyId
        ? await this.loadInboxHeader()
        : undefined
    this.write(
      renderHeader(headerContext(context.data, inbox), this.renderOptions)
    )
    if (inbox?.error) this.writeError(inbox.error)
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
    this.exitRequested = true
  }

  private async handleConversation(input: string): Promise<void> {
    const local = localConversationResponse(input)
    if (local) {
      this.write(renderAssistantMessage(local.message, this.renderOptions))
      if (local.showCommands) this.showHelp()
      return
    }

    this.writeConversationResult(await this.runCommand(["chat", input]), input)
  }

  clearState(): void {
    this.clearCompanyBoundState()
    this.currentCompanyId = undefined
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
      case "/auth-status":
        requireNoArguments(args, definition.usage)
        this.writeResult(await this.runCommand(["auth", "status"]))
        return
      case "/logout":
        requireNoArguments(args, definition.usage)
        await this.logout()
        return
      case "/companies":
        requireNoArguments(args, definition.usage)
        await this.showCompanies()
        return
      case "/company":
        await this.switchCompany(args, definition.usage)
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
        requireNoArguments(args, definition.usage)
        await this.showSelectedSection(definition.command.slice(1))
        return
      case "/approve":
      case "/reject":
      case "/deny":
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
        this.notifySnapshot()
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
    if (args.length > 1)
      throw new CliError("invalid_arguments", "Use: /login [email].")
    const email = args[0] ?? (await this.io.ask("Email: "))
    if (email === null) {
      this.requestExit()
      return
    }
    if (!email.trim())
      throw new CliError(
        "clarification_required",
        "Enter the email address to use for sign in."
      )
    const result = await this.runCommand([
      "auth",
      "login",
      "--email",
      email.trim(),
    ])
    this.writeResult(result)
    if (!result.ok) return
    this.clearState()
    await this.showHeader()
  }

  private async logout(): Promise<void> {
    const result = await this.runCommand(["auth", "logout"])
    this.writeResult(result)
    if (result.ok) {
      this.clearState()
      await this.showHeader()
    }
  }

  private async showCompanies(): Promise<void> {
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
    this.write(
      renderHumanResult(
        { ...asRecord(result.data), companies: numbered },
        this.renderOptions
      )
    )
  }

  private async switchCompany(args: string[], usage: string): Promise<void> {
    if (args.length !== 1)
      throw new CliError("invalid_arguments", `Use: ${usage}.`)
    const companyId = this.resolveCompanyTarget(args[0] ?? "")
    const result = await this.runCommand(["company", "use", companyId])
    this.writeResult(result)
    if (!result.ok) return
    this.clearCompanyBoundState()
    this.currentCompanyId = companyId
    await this.showHeader()
  }

  private async showView(view: SlashViewDefinition): Promise<void> {
    const result = await this.runCommand([...view.backendArgs])
    if (!result.ok) {
      this.writeError(result.error)
      return
    }
    this.showViewData(result.data, view)
  }

  private showViewData(value: unknown, view: SlashViewDefinition): void {
    const visible = filterWorkItems(value, view)
    this.itemRows.clear()
    const numbered = visible.map((item, index) => {
      const record = asRecord(item)
      const id = stringValue(record?.id)
      const title = stringValue(record?.title)
      const status = stringValue(record?.status)
      if (id && title && status && this.currentCompanyId) {
        this.itemRows.set(index + 1, {
          companyId: this.currentCompanyId,
          id,
          status,
          title,
        })
      }
      return record ?? item
    })
    this.write(
      renderHumanResult(
        { items: numbered },
        {
          ...this.renderOptions,
          kind: "work-list",
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
    this.write(
      renderHumanResult(
        { ...asRecord(result.data), scenarios: numbered },
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
    this.writeResult(
      await this.runCommand(["workflow", "fixture", "run", scenarioId])
    )
  }

  private async openItem(args: string[], usage: string): Promise<void> {
    if (args.length !== 1)
      throw new CliError("invalid_arguments", `Use: ${usage}.`)
    const canonical = await this.fetchCanonicalItem(args[0], true)
    if (!canonical) return
    this.writeSelectedItem()
  }

  private async refresh(): Promise<void> {
    if (this.selectedItem) {
      const canonical = await this.fetchCanonicalItem(undefined, true)
      if (canonical) this.writeSelectedItem()
      return
    }
    const inbox = getSlashCommand("/inbox")?.view
    if (inbox) await this.showView(inbox)
  }

  private async showSelectedSection(section: string): Promise<void> {
    const detail = await this.fetchCanonicalItem(undefined, false)
    if (!detail) return
    if (section === "draft") {
      if (detail.draft)
        this.write(renderDraftPreview(detail.draft, this.renderOptions))
      else this.write(renderHumanResult({ draft: null }, this.renderOptions))
      return
    }
    if (section === "history") {
      this.write(
        renderHumanResult(
          {
            attempt: detail.attempt,
            auditEvents: detail.auditEvents,
            decision: detail.decision,
          },
          this.renderOptions
        )
      )
      return
    }
    this.write(
      renderHumanResult(
        { [section]: detail[section as "recommendation" | "evidence"] },
        this.renderOptions
      )
    )
  }

  private async mutate(
    action: MutationAction,
    args: string[],
    usage: string
  ): Promise<void> {
    const parsed = parseMutationArguments(args, usage)
    const detail = await this.fetchCanonicalItem(parsed.target, false)
    if (!detail || !this.selectedItem) return
    this.writeSelectedItem()

    if (action === "edit" && parsed.assignments.length === 0) {
      const assignment = await this.io.ask(
        "Edit assignment (JSON Pointer, for example /lines/0/quantity=24): "
      )
      if (assignment === null) {
        this.requestExit()
        return
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
        this.requestExit()
        return
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
      const answer = await this.io.ask(
        `Acknowledge ${warnings.length} current warning${warnings.length === 1 ? "" : "s"}? [y/N] `
      )
      if (answer === null) {
        this.requestExit()
        return
      }
      if (!isYes(answer))
        throw new CliError(
          "command_cancelled",
          "Warnings were not acknowledged; no decision was submitted."
        )
      parsed.acknowledgeWarnings = true
    }

    const command = mutationCommand(action, this.selectedItem.id, parsed)
    if (action === "approve") command.push("--execute")
    const result = await this.runCommand(command)
    this.writeResult(result)
    if (!result.ok) return
    this.updateSelectedStatus(result.data)
    await this.showInboxSummary()
  }

  private async fetchCanonicalItem(
    target: string | undefined,
    render: boolean
  ): Promise<WorkItemDetail | undefined> {
    const itemId = target
      ? this.resolveItemTarget(target)
      : this.requireSelectedItem().id
    const result = await this.runCommand(["work", "show", itemId])
    if (!result.ok) {
      this.writeError(result.error)
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
    this.selectedItem = {
      companyId: this.currentCompanyId,
      id,
      status,
      title,
    }
    this.notifySnapshot()
    if (render) this.write(renderHumanResult(result.data, this.renderOptions))
    return detail
  }

  private requireSelectedItem(): SelectedItem {
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
    const result = await this.runCommand(["context"])
    if (!result.ok) {
      this.writeError(result.error)
      return
    }
    this.updateCompanyFromContext(result.data)
    this.write(renderHumanResult(result.data, this.renderOptions))
  }

  private async showHeader(): Promise<void> {
    const result = await this.runCommand(["context"])
    if (!result.ok) {
      this.writeError(result.error)
      return
    }
    this.updateCompanyFromContext(result.data)
    const inbox =
      isAuthenticatedContext(result.data) && this.currentCompanyId
        ? await this.loadInboxHeader()
        : undefined
    this.write(
      renderHeader(headerContext(result.data, inbox), this.renderOptions)
    )
    if (inbox?.error) this.writeError(inbox.error)
  }

  private showHelp(): void {
    this.write(
      renderHumanResult(
        {
          commands: slashCommands.map(({ command, description, usage }) => ({
            command,
            description,
            usage,
          })),
        },
        this.renderOptions
      )
    )
  }

  private async showInboxSummary(): Promise<void> {
    const view = getSlashCommand("/inbox")?.view
    if (!view) return
    const result = await this.runCommand([...view.backendArgs])
    if (!result.ok) {
      this.writeError(result.error)
      return
    }
    const items = filterWorkItems(result.data, view)
    this.write(
      renderInboxSummary(
        { items, warningCount: countItemsWithWarnings(items) },
        this.renderOptions
      )
    )
  }

  private async loadInboxHeader(): Promise<{
    error?: CliError
    itemCount?: number
    warningCount?: number
  }> {
    const view = getSlashCommand("/inbox")?.view
    if (!view) return {}
    const result = await this.runCommand([...view.backendArgs])
    if (!result.ok) return { error: result.error }
    const items = filterWorkItems(result.data, view)
    return {
      itemCount: items.length,
      warningCount: countItemsWithWarnings(items),
    }
  }

  private updateCompanyFromContext(value: unknown): void {
    const company = asRecord(asRecord(value)?.company)
    const nextCompanyId = stringValue(company?.id)
    if (nextCompanyId !== this.currentCompanyId) {
      this.clearCompanyBoundState()
      this.currentCompanyId = nextCompanyId
    }
  }

  private updateSelectedStatus(value: unknown): void {
    if (!this.selectedItem) return
    const source = asRecord(value)
    const execution = asRecord(source?.execution)
    const decision = asRecord(source?.decision)
    const item =
      asRecord(execution?.item) ??
      asRecord(decision?.item) ??
      asRecord(source?.item)
    const status = stringValue(item?.status)
    if (status) this.selectedItem = { ...this.selectedItem, status }
    this.notifySnapshot()
  }

  private clearCompanyBoundState(): void {
    this.selectedItem = undefined
    this.companyRows.clear()
    this.fixtureRows.clear()
    this.itemRows.clear()
    this.notifySnapshot()
  }

  private notifySnapshot(): void {
    this.io.onSnapshot({ selectedItem: this.selectedItem })
  }

  private writeSelectedItem(): void {
    if (!this.selectedItem) return
    this.write(
      renderHumanResult({ selectedItem: this.selectedItem }, this.renderOptions)
    )
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
    const actionable = actionableErrorMessage(error)
    if (actionable) {
      this.write(`Error\n${actionable}`, "error")
      return
    }
    this.write(
      renderHumanResult(
        { error: { code: error.code, message: error.message } },
        this.renderOptions
      ),
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

function createTuiConfirmation(
  ask: TuiSessionIo["ask"],
  append: TuiSessionIo["append"],
  renderOptions: RenderOptions
): ConfirmMutation {
  return async (context: ConfirmationContext) => {
    append(
      renderHumanResult(
        {
          confirmation: confirmationDisplay(context),
        },
        renderOptions
      )
    )
    if (context.draft) {
      append(renderDraftPreview(context.draft, renderOptions))
    }
    const answer = await ask(confirmationPrompt(context))
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
  inbox?: { itemCount?: number; warningCount?: number }
): TerminalHeaderContext {
  const source = asRecord(value)
  const company = asRecord(source?.company)
  const user = asRecord(source?.user)
  return {
    companyName: stringValue(company?.name) ?? null,
    inboxCount: inbox?.itemCount ?? null,
    mode: stringValue(source?.mode) ?? "mock",
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

function confirmationPrompt(context: ConfirmationContext): string {
  if (context.intent.kind === "execute_mock_action") {
    return "Execute this approved action in Sandbox? [y/N] "
  }
  if (context.intent.kind === "record_decision") {
    if (context.intent.decision === "approve") {
      return "Approve this draft? [y/N] "
    }
    if (context.intent.decision === "edit") {
      return "Approve this edited draft? [y/N] "
    }
  }
  return "Continue? [y/N] "
}

function actionableErrorMessage(error: CliError): string | undefined {
  if (error.code === "selection_required") {
    return "Select a work item first. Open /inbox, then choose a row with /open 1."
  }
  if (error.code === "invalid_target") {
    return `${error.message} Open the relevant list again to refresh its row numbers.`
  }
  return undefined
}

function writeTo(stream: Writable, value: string): void {
  if (!value) return
  stream.write(value.endsWith("\n") ? value : `${value}\n`)
}
