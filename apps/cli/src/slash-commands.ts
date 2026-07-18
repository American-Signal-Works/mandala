export const actionableWorkItemStatuses = [
  "active",
  "blocked",
  "approved",
] as const

export type SlashCommandName =
  | "/"
  | "/login"
  | "/auth-status"
  | "/logout"
  | "/workspace"
  | "/companies"
  | "/company"
  | "/agents"
  | "/agent-list"
  | "/agent-show"
  | "/agent-validate"
  | "/agent-install"
  | "/agent-test"
  | "/agent-activate"
  | "/agent-deactivate"
  | "/agent-pause"
  | "/agent-resume"
  | "/agent-disable"
  | "/agent-versions"
  | "/agent-rollback"
  | "/inbox"
  | "/purchase-requests"
  | "/settings"
  | "/sandbox"
  | "/fixtures"
  | "/run-fixture"
  | "/open"
  | "/refresh"
  | "/recommendation"
  | "/evidence"
  | "/draft"
  | "/history"
  | "/detail"
  | "/approve"
  | "/reject"
  | "/deny"
  | "/resolve"
  | "/rework"
  | "/edit"
  | "/execute"
  | "/unselect"
  | "/context"
  | "/clear"
  | "/help"
  | "/exit"
  | "/quit"

export type SlashCommandKind =
  | "auth"
  | "company"
  | "agent"
  | "view"
  | "settings"
  | "sandbox"
  | "fixture"
  | "selection"
  | "detail"
  | "mutation"
  | "local"

export type SlashArgumentMode = "none" | "required"
export type SlashAvailability =
  | "always"
  | "selection"
  | "decision-selection"
  | "approved-selection"

export type SlashCommandGroup =
  | "Account"
  | "Inbox"
  | "Agents"
  | "Workspace settings"
  | "Inspect selected"
  | "Decide"
  | "Sandbox"
  | "Session"

export type SlashViewDefinition = {
  backendArgs: readonly ["work", "list"]
  includedItemTypes?: readonly string[]
  includedStatuses: readonly string[]
  label: string
  renderer: "work-item-list"
}

export type SlashCommandDefinition = {
  argumentMode: SlashArgumentMode
  availability: SlashAvailability
  command: SlashCommandName
  description: string
  group: SlashCommandGroup
  kind: SlashCommandKind
  paletteVisible: boolean
  usage: string
  aliasFor?: SlashCommandName
  backendAction?:
    | "login"
    | "auth-status"
    | "logout"
    | "workspace"
    | "companies"
    | "company"
    | "agents"
    | "agent-list"
    | "agent-show"
    | "agent-validate"
    | "agent-install"
    | "agent-test"
    | "agent-activate"
    | "agent-deactivate"
    | "agent-pause"
    | "agent-resume"
    | "agent-disable"
    | "agent-versions"
    | "agent-rollback"
    | "sandbox"
    | "fixtures"
    | "run-fixture"
    | "open"
    | "refresh"
    | "recommendation"
    | "evidence"
    | "draft"
    | "history"
    | "detail"
    | "approve"
    | "reject"
    | "resolve"
    | "rework"
    | "edit"
    | "execute"
  view?: SlashViewDefinition
}

export const slashCommands = [
  command("/", "local", "Open the command palette", "/", {
    paletteVisible: false,
  }),
  command("/login", "auth", "Sign in through your browser", "/login", {
    backendAction: "login",
  }),
  command(
    "/auth-status",
    "auth",
    "Show the current authentication status",
    "/auth-status",
    { backendAction: "auth-status" }
  ),
  command("/logout", "auth", "Sign out and clear context", "/logout", {
    backendAction: "logout",
  }),
  command(
    "/workspace",
    "company",
    "Choose an authorized workspace",
    "/workspace",
    { backendAction: "workspace" }
  ),
  command("/companies", "company", "List authorized workspaces", "/companies", {
    backendAction: "companies",
    paletteVisible: false,
  }),
  command(
    "/company",
    "company",
    "Switch to an authorized workspace",
    "/company <row-or-id>",
    {
      argumentMode: "required",
      backendAction: "company",
      paletteVisible: false,
    }
  ),
  command(
    "/agents",
    "agent",
    "Manage the agents in this workspace",
    "/agents",
    { backendAction: "agents" }
  ),
  command(
    "/agent-list",
    "agent",
    "List workspace agents without opening a menu",
    "/agent-list",
    { backendAction: "agent-list", paletteVisible: false }
  ),
  command("/agent-show", "agent", "Show one agent", "/agent-show <row-or-id>", {
    argumentMode: "required",
    backendAction: "agent-show",
    paletteVisible: false,
  }),
  command(
    "/agent-validate",
    "agent",
    "Validate an agent skill file",
    "/agent-validate <skill-file>",
    {
      argumentMode: "required",
      backendAction: "agent-validate",
      paletteVisible: false,
    }
  ),
  command(
    "/agent-install",
    "agent",
    "Validate and install an inactive agent skill",
    "/agent-install <skill-file>",
    {
      argumentMode: "required",
      backendAction: "agent-install",
      paletteVisible: false,
    }
  ),
  command(
    "/agent-test",
    "agent",
    "Run an agent safely in Sandbox",
    "/agent-test <row-or-id>",
    {
      argumentMode: "required",
      backendAction: "agent-test",
      paletteVisible: false,
    }
  ),
  command(
    "/agent-activate",
    "agent",
    "Make an agent available for new work",
    "/agent-activate <row-or-id>",
    {
      argumentMode: "required",
      backendAction: "agent-activate",
      paletteVisible: false,
    }
  ),
  command(
    "/agent-deactivate",
    "agent",
    "Stop an agent from starting new work",
    "/agent-deactivate <row-or-id>",
    {
      argumentMode: "required",
      backendAction: "agent-deactivate",
      paletteVisible: false,
    }
  ),
  command(
    "/agent-pause",
    "agent",
    "Pause new work while keeping the agent available to resume",
    "/agent-pause <row-or-id>",
    {
      argumentMode: "required",
      backendAction: "agent-pause",
      paletteVisible: false,
    }
  ),
  command(
    "/agent-resume",
    "agent",
    "Run a fresh Sandbox readiness check and resume a paused agent",
    "/agent-resume <row-or-id>",
    {
      argumentMode: "required",
      backendAction: "agent-resume",
      paletteVisible: false,
    }
  ),
  command(
    "/agent-disable",
    "agent",
    "Disable an agent until a deliberate later change",
    "/agent-disable <row-or-id>",
    {
      argumentMode: "required",
      backendAction: "agent-disable",
      paletteVisible: false,
    }
  ),
  command(
    "/agent-versions",
    "agent",
    "List installed versions of an agent",
    "/agent-versions <row-or-id>",
    {
      argumentMode: "required",
      backendAction: "agent-versions",
      paletteVisible: false,
    }
  ),
  command(
    "/agent-rollback",
    "agent",
    "Restore an earlier installed agent version",
    "/agent-rollback <row-or-id> <version>",
    {
      argumentMode: "required",
      backendAction: "agent-rollback",
      paletteVisible: false,
    }
  ),
  command("/inbox", "view", "Show actionable work", "/inbox", {
    view: {
      backendArgs: ["work", "list"],
      includedStatuses: actionableWorkItemStatuses,
      label: "Inbox",
      renderer: "work-item-list",
    },
  }),
  command(
    "/purchase-requests",
    "view",
    "Show actionable purchase requests",
    "/purchase-requests",
    {
      view: {
        backendArgs: ["work", "list"],
        includedItemTypes: ["procurement_reorder_review"],
        includedStatuses: actionableWorkItemStatuses,
        label: "Purchase Requests",
        renderer: "work-item-list",
      },
    }
  ),
  command(
    "/settings",
    "settings",
    "Manage Context and Sandbox safety settings",
    "/settings"
  ),
  command(
    "/sandbox",
    "sandbox",
    "Open a temporary session on real workspace data",
    "/sandbox",
    { backendAction: "sandbox" }
  ),
  command("/fixtures", "fixture", "List sandbox fixtures", "/fixtures", {
    backendAction: "fixtures",
  }),
  command(
    "/run-fixture",
    "fixture",
    "Run a sandbox fixture",
    "/run-fixture <row-or-id>",
    { argumentMode: "required", backendAction: "run-fixture" }
  ),
  command(
    "/open",
    "selection",
    "Open and select a work item",
    "/open <row-or-id>",
    {
      argumentMode: "required",
      backendAction: "open",
      paletteVisible: false,
    }
  ),
  command(
    "/refresh",
    "selection",
    "Refresh selected work or inbox",
    "/refresh",
    {
      backendAction: "refresh",
    }
  ),
  command(
    "/recommendation",
    "detail",
    "Show the selected recommendation",
    "/recommendation",
    { availability: "selection", backendAction: "recommendation" }
  ),
  command(
    "/evidence",
    "detail",
    "Show evidence for the selected item",
    "/evidence",
    { availability: "selection", backendAction: "evidence" }
  ),
  command("/draft", "detail", "Show the selected action draft", "/draft", {
    availability: "selection",
    backendAction: "draft",
  }),
  command("/history", "detail", "Show the selected item history", "/history", {
    availability: "selection",
    backendAction: "history",
  }),
  command(
    "/detail",
    "detail",
    "Show complete selected-item detail",
    "/detail",
    {
      availability: "selection",
      backendAction: "detail",
    }
  ),
  command(
    "/approve",
    "mutation",
    "Approve the selected work item",
    "/approve [row-or-id] [--ack-warnings]",
    { availability: "decision-selection", backendAction: "approve" }
  ),
  command(
    "/reject",
    "mutation",
    "Reject the selected work item",
    "/reject [row-or-id] [--reason <reason>]",
    {
      availability: "decision-selection",
      backendAction: "reject",
      paletteVisible: false,
    }
  ),
  command(
    "/deny",
    "mutation",
    "Reject the selected work item",
    "/deny [row-or-id] [--reason <reason>]",
    {
      aliasFor: "/reject",
      availability: "decision-selection",
      backendAction: "reject",
    }
  ),
  command(
    "/resolve",
    "mutation",
    "Resolve the selected work item",
    "/resolve [row-or-id]",
    {
      availability: "decision-selection",
      backendAction: "resolve",
      paletteVisible: false,
    }
  ),
  command(
    "/rework",
    "mutation",
    "Return the selected work item for rework",
    "/rework [row-or-id] [--reason <reason>]",
    { availability: "decision-selection", backendAction: "rework" }
  ),
  command(
    "/edit",
    "mutation",
    "Edit and approve the selected draft",
    "/edit [row-or-id] [--set <pointer=value>] [--reason <reason>]",
    { availability: "decision-selection", backendAction: "edit" }
  ),
  command(
    "/execute",
    "mutation",
    "Execute the selected approved draft in mock mode",
    "/execute [row-or-id]",
    { availability: "approved-selection", backendAction: "execute" }
  ),
  command("/unselect", "local", "Clear the selected work item", "/unselect", {
    availability: "selection",
  }),
  command("/context", "local", "Show verified session context", "/context"),
  command(
    "/clear",
    "local",
    "Clear the terminal and redraw the header",
    "/clear"
  ),
  command("/help", "local", "Show available commands", "/help"),
  command("/exit", "local", "Exit the session", "/exit", {
    paletteVisible: false,
  }),
  command("/quit", "local", "Exit the session", "/quit", {
    aliasFor: "/exit",
  }),
] as const satisfies readonly SlashCommandDefinition[]

export const paletteSlashCommands = slashCommands.filter(
  ({ paletteVisible }) => paletteVisible
)

const registry = new Map<SlashCommandName, SlashCommandDefinition>(
  slashCommands.map((definition) => [definition.command, definition])
)

export type ParsedSlashCommand = {
  args: string[]
  definition: SlashCommandDefinition
}

export type SlashParseResult =
  | { ok: true; value: ParsedSlashCommand }
  | {
      ok: false
      code: "invalid_slash_command" | "unknown_slash_command"
      message: string
    }

export function getSlashCommand(
  name: string
): SlashCommandDefinition | undefined {
  return registry.get(name as SlashCommandName)
}

export function isSlashCommandAvailable(
  definition: SlashCommandDefinition,
  selectedStatus?: string
): boolean {
  switch (definition.availability) {
    case "selection":
      return selectedStatus !== undefined
    case "decision-selection":
      return selectedStatus === "active" || selectedStatus === "blocked"
    case "approved-selection":
      return selectedStatus === "approved"
    default:
      return true
  }
}

export function parseSlashCommand(line: string): SlashParseResult {
  const tokenized = tokenize(line.trim())
  if (!tokenized.ok) return tokenized
  const [name, ...args] = tokenized.tokens
  const definition = name ? getSlashCommand(name) : undefined
  if (!definition) {
    const suggestion = suggestSlashCommands(name ?? "", paletteSlashCommands)[0]
    return {
      ok: false,
      code: "unknown_slash_command",
      message: suggestion
        ? `Unknown slash command. Did you mean ${suggestion.command}? Type / to browse available commands.`
        : "Unknown slash command. Type / to browse available commands.",
    }
  }
  return { ok: true, value: { args, definition } }
}

export function suggestSlashCommands(
  input: string,
  definitions: readonly SlashCommandDefinition[] = paletteSlashCommands
): SlashCommandDefinition[] {
  const query = input.replace(/^\//, "").trim().toLowerCase()
  if (!query) return [...definitions]
  const direct = definitions.filter(({ command, description }) => {
    return (
      command.slice(1).toLowerCase().includes(query) ||
      description.toLowerCase().includes(query)
    )
  })
  if (direct.length > 0) return direct
  if (query.length < 3) return []
  const threshold = query.length > 7 ? 3 : 2
  return definitions
    .map((definition) => ({
      definition,
      distance: editDistance(query, definition.command.slice(1).toLowerCase()),
    }))
    .filter(({ distance }) => distance <= threshold)
    .sort((left, right) => left.distance - right.distance)
    .map(({ definition }) => definition)
}

export function completeSlashCommand(line: string): [string[], string] {
  const match = /^\s*(\/[^\s]*)$/.exec(line)
  if (!match) return [[], line]
  const prefix = match[1] ?? ""
  const matches = slashCommands
    .map((definition) => definition.command)
    .filter((name) => name.startsWith(prefix))
  return [matches, prefix]
}

function command(
  commandName: SlashCommandName,
  kind: SlashCommandKind,
  description: string,
  usage: string,
  extra: Partial<
    Pick<
      SlashCommandDefinition,
      | "aliasFor"
      | "argumentMode"
      | "availability"
      | "backendAction"
      | "paletteVisible"
      | "view"
    >
  > = {}
): SlashCommandDefinition {
  return {
    argumentMode: "none",
    availability: "always",
    command: commandName,
    description,
    group: groupForKind(kind),
    kind,
    paletteVisible: true,
    usage,
    ...extra,
  }
}

function editDistance(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index)
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex]
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        (current[rightIndex - 1] ?? 0) + 1,
        (previous[rightIndex] ?? 0) + 1,
        (previous[rightIndex - 1] ?? 0) +
          (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1)
      )
    }
    previous.splice(0, previous.length, ...current)
  }
  return previous[right.length] ?? Math.max(left.length, right.length)
}

function groupForKind(kind: SlashCommandKind): SlashCommandGroup {
  switch (kind) {
    case "auth":
    case "company":
      return "Account"
    case "agent":
      return "Agents"
    case "view":
    case "selection":
      return "Inbox"
    case "detail":
      return "Inspect selected"
    case "mutation":
      return "Decide"
    case "fixture":
    case "sandbox":
      return "Sandbox"
    case "settings":
      return "Workspace settings"
    case "local":
      return "Session"
  }
}

function tokenize(
  value: string
):
  | { ok: true; tokens: string[] }
  | { ok: false; code: "invalid_slash_command"; message: string } {
  const tokens: string[] = []
  let current = ""
  let quote: "'" | '"' | undefined
  let escaped = false

  const push = () => {
    if (!current) return
    tokens.push(current)
    current = ""
  }

  const characters = [...value]
  for (let index = 0; index < characters.length; index += 1) {
    const character = characters[index] ?? ""
    if (escaped) {
      current += character
      escaped = false
      continue
    }
    if (character === "\\") {
      const next = characters[index + 1]
      if (
        next !== undefined &&
        (next === "\\" || next === '"' || next === "'" || /\s/.test(next))
      ) {
        escaped = true
      } else {
        current += character
      }
      continue
    }
    if (quote) {
      if (character === quote) quote = undefined
      else current += character
      continue
    }
    if (character === "'" || character === '"') {
      quote = character
      continue
    }
    if (/\s/.test(character)) push()
    else current += character
  }

  if (escaped || quote) {
    return {
      ok: false,
      code: "invalid_slash_command",
      message: "The slash command contains an incomplete quote or escape.",
    }
  }
  push()
  return { ok: true, tokens }
}
