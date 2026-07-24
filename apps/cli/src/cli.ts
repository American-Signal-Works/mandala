import { createHash, randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"
import { createInterface } from "node:readline/promises"
import { parseArgs } from "node:util"
import type { Readable, Writable } from "node:stream"
import {
  applyJsonPointerAssignments,
  createControlIntentCandidate,
  jsonObjectSchema,
  normalizeValidationResult,
  parseControlPhrase,
  parseJsonPointerAssignment,
  projectControlIntentForAudit,
  resolveControlIntent,
  type ControlIntentCandidate,
  type ControlIntent,
  type ControlParseData,
  type ControlOutcome,
  type ControlRequestCreateRequest,
  type ControlRequestTransitionRequest,
  type ControlRisk,
  type DecisionKind,
  type JsonPointerPatch,
  type JsonValue,
  type WorkItemDetail,
  type WorkItemQueueData,
} from "@workspace/control-plane"
import { z } from "zod"
import { ApiClient, type ControlApi } from "./api-client.js"
import {
  loginWithDeviceAuthorization,
  loginWithMagicLink,
  revokeHostedCliSession,
  SessionManager,
  type SessionAccess,
} from "./auth.js"
import {
  createInteractiveConfirmation,
  type ConfirmMutation,
} from "./confirmation.js"
import { getApiUrl, type RuntimeEnvironment } from "./environment.js"
import { CliError, asCliError } from "./errors.js"
import { registeredFixtureScenarios } from "./fixtures.js"
import { redactSecretText, writeFailure, writeSuccess } from "./output.js"
import { createRuntimeSecureStore, SecureStore } from "./persistence.js"
import {
  formatErrorSentence,
  renderAssistantMessage,
  renderHumanResult,
} from "./terminal/index.js"

type LoginFunction = typeof loginWithDeviceAuthorization
type LocalLoginFunction = typeof loginWithMagicLink

export type CliDependencies = {
  environment?: RuntimeEnvironment
  stdin?: Readable
  stdout?: Writable
  stderr?: Writable
  store?: SecureStore
  session?: SessionAccess
  api?: ControlApi
  confirm?: ConfirmMutation
  login?: LoginFunction
  localLogin?: LocalLoginFunction
  signal?: AbortSignal
}

export type CliCommandResult =
  | { ok: true; data: unknown }
  | { ok: false; error: CliError }

type AuditState = {
  eligible: boolean
  inputHash: string
  parserKind: "explicit" | "deterministic" | "langchain"
  controlRequestId?: string
  companyId?: string
  intent?: ControlIntent
  risk: ControlRisk
  workflowRunId?: string
  workflowItemId?: string
  recorded: boolean
}

const uuidSchema = z.string().uuid()

export async function runCli(
  argv: string[],
  dependencies: CliDependencies = {}
): Promise<number> {
  const stdout = dependencies.stdout ?? process.stdout
  const stderr = dependencies.stderr ?? process.stderr
  const json = argv.includes("--json")
  const output = { json, stdout, stderr }
  const result = await executeCliCommand(argv, dependencies)
  const answer =
    result.ok && !json && argv[0] === "chat"
      ? chatAnswer(result.data)
      : undefined

  if (result.ok) {
    if (json) writeSuccess(output, result.data)
    else if (isUsageResult(result.data)) {
      stdout.write(
        result.data.usage.endsWith("\n")
          ? result.data.usage
          : `${result.data.usage}\n`
      )
    } else if (answer) {
      const rendered = renderAssistantMessage(answer, {
        width: (stdout as Writable & { columns?: number }).columns,
      })
      stdout.write(rendered.endsWith("\n") ? rendered : `${rendered}\n`)
    } else {
      const rendered = renderHumanResult(result.data, {
        width: (stdout as Writable & { columns?: number }).columns,
      })
      stdout.write(rendered.endsWith("\n") ? rendered : `${rendered}\n`)
    }
    return 0
  }
  if (!json) {
    stderr.write(
      `${formatErrorSentence(redactSecretText(result.error.message))}\n`
    )
    return result.error.exitCode
  }
  return writeFailure(output, result.error)
}

function isUsageResult(value: unknown): value is { usage: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length === 1 &&
    typeof (value as { usage?: unknown }).usage === "string"
  )
}

export async function executeCliCommand(
  argv: string[],
  dependencies: CliDependencies = {}
): Promise<CliCommandResult> {
  const environment = dependencies.environment ?? process.env
  const stdin = dependencies.stdin ?? process.stdin
  const stderr = dependencies.stderr ?? process.stderr
  const args = argv.filter((argument) => argument !== "--json")
  const store = dependencies.store ?? createRuntimeSecureStore(environment)
  const session = dependencies.session ?? new SessionManager(store, environment)
  let api: ControlApi | undefined = dependencies.api
  const getApi = (): ControlApi => {
    api ??= new ApiClient(getApiUrl(environment), session)
    return api
  }
  const confirm =
    dependencies.confirm ?? createInteractiveConfirmation(stdin, stderr)
  const login = dependencies.login ?? loginWithDeviceAuthorization
  const localLogin = dependencies.localLogin ?? loginWithMagicLink
  const audit: AuditState = {
    eligible: new Set(["parse", "chat", "work", "workflow"]).has(args[0] ?? ""),
    inputHash: createHash("sha256").update(args.join("\u0000")).digest("hex"),
    parserKind:
      args[0] === "parse" || args[0] === "chat" ? "deterministic" : "explicit",
    risk: "read",
    recorded: false,
  }

  try {
    if (audit.eligible) {
      const config = await store.readConfig()
      audit.companyId = config.selectedCompany?.id
    }
    if (args.includes("--yes"))
      throw new CliError(
        "unsupported_flag",
        "--yes is not supported; mutations require confirmation."
      )
    if (
      args.length === 0 ||
      args[0] === "help" ||
      args.includes("--help") ||
      args.includes("-h")
    ) {
      return { ok: true, data: { usage: usageText } }
    }

    const data = await executeCommand({
      args,
      environment,
      store,
      session,
      getApi,
      confirm,
      login,
      localLogin,
      audit,
      signal: dependencies.signal,
      stdin,
      stderr,
    })
    return { ok: true, data }
  } catch (error) {
    const safe = asCliError(error)
    if (audit.eligible && audit.companyId && !audit.recorded) {
      const resolutionStatus =
        safe.code === "clarification_required"
          ? "clarification_required"
          : safe.code === "command_cancelled" ||
              safe.code === "intent_blocked" ||
              safe.code === "invalid_arguments" ||
              safe.code === "unknown_command" ||
              safe.code === "unsupported_flag"
            ? "blocked"
            : "failed"
      await recordAudit(getApi, audit, resolutionStatus, false).catch(
        () => undefined
      )
    }
    return { ok: false, error: safe }
  }
}

async function executeCommand(input: {
  args: string[]
  environment: RuntimeEnvironment
  store: SecureStore
  session: SessionAccess
  getApi: () => ControlApi
  confirm: ConfirmMutation
  login: LoginFunction
  localLogin: LocalLoginFunction
  audit: AuditState
  signal?: AbortSignal
  stdin: Readable
  stderr: Writable
}): Promise<unknown> {
  const [group, action, ...rest] = input.args

  if (group === "auth") return handleAuth(action, rest, input)
  if (group === "status") return handleStatus(action, rest, input)
  if (group === "company") return handleCompany(action, rest, input)
  if (group === "context") {
    if (action === undefined) return showContext(input.store)
    return handleContextSettings(action, rest, input)
  }
  if (group === "sandbox") return handleSandbox(action, rest, input)
  if (group === "agents") return handleAgents(action, rest, input)
  if (group === "workflow") return handleWorkflow(action, rest, input)
  if (group === "work") return handleWork(action, rest, input)
  if (group === "parse")
    return handleParse(
      [action, ...rest].filter((value): value is string => value !== undefined),
      input
    )
  if (group === "chat")
    return handleChat(
      [action, ...rest].filter((value): value is string => value !== undefined),
      input
    )

  throw new CliError(
    "unknown_command",
    "Unknown command. Run 'mandala help' for usage."
  )
}

async function handleAuth(
  action: string | undefined,
  args: string[],
  input: Parameters<typeof executeCommand>[0]
): Promise<unknown> {
  if (action === "login") {
    const parsed = parseOptions(args, {
      email: { type: "string" },
      local: { type: "boolean" },
    })
    const email = stringOption(parsed.values.email)
    const local = parsed.values.local === true
    if (parsed.positionals.length || (local ? !email : Boolean(email)))
      throw new CliError(
        "invalid_arguments",
        "Use 'mandala auth login' for hosted sign-in, or 'mandala auth login --local --email <address>' for local engineering."
      )
    if (local) {
      return input.localLogin({
        email: email!,
        environment: input.environment,
        store: input.store,
        onMagicLinkSent: () =>
          inputMessage(
            input,
            "Local magic link sent. Open it on this machine to finish authentication."
          ),
      })
    }
    return input.login({
      environment: input.environment,
      store: input.store,
      onAuthorizationRequested: ({ browserOpened }) =>
        inputMessage(
          input,
          browserOpened
            ? "A browser window was opened for Mandala sign-in. Complete sign-in and choose a workspace there; this terminal will continue automatically."
            : "Mandala could not open the browser sign-in page."
        ),
    })
  }
  if (action === "status") {
    requireNoArguments(args, "mandala auth status")
    const session = await input.store.readSession()
    return session
      ? {
          authenticated: true,
          user: session.user,
          expiresAt: new Date(session.expiresAt * 1_000).toISOString(),
          expired: session.expiresAt <= Math.floor(Date.now() / 1_000),
        }
      : { authenticated: false }
  }
  if (action === "logout") {
    requireNoArguments(args, "mandala auth logout")
    const remoteRevoked = await revokeHostedCliSession({
      environment: input.environment,
      store: input.store,
    })
    await input.store.deleteSession()
    await input.store.clearSelectedCompany()
    return { authenticated: false, remoteRevoked }
  }
  throw new CliError(
    "unknown_command",
    "Use: mandala auth login|status|logout."
  )
}

type EndpointProbe =
  | { ok: true; durationMs: number }
  | { ok: false; durationMs: number; code: string; message: string }

async function probeEndpoint<T>(
  run: () => Promise<T>
): Promise<{ probe: EndpointProbe; data: T | null }> {
  const startedAt = Date.now()
  try {
    const data = await run()
    return { probe: { ok: true, durationMs: Date.now() - startedAt }, data }
  } catch (error) {
    if (error instanceof CliError)
      return {
        probe: {
          ok: false,
          durationMs: Date.now() - startedAt,
          code: error.code,
          message: error.message,
        },
        data: null,
      }
    throw error
  }
}

function describeProbe(probe: EndpointProbe): string {
  return probe.ok
    ? `ok (${probe.durationMs} ms)`
    : `failed: ${probe.code} (${probe.durationMs} ms)`
}

async function handleStatus(
  action: string | undefined,
  args: string[],
  input: Parameters<typeof executeCommand>[0]
): Promise<unknown> {
  if (action !== undefined || args.length > 0)
    throw new CliError("unknown_command", "Use: mandala status.")
  const savedSession = await input.store.readSession()
  let sessionIssue: string | null = null
  if (savedSession) {
    try {
      await input.session.getAccessToken()
    } catch (error) {
      if (!(error instanceof CliError)) throw error
      sessionIssue = error.code
    }
  }
  const session = await input.store.readSession()
  const sessionStatus =
    session && !sessionIssue
      ? {
          authenticated: true,
          email: session.user.email,
          expiresAt: new Date(session.expiresAt * 1_000).toISOString(),
          status: "ready",
        }
      : {
          authenticated: false,
          ...(sessionIssue ? { issue: sessionIssue } : {}),
        }
  const config = await input.store.readConfig()
  input.audit.companyId = config.selectedCompany?.id
  if (!config.selectedCompany) {
    return {
      session: sessionStatus,
      workspace: { selected: false },
      nextAction: sessionStatus.authenticated
        ? "Select a company with 'mandala company use'."
        : "Sign in with 'mandala auth login'.",
    }
  }
  const companyId = config.selectedCompany.id
  const api = input.getApi()
  const context = await probeEndpoint(() =>
    api.getContextWorkspaceStatus(companyId)
  )
  const queue = await probeEndpoint(() => api.listWorkItems(companyId))
  const status = context.data
  return {
    session: sessionStatus,
    workspace: {
      id: companyId,
      name: config.selectedCompany.name,
      mode: config.mode,
    },
    endpoints: {
      contextSettings: describeProbe(context.probe),
      workQueue: describeProbe(queue.probe),
      activeWorkItems: queue.data === null ? null : queue.data.items.length,
    },
    contextEngine: status
      ? {
          provider: status.provider,
          sandboxEnabled: status.sandboxEnabled,
          readiness: status.readiness,
          configurationVersion: status.configurationVersion,
          providerHealth: status.providerStatus.status,
          eligibleRecords:
            status.indexingCoverage.status === "unavailable"
              ? null
              : status.indexingCoverage.eligibleRecordCount,
          indexedRecords:
            status.indexingCoverage.status === "unavailable"
              ? null
              : status.indexingCoverage.indexedRecordCount,
          syncLagSeconds: status.synchronization.lagSeconds,
          recentSyncErrors: status.synchronization.recentErrorCount,
        }
      : { unavailable: true },
  }
}

async function handleCompany(
  action: string | undefined,
  args: string[],
  input: Parameters<typeof executeCommand>[0]
): Promise<unknown> {
  if (action === "list") {
    requireNoArguments(args, "mandala company list")
    return input.getApi().listCompanies()
  }
  if (action === "use") {
    if (args.length !== 1)
      throw new CliError(
        "invalid_arguments",
        "Use: mandala company use <company-id>."
      )
    const companyId = args[0] ?? ""
    if (!uuidSchema.safeParse(companyId).success)
      throw new CliError("invalid_company", "Company ID must be a UUID.")
    const companies = await input.getApi().listCompanies()
    const company = companies.companies.find(
      (candidate) => candidate.id === companyId
    )
    if (!company)
      throw new CliError(
        "company_not_found",
        "That company is not available to the signed-in user."
      )
    const selected = await input.getApi().selectCompany(company.id)
    const config = await input.store.readConfig()
    await input.store.writeConfig({
      ...config,
      mode: "sandbox",
      selectedCompany: {
        id: selected.company.id,
        name: selected.company.name,
      },
    })
    return {
      company: selected.company,
      mode: "sandbox",
    }
  }
  if (action === "current") {
    requireNoArguments(args, "mandala company current")
    const config = await requireCompany(input.store, input.audit)
    return { company: config.selectedCompany, mode: config.mode }
  }
  throw new CliError(
    "unknown_command",
    "Use: mandala company list|use|current."
  )
}

async function showContext(store: SecureStore): Promise<unknown> {
  const [config, session] = await Promise.all([
    store.readConfig(),
    store.readSession(),
  ])
  return {
    authenticated: Boolean(session),
    user: session?.user ?? null,
    sessionExpiresAt: session
      ? new Date(session.expiresAt * 1_000).toISOString()
      : null,
    company: config.selectedCompany,
    mode: config.mode,
  }
}

async function handleContextSettings(
  action: string | undefined,
  args: string[],
  input: Parameters<typeof executeCommand>[0]
): Promise<unknown> {
  const config = await requireCompany(input.store, input.audit)
  if (action === "status") {
    requireNoArguments(args, "mandala context status")
    return input.getApi().getContextWorkspaceStatus(config.selectedCompany.id)
  }
  if (action === "set") {
    const parsed = parseSettingsMutation(args, "context")
    const provider = parsed.value
    if (provider !== "off" && provider !== "supermemory")
      throw new CliError(
        "invalid_arguments",
        "Context provider must be 'off' or 'supermemory'."
      )
    if (provider === "supermemory" && !parsed.confirmed)
      throw new CliError(
        "safety_confirmation_required",
        "Selecting Supermemory weakens the current safety posture. Review the change, then rerun with --confirm."
      )
    return setWorkspaceConfiguration(input, {
      companyId: config.selectedCompany.id,
      provider,
      expectedConfigurationVersion: parsed.expectedConfigurationVersion,
      reason: parsed.reason,
    })
  }
  throw new CliError(
    "unknown_command",
    "Use: mandala context, mandala context status, or mandala context set <off|supermemory> --expected-version <n> --reason <text>."
  )
}

async function handleSandbox(
  action: string | undefined,
  args: string[],
  input: Parameters<typeof executeCommand>[0]
): Promise<unknown> {
  if (action === "status") {
    requireNoArguments(args, "mandala sandbox status")
    const config = await requireCompany(input.store, input.audit)
    return input.getApi().getContextWorkspaceStatus(config.selectedCompany.id)
  }
  if (action === "set") {
    const config = await requireCompany(input.store, input.audit)
    const parsed = parseSettingsMutation(args, "sandbox")
    if (parsed.value !== "on" && parsed.value !== "off")
      throw new CliError(
        "invalid_arguments",
        "Sandbox setting must be 'on' or 'off'."
      )
    if (parsed.value === "off" && !parsed.confirmed)
      throw new CliError(
        "safety_confirmation_required",
        "Turning Sandbox safety Off weakens the workspace safety posture. Review the change, then rerun with --confirm."
      )
    return setWorkspaceConfiguration(input, {
      companyId: config.selectedCompany.id,
      sandboxEnabled: parsed.value === "on",
      expectedConfigurationVersion: parsed.expectedConfigurationVersion,
      reason: parsed.reason,
    })
  }
  if (action === "run") {
    const parsed = parseOptions(args, {
      skill: { type: "string" },
      "confirm-mappings": { type: "boolean" },
    })
    const skillPath = stringOption(parsed.values.skill)
    if (!skillPath || parsed.positionals.length) {
      throw new CliError(
        "invalid_arguments",
        "Use: mandala sandbox run --skill <SKILL.md> --confirm-mappings."
      )
    }
    if (parsed.values["confirm-mappings"] !== true) {
      throw new CliError(
        "mapping_confirmation_required",
        "Review the declarative mapping defaults, then rerun with --confirm-mappings."
      )
    }
    let skillMarkdown: string
    try {
      skillMarkdown = await readFile(skillPath, "utf8")
    } catch {
      throw new CliError(
        "skill_file_unreadable",
        "The SKILL.md file could not be read."
      )
    }
    const config = await requireCompany(input.store, input.audit)
    return input.getApi().runWorkspaceSandbox({
      companyId: config.selectedCompany.id,
      skillMarkdown,
      confirmMappings: true,
    })
  }
  if (action !== "open")
    throw new CliError(
      "unknown_command",
      "Use: mandala sandbox open [--limit <1-100>], mandala sandbox run --skill <SKILL.md> --confirm-mappings, mandala sandbox status, or mandala sandbox set <on|off> --expected-version <n> --reason <text>."
    )
  const parsed = parseOptions(args, { limit: { type: "string" } })
  if (parsed.positionals.length)
    throw new CliError(
      "invalid_arguments",
      "Use: mandala sandbox open [--limit <1-100>]."
    )
  const limit = stringOption(parsed.values.limit)
  const candidateLimit = limit ? Number.parseInt(limit, 10) : 25
  if (
    !Number.isInteger(candidateLimit) ||
    candidateLimit < 1 ||
    candidateLimit > 100
  )
    throw new CliError(
      "invalid_arguments",
      "Sandbox limit must be a whole number from 1 to 100."
    )
  const config = await requireCompany(input.store, input.audit)
  const request = {
    companyId: config.selectedCompany.id,
    candidateLimit,
  }
  return input.signal
    ? input.getApi().createSandboxSession(request, input.signal)
    : input.getApi().createSandboxSession(request)
}

function parseSettingsMutation(
  args: string[],
  setting: "context" | "sandbox"
): {
  confirmed: boolean
  expectedConfigurationVersion: number
  reason: string
  value: string
} {
  const parsed = parseOptions(args, {
    confirm: { type: "boolean" },
    "expected-version": { type: "string" },
    reason: { type: "string" },
  })
  const usage =
    setting === "context"
      ? "mandala context set <off|supermemory> --expected-version <n> --reason <text> [--confirm]"
      : "mandala sandbox set <on|off> --expected-version <n> --reason <text> [--confirm]"
  const [value] = parsed.positionals
  const expectedVersion = stringOption(parsed.values["expected-version"])
  const reason = stringOption(parsed.values.reason)?.trim()
  const expectedConfigurationVersion = expectedVersion
    ? Number(expectedVersion)
    : Number.NaN
  if (
    parsed.positionals.length !== 1 ||
    !value ||
    !Number.isInteger(expectedConfigurationVersion) ||
    expectedConfigurationVersion < 1 ||
    !reason ||
    reason.length > 1_000
  ) {
    throw new CliError("invalid_arguments", `Use: ${usage}.`)
  }
  return {
    confirmed: parsed.values.confirm === true,
    expectedConfigurationVersion,
    reason,
    value,
  }
}

async function setWorkspaceConfiguration(
  input: Parameters<typeof executeCommand>[0],
  request: Parameters<ControlApi["setContextWorkspaceConfiguration"]>[0]
): Promise<unknown> {
  try {
    return await input.getApi().setContextWorkspaceConfiguration(request)
  } catch (error) {
    const parsed = asCliError(error)
    if (
      parsed.code === "stale_context_workspace_configuration" ||
      parsed.code === "stale_configuration_version" ||
      parsed.code === "configuration_version_conflict"
    ) {
      throw new CliError(
        parsed.code,
        "Workspace settings changed since you last viewed them. Run the status command, then retry with its current configuration version."
      )
    }
    throw error
  }
}

async function handleAgents(
  action: string | undefined,
  args: string[],
  input: Parameters<typeof executeCommand>[0]
): Promise<unknown> {
  if (action !== "run")
    throw new CliError(
      "unknown_command",
      "Use: mandala agents run <agent-id> --reason <text> --confirm."
    )
  const [agentId, ...extra] = args
  if (!agentId)
    throw new CliError(
      "invalid_arguments",
      "Use: mandala agents run <agent-id> --reason <text> --confirm."
    )
  const parsed = parseOptions(extra, {
    reason: { type: "string" },
    confirm: { type: "boolean" },
  })
  if (parsed.positionals.length)
    throw new CliError(
      "invalid_arguments",
      "Use: mandala agents run <agent-id> --reason <text> --confirm."
    )
  const reason = stringOption(parsed.values.reason)
  if (!reason)
    throw new CliError(
      "invalid_arguments",
      "A --reason is required: this runs the agent against real company data."
    )
  if (parsed.values.confirm !== true)
    throw new CliError(
      "confirmation_required",
      "This runs the agent's manual trigger against real, cataloged company data and persists a reviewable work item. Review the agent's status, then rerun with --confirm."
    )
  const config = await requireCompany(input.store, input.audit)
  return input.getApi().runAgent(agentId, {
    companyId: config.selectedCompany.id,
    reason,
  })
}

async function handleWorkflow(
  action: string | undefined,
  args: string[],
  input: Parameters<typeof executeCommand>[0]
): Promise<unknown> {
  if (action !== "fixture")
    throw new CliError(
      "unknown_command",
      "Use: mandala workflow fixture list|run."
    )
  const [fixtureAction, scenarioId, ...extra] = args
  if (fixtureAction === "list") {
    if (scenarioId || extra.length)
      throw new CliError(
        "invalid_arguments",
        "Use: mandala workflow fixture list."
      )
    return { scenarios: registeredFixtureScenarios }
  }
  if (fixtureAction !== "run" || extra.length) {
    throw new CliError(
      "invalid_arguments",
      "Use: mandala workflow fixture run <scenario-id>."
    )
  }

  const config = await requireCompany(input.store, input.audit)
  const intent = await resolveCandidate(
    { kind: "run_fixture", scenarioId },
    { companyId: config.selectedCompany.id },
    input
  )
  return executeResolvedIntent(intent, input)
}

async function handleWork(
  action: string | undefined,
  args: string[],
  input: Parameters<typeof executeCommand>[0]
): Promise<unknown> {
  if (action === "list") return listWork(args, input)
  if (action === "inspect" || action === "show") return inspectWork(args, input)
  if (action === "ask") return askWork(args, input)
  if (action === "execute") return executeWork(args, input)
  if (
    action === "approve" ||
    action === "edit" ||
    action === "reject" ||
    action === "resolve" ||
    action === "rework" ||
    action === "decide"
  ) {
    return decideWork(action, args, input)
  }
  throw new CliError(
    "unknown_command",
    "Use: mandala work list|inspect|show|ask|approve|edit|reject|resolve|rework|decide|execute."
  )
}

async function listWork(
  args: string[],
  input: Parameters<typeof executeCommand>[0]
): Promise<unknown> {
  const parsed = parseOptions(args, { status: { type: "string" } })
  if (parsed.positionals.length)
    throw new CliError(
      "invalid_arguments",
      "Use: mandala work list [--status <status>]."
    )
  const config = await requireCompany(input.store, input.audit)
  const intent = await resolveCandidate(
    { kind: "list_work_items", status: stringOption(parsed.values.status) },
    { companyId: config.selectedCompany.id },
    input
  )
  return executeResolvedIntent(intent, input)
}

async function inspectWork(
  args: string[],
  input: Parameters<typeof executeCommand>[0]
): Promise<unknown> {
  const itemId = args.length === 1 ? args[0] : undefined
  const config = await requireCompany(input.store, input.audit)
  const intent = await resolveCandidate(
    { kind: "inspect_work_item", itemId },
    { companyId: config.selectedCompany.id },
    input
  )
  return executeResolvedIntent(intent, input)
}

async function askWork(
  args: string[],
  input: Parameters<typeof executeCommand>[0]
): Promise<unknown> {
  const parsed = parseOptions(args, { question: { type: "string" } })
  const itemId =
    parsed.positionals.length === 1 ? (parsed.positionals[0] ?? "") : ""
  const question = stringOption(parsed.values.question)
  if (!uuidSchema.safeParse(itemId).success || !question) {
    throw new CliError(
      "invalid_arguments",
      "Use: mandala work ask <item-id> --question <question>."
    )
  }
  const config = await requireCompany(input.store, input.audit)
  input.audit.workflowItemId = itemId
  input.audit.risk = "read"
  return input.getApi().askWorkItem(itemId, {
    companyId: config.selectedCompany.id,
    question,
  })
}

async function decideWork(
  action: "approve" | "edit" | "reject" | "resolve" | "rework" | "decide",
  args: string[],
  input: Parameters<typeof executeCommand>[0]
): Promise<unknown> {
  const parsed = parseOptions(args, {
    approve: { type: "boolean" },
    edit: { type: "boolean" },
    reject: { type: "boolean" },
    resolve: { type: "boolean" },
    rework: { type: "boolean" },
    execute: { type: "boolean" },
    reason: { type: "string" },
    set: { type: "string", multiple: true },
    "ack-warnings": { type: "boolean" },
  })
  const itemId =
    parsed.positionals.length === 1 ? parsed.positionals[0] : undefined
  const decision = decisionFromCommand(action, parsed.values)
  const patches = parsePatches(parsed.values.set)
  const reason = stringOption(parsed.values.reason)
  const warningsAcknowledged = parsed.values["ack-warnings"] === true
  const executeAfterDecision = parsed.values.execute === true
  const config = await requireCompany(input.store, input.audit)

  const intent = await resolveCandidate(
    {
      kind: "record_decision",
      itemId,
      decision,
      patches,
      reason,
    },
    {
      companyId: config.selectedCompany.id,
      warningsAcknowledged,
    },
    input
  )
  if (intent.kind !== "record_decision")
    throw new CliError("invalid_intent", "Expected a decision intent.")
  if (
    executeAfterDecision &&
    intent.decision !== "approve" &&
    intent.decision !== "edit"
  ) {
    throw new CliError(
      "invalid_arguments",
      "--execute is available only with approve or edit decisions."
    )
  }
  return executeResolvedIntent(intent, input, { executeAfterDecision })
}

async function executeWork(
  args: string[],
  input: Parameters<typeof executeCommand>[0]
): Promise<unknown> {
  const itemId = args.length === 1 ? args[0] : undefined
  const config = await requireCompany(input.store, input.audit)
  const intent = await resolveCandidate(
    { kind: "execute_mock_action", itemId },
    { companyId: config.selectedCompany.id },
    input
  )
  return executeResolvedIntent(intent, input)
}

async function handleParse(
  args: string[],
  input: Parameters<typeof executeCommand>[0]
): Promise<unknown> {
  const parsed = await parsePhrase(args.join(" "), input)
  if (!parsed.serverAudited) await recordPhraseOutcome(parsed.outcome, input)
  return parsed.serverResult
    ? conversationalParseOutput(parsed.serverResult)
    : parsed.outcome
}

async function handleChat(
  args: string[],
  input: Parameters<typeof executeCommand>[0]
): Promise<unknown> {
  const phrase = args.length
    ? args.join(" ")
    : await readSingleLine(input.stdin)
  if (isWorkspaceWorkSummaryQuestion(phrase)) {
    return answerWorkspaceWorkSummary(phrase, input)
  }
  const parsed = await parsePhrase(phrase, input)
  if (parsed.outcome.status !== "resolved") {
    if (!parsed.serverAudited) await recordPhraseOutcome(parsed.outcome, input)
    return parsed.serverResult
      ? conversationalParseOutput(parsed.serverResult)
      : parsed.outcome
  }
  const result = await executeResolvedIntent(parsed.outcome.intent, input)
  return parsed.serverResult
    ? { parser: conversationalParserMetadata(parsed.serverResult), result }
    : result
}

async function answerWorkspaceWorkSummary(
  phrase: string,
  input: Parameters<typeof executeCommand>[0]
) {
  input.audit.inputHash = hashInput(phrase)
  input.audit.parserKind = "deterministic"
  input.audit.risk = "read"
  const config = await requireCompany(input.store, input.audit)
  const status = /\bactive\b/i.test(phrase) ? "active" : undefined
  const intent = await resolveCandidate(
    { kind: "list_work_items", status },
    { companyId: config.selectedCompany.id },
    input
  )
  if (intent.kind !== "list_work_items")
    throw new CliError("invalid_intent", "Expected a work-item list intent.")

  const queue = (await executeResolvedIntent(
    intent,
    input
  )) as WorkItemQueueData
  const fixtures = queue.items.filter((item) => item.sourceType === "fixture")
  const workspaceItems = queue.items.filter(
    (item) => item.sourceType !== "fixture"
  )
  const scope = status ? "active " : ""
  const total = queue.items.length
  const countSentence =
    total === 0
      ? `In ${config.selectedCompany.name}, I found no ${scope}work items.`
      : `In ${config.selectedCompany.name}, I found ${total} ${scope}work ${total === 1 ? "item" : "items"}: ${workspaceItems.length} from real workspace activity and ${fixtures.length} ${fixtures.length === 1 ? "fixture test" : "fixture tests"}.`
  const workspaceSentence = classifiedItemSentence(
    "Real workspace",
    workspaceItems
  )
  const fixtureSentence = classifiedItemSentence("Fixture", fixtures)

  return {
    answer: [countSentence, workspaceSentence, fixtureSentence]
      .filter(Boolean)
      .join(" "),
    workspace: {
      id: config.selectedCompany.id,
      name: config.selectedCompany.name,
    },
    summary: {
      total,
      realWorkspace: workspaceItems.length,
      fixtures: fixtures.length,
    },
    items: queue.items.map((item) => ({
      id: item.id,
      title: item.title,
      classification:
        item.sourceType === "fixture" ? "fixture" : "real_workspace",
    })),
  }
}

function classifiedItemSentence(
  label: "Real workspace" | "Fixture",
  items: WorkItemQueueData["items"]
): string {
  if (items.length === 0) return ""
  const identities = items
    .map((item) => `“${item.title}” (${item.id})`)
    .join("; ")
  return `${label} ${items.length === 1 ? "item" : "items"}: ${identities}.`
}

function isWorkspaceWorkSummaryQuestion(phrase: string): boolean {
  const normalized = phrase.trim()
  if (
    /\b(?:approve|edit|reject|resolve|rework|execute|perform|run|change|update|delete|archive|remove|cancel)\b/i.test(
      normalized
    )
  ) {
    return false
  }
  const referencesWorkItems = /\bwork items?\b/i.test(normalized)
  const referencesBareItems = /\bitems\b/i.test(normalized)
  const hasWorkspaceSummaryQualifier =
    /\b(?:active|review|real(?:-data)?|workspace|fixture|test|summary|summarize)\b/i.test(
      normalized
    )
  const referencesItems =
    (referencesWorkItems &&
      (hasWorkspaceSummaryQualifier ||
        /\b(?:which|what)\b/i.test(normalized))) ||
    (referencesBareItems && hasWorkspaceSummaryQualifier)
  return (
    referencesItems &&
    (normalized.endsWith("?") ||
      /^(?:summarize|show|list|which|what|tell me|describe)\b/i.test(
        normalized
      ))
  )
}

function chatAnswer(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return undefined
  const answer = (value as { answer?: unknown }).answer
  return typeof answer === "string" && answer.trim() ? answer : undefined
}

async function parsePhrase(
  phrase: string,
  input: Parameters<typeof executeCommand>[0]
): Promise<{
  outcome: ControlOutcome
  serverAudited: boolean
  serverResult?: ControlParseData
}> {
  input.audit.inputHash = hashInput(phrase)
  input.audit.parserKind = "deterministic"
  const config = await input.store.readConfig()
  input.audit.companyId = config.selectedCompany?.id
  const outcome = parseControlPhrase(phrase, {
    companyId: config.selectedCompany?.id,
  })
  if (
    outcome.status !== "blocked" ||
    outcome.reasonCode !== "unsupported_command"
  ) {
    return { outcome, serverAudited: false }
  }
  if (!config.selectedCompany)
    throw new CliError(
      "company_required",
      "Select a company with 'mandala company use'."
    )

  input.audit.parserKind = "langchain"
  try {
    const result = await input.getApi().parseControlIntent({
      companyId: config.selectedCompany.id,
      input: phrase,
    })
    input.audit.parserKind = result.parserKind
    input.audit.controlRequestId = result.controlRequestId
    input.audit.recorded = result.outcome.status !== "resolved"
    if (result.outcome.status === "resolved") {
      input.audit.intent = result.outcome.intent
      input.audit.risk = result.outcome.intent.risk
    }
    return {
      outcome: result.outcome,
      serverAudited: true,
      serverResult: result,
    }
  } catch (error) {
    if (asCliError(error).code === "parser_unavailable") {
      input.audit.parserKind = "langchain"
      input.audit.recorded = true
    }
    throw error
  }
}

function conversationalParseOutput(result: ControlParseData) {
  const outcome =
    result.outcome.status === "resolved"
      ? {
          status: result.outcome.status,
          intent: projectControlIntentForAudit(result.outcome.intent),
          confirmationRequired: result.outcome.confirmationRequired,
        }
      : result.outcome
  return { ...conversationalParserMetadata(result), outcome }
}

function conversationalParserMetadata(result: ControlParseData) {
  return {
    parserKind: result.parserKind,
    model: result.model,
    durationMs: result.durationMs,
    trace: result.trace,
    controlRequestId: result.controlRequestId,
  }
}

async function recordPhraseOutcome(
  outcome: ControlOutcome,
  input: Parameters<typeof executeCommand>[0]
): Promise<void> {
  if (outcome.status === "resolved") {
    input.audit.intent = outcome.intent
    input.audit.risk = outcome.intent.risk
  }
  if (input.audit.companyId)
    await recordAudit(input.getApi, input.audit, outcome.status, false)
}

async function resolveCandidate(
  candidate: Parameters<typeof createControlIntentCandidate>[0],
  context: Parameters<typeof resolveControlIntent>[1],
  input: Parameters<typeof executeCommand>[0]
): Promise<ControlIntent> {
  return requireResolved(
    resolveControlIntent(createControlIntentCandidate(candidate), context),
    input
  )
}

async function executeResolvedIntent(
  intent: ControlIntent,
  input: Parameters<typeof executeCommand>[0],
  options: { executeAfterDecision?: boolean } = {}
): Promise<unknown> {
  input.audit.intent = intent
  input.audit.risk = intent.risk
  const config = await requireCompany(input.store, input.audit)
  if (config.selectedCompany.id !== intent.companyId)
    throw new CliError(
      "invalid_intent",
      "The resolved intent does not match the active company."
    )

  switch (intent.kind) {
    case "run_fixture": {
      const confirmed = await input.confirm({
        intent,
        companyName: config.selectedCompany.name,
      })
      if (!confirmed) throw commandCancelled()
      const result = await input.getApi().runFixture({
        companyId: intent.companyId,
        scenarioId: intent.scenarioId,
        control: mutationControl(input.audit),
      })
      setAuditLinks(input.audit, result)
      input.audit.recorded = true
      return fixtureOutput(result)
    }
    case "list_work_items": {
      const result = await input
        .getApi()
        .listWorkItems(intent.companyId, intent.status)
      await recordAudit(input.getApi, input.audit, "executed", true)
      return result
    }
    case "inspect_work_item": {
      const detail = await input
        .getApi()
        .getWorkItem(intent.companyId, intent.itemId)
      setAuditLinks(input.audit, detail)
      await recordAudit(input.getApi, input.audit, "executed", true)
      return workItemOutput(detail)
    }
    case "record_decision":
      return executeResolvedDecision(
        intent,
        input,
        config.selectedCompany.name,
        options
      )
    case "execute_mock_action":
      return executeResolvedMockAction(
        intent,
        input,
        config.selectedCompany.name
      )
  }
}

async function executeResolvedDecision(
  intent: Extract<ControlIntent, { kind: "record_decision" }>,
  input: Parameters<typeof executeCommand>[0],
  companyName: string,
  options: { executeAfterDecision?: boolean }
): Promise<unknown> {
  const [detail, review] = await Promise.all([
    input.getApi().getWorkItem(intent.companyId, intent.itemId),
    input.getApi().getWorkItemReview(intent.companyId, intent.itemId),
  ])
  setAuditLinks(input.audit, detail)
  const warnings = collectWarnings(detail)
  const current = await requireResolved(
    resolveControlIntent(candidateFromIntent(intent), {
      companyId: intent.companyId,
      warningsPresent: warnings.length > 0,
      warningsAcknowledged: intent.warningsAcknowledged,
    }),
    input
  )
  if (current.kind !== "record_decision")
    throw new CliError("invalid_intent", "Expected a decision intent.")
  if (current.decision !== "resolve" && !detail.draft)
    throw new CliError(
      "draft_not_found",
      "The selected work item has no reviewable action draft."
    )

  const editedPayload =
    current.decision === "edit"
      ? jsonObjectSchema.parse(
          applyJsonPointerAssignments(
            detail.draft?.payload ?? {},
            current.patches ?? []
          )
        )
      : undefined
  const confirmed = await input.confirm({
    intent: current,
    companyName,
    item: detail.item,
    warnings,
    changes: current.patches,
    actionType: detail.draft?.actionType,
    draft: detail.draft
      ? {
          ...detail.draft,
          payload: editedPayload ?? detail.draft.payload,
        }
      : undefined,
  })
  if (!confirmed) throw commandCancelled()

  const result = await input.getApi().recordDecision({
    companyId: current.companyId,
    workItemId: current.itemId,
    ...(detail.draft ? { actionDraftId: detail.draft.id } : {}),
    decision: current.decision,
    expectedVersion: review.version,
    idempotencyKey: `cli:${randomUUID()}`,
    reason: current.reason,
    warningsAcknowledged: current.warningsAcknowledged,
    editedPayload,
    control: mutationControl(input.audit),
  })
  setAuditLinks(input.audit, result, detail)
  input.audit.recorded = true
  if (!options.executeAfterDecision) return decisionOutput(result)
  const executionToken = result.executionToken
  if (!executionToken)
    throw new CliError(
      "execution_token_missing",
      "The approved decision did not return an execution capability."
    )
  if (!result.draft || !detail.draft)
    throw new CliError(
      "draft_not_found",
      "The approved decision did not return an action draft."
    )

  const executionIntent: ControlIntent = {
    kind: "execute_mock_action",
    companyId: current.companyId,
    itemId: current.itemId,
    risk: "mock_execution",
  }
  const approvedPayload = jsonObjectSchema.parse(
    editedPayload ?? detail.draft.payload
  )
  const executeConfirmed = await input.confirm({
    intent: executionIntent,
    companyName,
    item: { ...detail.item, status: result.item.status },
    actionType: detail.draft.actionType,
    draft: {
      ...detail.draft,
      status: result.draft.status,
      payload: approvedPayload,
    },
  })
  if (!executeConfirmed) {
    executionToken.rawToken = ""
    return {
      decision: decisionOutput(result),
      execution: { status: "cancelled" },
    }
  }

  input.audit.intent = executionIntent
  input.audit.risk = executionIntent.risk
  input.audit.recorded = false
  return executeWithCapability({
    companyId: current.companyId,
    actionDraftId: result.draft.id,
    decisionId: result.decision.id,
    rawToken: executionToken.rawToken,
    payload: approvedPayload,
    input,
    onComplete: () => {
      executionToken.rawToken = ""
    },
  }).then((execution) => ({
    decision: decisionOutput(result),
    execution: executionOutput(execution),
  }))
}

async function executeResolvedMockAction(
  intent: Extract<ControlIntent, { kind: "execute_mock_action" }>,
  input: Parameters<typeof executeCommand>[0],
  companyName: string
): Promise<unknown> {
  const detail = await input
    .getApi()
    .getWorkItem(intent.companyId, intent.itemId)
  setAuditLinks(input.audit, detail)
  if (!detail.draft)
    throw new CliError(
      "draft_not_found",
      "The selected work item has no action draft."
    )
  if (detail.draft.status !== "approved")
    throw new CliError(
      "invalid_state",
      "Only an approved, unexecuted draft can run in mock mode."
    )
  const confirmed = await input.confirm({
    intent,
    companyName,
    item: detail.item,
    actionType: detail.draft.actionType,
    draft: detail.draft,
  })
  if (!confirmed) throw commandCancelled()
  const capability = await input.getApi().issueExecutionToken({
    companyId: intent.companyId,
    actionDraftId: detail.draft.id,
  })
  const result = await executeWithCapability({
    companyId: intent.companyId,
    actionDraftId: detail.draft.id,
    decisionId: capability.decisionId,
    rawToken: capability.executionToken.rawToken,
    payload: detail.draft.payload,
    input,
  })
  setAuditLinks(input.audit, result, detail)
  return executionOutput(result)
}

async function executeWithCapability(input: {
  companyId: string
  actionDraftId: string
  decisionId: string
  rawToken: string
  payload: Record<string, JsonValue>
  input: Parameters<typeof executeCommand>[0]
  onComplete?: () => void
}) {
  let rawToken = input.rawToken
  try {
    const result = await input.input.getApi().execute({
      companyId: input.companyId,
      actionDraftId: input.actionDraftId,
      decisionId: input.decisionId,
      rawToken,
      idempotencyKey: `cli:${randomUUID()}`,
      payload: input.payload,
      control: mutationControl(input.input.audit),
    })
    input.input.audit.recorded = true
    return result
  } finally {
    rawToken = ""
    input.onComplete?.()
  }
}

function candidateFromIntent(intent: ControlIntent): ControlIntentCandidate {
  switch (intent.kind) {
    case "run_fixture":
      return createControlIntentCandidate({
        kind: intent.kind,
        scenarioId: intent.scenarioId,
      })
    case "list_work_items":
      return createControlIntentCandidate({
        kind: intent.kind,
        status: intent.status,
      })
    case "inspect_work_item":
    case "execute_mock_action":
      return createControlIntentCandidate({
        kind: intent.kind,
        itemId: intent.itemId,
      })
    case "record_decision":
      return createControlIntentCandidate({
        kind: intent.kind,
        itemId: intent.itemId,
        decision: intent.decision,
        patches: intent.patches,
        reason: intent.reason,
      })
  }
}

function commandCancelled(): CliError {
  return new CliError(
    "command_cancelled",
    "Command cancelled without changing workflow state."
  )
}

function hashInput(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

async function readSingleLine(input: Readable): Promise<string> {
  const lines = createInterface({ input, crlfDelay: Infinity })
  try {
    for await (const line of lines) return line
    return ""
  } finally {
    lines.close()
  }
}

async function requireCompany(store: SecureStore, audit: AuditState) {
  const [config, session] = await Promise.all([
    store.readConfig(),
    store.readSession(),
  ])
  if (!session)
    throw new CliError(
      "unauthorized",
      "Sign in with 'mandala auth login' first."
    )
  if (!config.selectedCompany)
    throw new CliError(
      "company_required",
      "Select a company with 'mandala company use'."
    )
  audit.companyId = config.selectedCompany.id
  return { ...config, selectedCompany: config.selectedCompany }
}

async function requireResolved(
  outcome: ControlOutcome,
  input: Parameters<typeof executeCommand>[0]
): Promise<ControlIntent> {
  if (outcome.status === "resolved") {
    input.audit.intent = outcome.intent
    input.audit.risk = outcome.intent.risk
    return outcome.intent
  }

  if (input.audit.companyId)
    await recordAudit(input.getApi, input.audit, outcome.status, false)
  const error = new CliError(
    outcome.status === "blocked" ? "intent_blocked" : "clarification_required",
    outcome.status === "blocked"
      ? outcome.reasons.join(" ")
      : outcome.questions.join(" ")
  )
  error.auditRecorded = input.audit.recorded
  throw error
}

async function recordAudit(
  getApi: () => ControlApi,
  state: AuditState,
  resolutionStatus: ControlRequestCreateRequest["resolutionStatus"],
  required: boolean
): Promise<void> {
  if (!state.companyId || state.recorded) return
  state.recorded = true
  if (state.controlRequestId) {
    if (resolutionStatus === "resolved") {
      state.recorded = false
      return
    }
    const terminalStatus: ControlRequestTransitionRequest["resolutionStatus"] =
      resolutionStatus === "clarification_required"
        ? "blocked"
        : resolutionStatus
    try {
      await getApi().transitionControlRequest({
        companyId: state.companyId,
        controlRequestId: state.controlRequestId,
        resolutionStatus: terminalStatus,
        ...(state.workflowRunId ? { workflowRunId: state.workflowRunId } : {}),
        ...(state.workflowItemId
          ? { workflowItemId: state.workflowItemId }
          : {}),
      })
    } catch {
      if (required)
        throw new CliError(
          "control_audit_failed",
          "The command outcome could not be recorded in the control audit."
        )
    }
    return
  }
  const request: ControlRequestCreateRequest = {
    companyId: state.companyId,
    inputHash: state.inputHash,
    normalizedIntent: state.intent
      ? projectControlIntentForAudit(state.intent)
      : {
          kind: "unresolved",
          outcome:
            resolutionStatus === "clarification_required" ||
            resolutionStatus === "blocked"
              ? resolutionStatus
              : "failed",
        },
    parserKind: state.parserKind,
    resolutionStatus,
    riskClass: state.risk,
    ...(state.workflowRunId ? { workflowRunId: state.workflowRunId } : {}),
    ...(state.workflowItemId ? { workflowItemId: state.workflowItemId } : {}),
  }
  try {
    await getApi().recordControlRequest(request)
  } catch {
    if (required)
      throw new CliError(
        "control_audit_failed",
        "The command outcome could not be recorded in the control audit."
      )
  }
}

function mutationControl(state: AuditState) {
  return {
    inputHash: state.inputHash,
    ...(state.controlRequestId
      ? { controlRequestId: state.controlRequestId }
      : {}),
  }
}

function setAuditLinks(
  state: AuditState,
  value: unknown,
  fallback?: WorkItemDetail
): void {
  const record = asRecord(value)
  const item = asRecord(record?.item)
  const run = asRecord(record?.workflowRun)
  const fallbackItem = fallback?.item
  const duplicateRun = record?.duplicate === true && run?.id
  state.workflowItemId = duplicateRun
    ? undefined
    : firstUuid(
        item?.id,
        record?.itemId,
        fallbackItem?.id,
        state.workflowItemId
      )
  state.workflowRunId = firstUuid(
    run?.id,
    item?.workflow_run_id,
    item?.workflowRunId,
    fallbackItem?.workflowRunId,
    state.workflowRunId
  )
}

function collectWarnings(detail: WorkItemDetail): string[] {
  const sources = [detail.contextPacket, detail.recommendation, detail.evidence]
  const warnings = sources.flatMap((source) => {
    const value = source?.warnings
    return Array.isArray(value)
      ? value.filter((entry): entry is string => typeof entry === "string")
      : []
  })
  return [...new Set(warnings)]
}

function workItemOutput(detail: WorkItemDetail): unknown {
  return detail
}

function fixtureOutput(result: unknown): unknown {
  const source = asRecord(result)
  if (!source) return {}
  const duplicate = source.duplicate === true
  const workflowRun = asRecord(source.workflowRun)
  const event = asRecord(source.event)
  const item = asRecord(source.item)
  const recommendation = asRecord(source.recommendation)
  const draft = asRecord(source.draft)
  return {
    duplicate,
    workflowRun: workflowRun
      ? {
          id: workflowRun.id,
          status: workflowRun.status,
          workflowType:
            workflowRun.workflowType ?? workflowRun.workflow_type ?? null,
          startedAt: workflowRun.startedAt ?? workflowRun.started_at ?? null,
          completedAt:
            workflowRun.completedAt ?? workflowRun.completed_at ?? null,
        }
      : null,
    eventId: firstUuid(source.eventId, asRecord(source.event)?.id) ?? null,
    validation: fixtureValidationOutput(event),
    item:
      !duplicate && item
        ? {
            id: item.id,
            status: item.status,
            title: item.title,
            itemType: item.itemType ?? item.item_type ?? null,
          }
        : null,
    itemId: duplicate ? null : (firstUuid(source.itemId, item?.id) ?? null),
    recommendation:
      !duplicate && recommendation
        ? {
            id: recommendation.id,
            status: recommendation.status,
            warningState:
              recommendation.warningState ??
              recommendation.warning_state ??
              null,
            confidence: recommendation.confidence ?? null,
          }
        : null,
    draft:
      !duplicate && draft
        ? {
            id: draft.id,
            actionType: draft.actionType ?? draft.action_type ?? null,
            status: draft.status,
          }
        : null,
  }
}

function fixtureValidationOutput(
  event: Record<string, unknown> | undefined
): unknown {
  const raw = event?.validationResult ?? event?.validation_result
  if (raw === undefined) return null
  try {
    const validation = normalizeValidationResult(raw)
    return {
      status: validation.status,
      suppressRecommendation: validation.suppressRecommendation,
      issues: validation.issues.map(({ code, message, kind }) => ({
        code,
        message,
        kind,
      })),
    }
  } catch {
    return null
  }
}

function decisionOutput(result: unknown): unknown {
  const source = asRecord(result)
  const decision = asRecord(source?.decision)
  const draft = asRecord(source?.draft)
  const item = asRecord(source?.item)
  return {
    decision: decision
      ? {
          id: decision.id,
          kind: decision.decision,
          warningsAcknowledged:
            decision.warningsAcknowledged ??
            decision.warnings_acknowledged ??
            false,
        }
      : null,
    draft: draft
      ? {
          id: draft.id,
          status: draft.status,
          actionType: draft.actionType ?? draft.action_type ?? null,
        }
      : null,
    item: item ? { id: item.id, status: item.status } : null,
    executionCapabilityIssued: source?.executionToken != null,
  }
}

function executionOutput(result: unknown): unknown {
  const source = asRecord(result)
  const attempt = asRecord(source?.attempt)
  const draft = asRecord(source?.draft)
  const item = asRecord(source?.item)
  return {
    attempt: attempt
      ? {
          id: attempt.id,
          status: attempt.status,
          mode: attempt.mode ?? "mock",
          actionType: attempt.actionType ?? attempt.action_type ?? null,
          mockExternalId:
            attempt.mockExternalId ?? attempt.mock_external_id ?? null,
        }
      : null,
    draft: draft ? { id: draft.id, status: draft.status } : null,
    item: item ? { id: item.id, status: item.status } : null,
    duplicate: source?.duplicate === true,
  }
}

function decisionFromCommand(
  action: "approve" | "edit" | "reject" | "resolve" | "rework" | "decide",
  values: Record<string, unknown>
): DecisionKind | undefined {
  if (action !== "decide") {
    if (
      ["approve", "edit", "reject", "resolve", "rework"].some(
        (flag) => values[flag] === true
      )
    ) {
      throw new CliError(
        "invalid_arguments",
        "Decision flags are only used with 'mandala work decide'."
      )
    }
    return action === "rework" ? "request_rework" : action
  }

  const selected = ["approve", "edit", "reject", "resolve", "rework"].filter(
    (flag) => values[flag] === true
  )
  if (selected.length !== 1) {
    throw new CliError(
      "clarification_required",
      "Choose exactly one of --approve, --edit, --reject, --resolve, or --rework."
    )
  }
  const decision = selected[0]
  return decision === "rework" ? "request_rework" : (decision as DecisionKind)
}

function parsePatches(value: unknown): JsonPointerPatch[] | undefined {
  if (value === undefined) return undefined
  const assignments = Array.isArray(value) ? value : [value]
  try {
    return assignments.map((assignment) => {
      if (typeof assignment !== "string")
        throw new CliError(
          "invalid_edit",
          "--set requires a JSON Pointer assignment."
        )
      return parseJsonPointerAssignment(assignment)
    })
  } catch (error) {
    if (error instanceof CliError) throw error
    throw new CliError(
      "clarification_required",
      error instanceof Error ? error.message : "The edit assignment is invalid."
    )
  }
}

function parseOptions(
  args: string[],
  options: Record<string, { type: "boolean" | "string"; multiple?: boolean }>
): { values: Record<string, unknown>; positionals: string[] } {
  try {
    const result = parseArgs({
      args,
      options,
      allowPositionals: true,
      strict: true,
    } as Parameters<typeof parseArgs>[0])
    return { values: result.values, positionals: result.positionals }
  } catch {
    throw new CliError(
      "invalid_arguments",
      "The command contains an unknown, missing, or invalid option."
    )
  }
}

function stringOption(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

function requireNoArguments(args: string[], usage: string): void {
  if (args.length) throw new CliError("invalid_arguments", `Use: ${usage}.`)
}

function inputMessage(
  input: Parameters<typeof executeCommand>[0],
  message: string
): void {
  input.stderr.write(`${message}\n`)
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function firstUuid(...values: unknown[]): string | undefined {
  return values.find(
    (value): value is string =>
      typeof value === "string" && uuidSchema.safeParse(value).success
  )
}

export const usageText = `mandala [command]

Interactive session
  mandala
  Use /help after launch to see session commands.

Authentication
  mandala auth login
  mandala auth login --local --email <address>
  mandala auth status
  mandala auth logout

Status
  mandala status

Context
  mandala context
  mandala context status
  mandala context set <off|supermemory> --expected-version <n> --reason <text> [--confirm]
  mandala company list
  mandala company use <company-id>
  mandala company current

Real-data Sandbox
  mandala sandbox status
  mandala sandbox set <on|off> --expected-version <n> --reason <text> [--confirm]
  mandala sandbox open [--limit <1-100>]
  mandala sandbox run --skill <SKILL.md> --confirm-mappings

Agents
  mandala agents run <agent-id> --reason <text> --confirm

Workflows
  mandala workflow fixture list
  mandala workflow fixture run <scenario-id>
  mandala work list [--status <status>]
  mandala work inspect <item-id>
  mandala work show <item-id>
  mandala work ask <item-id> --question <question>
  mandala work approve <item-id> [--ack-warnings]
  mandala work edit <item-id> --set <pointer=value> --reason <reason> [--ack-warnings]
  mandala work reject <item-id> --reason <reason>
  mandala work resolve <item-id>
  mandala work rework <item-id> --reason <reason>
  mandala work decide <item-id> --approve|--edit|--reject|--resolve|--rework
  mandala work execute <item-id>
  mandala parse <bounded phrase>
  mandala chat [bounded phrase]

Global options
  --json    Emit a stable JSON envelope

Add --execute to approve/edit to confirm and consume the returned capability immediately.
Mutating workflow commands always require interactive confirmation.`
