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
  | "/companies"
  | "/company"
  | "/inbox"
  | "/purchase-requests"
  | "/fixtures"
  | "/run-fixture"
  | "/open"
  | "/refresh"
  | "/recommendation"
  | "/evidence"
  | "/draft"
  | "/history"
  | "/approve"
  | "/reject"
  | "/deny"
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
  | "view"
  | "fixture"
  | "selection"
  | "detail"
  | "mutation"
  | "local"

export type SlashArgumentMode = "none" | "required"
export type SlashAvailability = "always" | "selection" | "approved-selection"

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
  kind: SlashCommandKind
  paletteVisible: boolean
  usage: string
  aliasFor?: SlashCommandName
  backendAction?:
    | "login"
    | "auth-status"
    | "logout"
    | "companies"
    | "company"
    | "fixtures"
    | "run-fixture"
    | "open"
    | "refresh"
    | "recommendation"
    | "evidence"
    | "draft"
    | "history"
    | "approve"
    | "reject"
    | "rework"
    | "edit"
    | "execute"
  view?: SlashViewDefinition
}

export const slashCommands = [
  command("/", "local", "Show available commands", "/", {
    paletteVisible: false,
  }),
  command("/login", "auth", "Sign in with a magic link", "/login [email]", {
    argumentMode: "required",
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
  command("/companies", "company", "List authorized companies", "/companies", {
    backendAction: "companies",
  }),
  command(
    "/company",
    "company",
    "Switch to an authorized company",
    "/company <row-or-id>",
    { argumentMode: "required", backendAction: "company" }
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
    "/approve",
    "mutation",
    "Approve the selected work item",
    "/approve [row-or-id] [--ack-warnings]",
    { availability: "selection", backendAction: "approve" }
  ),
  command(
    "/reject",
    "mutation",
    "Reject the selected work item",
    "/reject [row-or-id] [--reason <reason>]",
    {
      availability: "selection",
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
      availability: "selection",
      backendAction: "reject",
    }
  ),
  command(
    "/rework",
    "mutation",
    "Return the selected work item for rework",
    "/rework [row-or-id] [--reason <reason>]",
    { availability: "selection", backendAction: "rework" }
  ),
  command(
    "/edit",
    "mutation",
    "Edit and approve the selected draft",
    "/edit [row-or-id] [--set <pointer=value>] [--reason <reason>]",
    { availability: "selection", backendAction: "edit" }
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

export function parseSlashCommand(line: string): SlashParseResult {
  const tokenized = tokenize(line.trim())
  if (!tokenized.ok) return tokenized
  const [name, ...args] = tokenized.tokens
  const definition = name ? getSlashCommand(name) : undefined
  if (!definition) {
    return {
      ok: false,
      code: "unknown_slash_command",
      message: "Unknown slash command. Use /help to see available commands.",
    }
  }
  return { ok: true, value: { args, definition } }
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
    kind,
    paletteVisible: true,
    usage,
    ...extra,
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

  for (const character of value) {
    if (escaped) {
      current += character
      escaped = false
      continue
    }
    if (character === "\\") {
      escaped = true
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
