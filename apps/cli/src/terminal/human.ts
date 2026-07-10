import { styleText } from "node:util"
import { redactSecrets } from "../output.js"
import { sanitizeTerminalText } from "./sanitize.js"
import {
  formatScalarValue,
  isRecord,
  isScalar,
  normalizeTerminalWidth,
  renderAsciiTable,
  renderStructuredSection,
  wrapTerminalText,
} from "./table.js"

const WORK_ITEM_DETAIL_SECTIONS = [
  ["item", "Item"],
  ["contextPacket", "Context Packet"],
  ["recommendation", "Recommendation"],
  ["evidence", "Evidence"],
  ["draft", "Draft"],
  ["decision", "Decision"],
  ["attempt", "Attempt"],
  ["auditEvents", "Audit Events"],
] as const

const WORK_LIST_PRIMARY_FIELDS = ["id", "status", "title"] as const
const WORK_LIST_WIDE_FIELDS = ["priority", "warningCount"] as const

// Compact quadrant-block raster generated from the supplied 65x65 Mandala mark.
const TERMINAL_LOGO = [
  " ▗▖   ▐▌   ▗▖",
  " ▝▜▌▐▙▟▙▟▌▜▛▘",
  "  ▐▙▖▝▘▝▘▄▟▌",
  "▐▌▐█▌ ▜▌ ▐█▌▜▌",
  "  ▐▛▘▗▖▗▖▝▜▌",
  " ▗▟▌▜▛▜▛▜▌▐▙▖",
  " ▝▘   ▐▌   ▝▘",
] as const

export type HumanResultKind = "auto" | "generic" | "work-list" | "work-detail"

export type HumanRenderOptions = {
  width?: number
  color?: boolean
  title?: string
  kind?: HumanResultKind
}

export type TerminalHeaderContext = {
  companyName?: string | null
  inboxCount?: number | null
  mode?: string | null
  userEmail?: string | null
  warningCount?: number | null
}

export type InboxSummaryInput =
  | readonly unknown[]
  | {
      items?: readonly unknown[]
      itemCount?: number
      warningCount?: number
      error?: unknown
    }

type InboxSummaryAggregate = Exclude<InboxSummaryInput, readonly unknown[]>

export function renderHumanResult(
  value: unknown,
  options: HumanRenderOptions | number = {}
): string {
  const resolved = resolveOptions(options)
  const width = normalizeTerminalWidth(resolved.width)
  const safeValue = redactSecrets(value)
  const kind = resolved.kind ?? "auto"

  if (
    kind === "work-detail" ||
    (kind === "auto" && isWorkItemDetail(safeValue))
  ) {
    return renderWorkItemDetail(safeValue, width)
  }
  if (kind === "work-list" || (kind === "auto" && isWorkItemList(safeValue))) {
    return renderWorkItemList(safeValue, width, resolved.title ?? "Work Items")
  }
  return renderGenericResult(safeValue, width, resolved.title ?? "Result")
}

export function renderDraftPreview(
  value: unknown,
  options: HumanRenderOptions | number = {}
): string {
  const resolved = resolveOptions(options)
  const width = normalizeTerminalWidth(resolved.width)
  const safeValue = redactSecrets(value)
  const draft = isWorkItemDetail(safeValue) ? safeValue.draft : safeValue
  const title = resolved.title ?? "Draft Preview"

  if (!isRecord(draft)) return renderStructuredSection(title, draft, width)

  const metadata = Object.fromEntries(
    Object.entries(draft).filter(
      ([key]) => key !== "payload" && key !== "editPolicy"
    )
  )
  const sections = [renderStructuredSection(title, metadata, width)]
  if ("payload" in draft)
    sections.push(
      renderStructuredSection("Draft Payload", draft.payload, width)
    )
  if ("editPolicy" in draft)
    sections.push(
      renderStructuredSection("Edit Policy", draft.editPolicy, width)
    )
  return sections.join("\n\n")
}

export function renderAssistantMessage(
  message: string,
  options: Pick<HumanRenderOptions, "color" | "width"> | number = {}
): string {
  const resolved = resolveOptions(options)
  const width = normalizeTerminalWidth(resolved.width)
  const safeMessage = sanitizeTerminalText(String(redactSecrets(message)))
  const label = resolved.color
    ? styleText(["bold", "cyan"], "Mandala", { validateStream: false })
    : "Mandala"
  return `${label}\n${wrapTerminalText(safeMessage, width)}`
}

export function renderHeader(
  context: TerminalHeaderContext,
  options: Pick<HumanRenderOptions, "color" | "width"> | number = {}
): string {
  const resolved = resolveOptions(options)
  const width = normalizeTerminalWidth(resolved.width)
  const safe = redactSecrets({
    companyName: context.companyName ?? null,
    inboxCount: context.inboxCount ?? null,
    mode: context.mode ?? "mock",
    userEmail: context.userEmail ?? null,
    warningCount: context.warningCount ?? null,
  }) as Record<string, unknown>
  const company = displayContextValue(safe.companyName)
  const mode = environmentLabel(displayContextValue(safe.mode))
  const user = displayContextValue(safe.userEmail)
  const inbox = inboxLabel(safe.inboxCount, safe.warningCount, user)
  const details = ["Mandala", `${company} · ${mode}`, user, inbox]
  const logoWidth = Math.max(...TERMINAL_LOGO.map((line) => line.length))
  const detailOffset = logoWidth + 3
  const renderDetail = (detail: string, index: number, maxWidth: number) => {
    const wrapped = wrapTerminalText(detail, maxWidth)
    if (!resolved.color) return wrapped
    return styleText(index === 0 ? ["bold", "cyan"] : "dim", wrapped, {
      validateStream: false,
    })
  }

  if (width < 48) {
    return [
      ...TERMINAL_LOGO,
      "",
      ...details.map((detail, index) => renderDetail(detail, index, width)),
    ].join("\n")
  }
  const detailWidth = Math.max(1, width - detailOffset)
  return TERMINAL_LOGO.map((line, index) => {
    const detail = details[index]
    if (!detail) return line
    return `${line.padEnd(detailOffset)}${renderDetail(detail, index, detailWidth)}`
  }).join("\n")
}

export function renderInboxSummary(
  input: InboxSummaryInput,
  options: Pick<HumanRenderOptions, "width"> | number = {}
): string {
  const resolved = resolveOptions(options)
  const width = normalizeTerminalWidth(resolved.width)
  const aggregate: InboxSummaryAggregate = Array.isArray(input)
    ? { items: input }
    : (input as InboxSummaryAggregate)

  if (aggregate.error !== undefined && aggregate.error !== null) {
    const redacted = redactSecrets(String(aggregate.error))
    const message = sanitizeTerminalText(String(redacted))
    return wrapTerminalText(`Inbox unavailable: ${message}`, width)
  }

  const items = aggregate.items ?? []
  const itemCount = nonNegativeCount(aggregate.itemCount, items.length)
  const warningCount = nonNegativeCount(
    aggregate.warningCount,
    items.filter(itemHasWarnings).length
  )
  if (itemCount === 0) return "Inbox clear"

  const itemText = `${itemCount} ${itemCount === 1 ? "item needs" : "items need"} your review`
  const warningText =
    warningCount > 0
      ? ` - ${warningCount} ${warningCount === 1 ? "has" : "have"} warnings.`
      : "."
  return wrapTerminalText(`${itemText}${warningText}  /inbox`, width)
}

function renderWorkItemDetail(value: unknown, width: number): string {
  if (!isRecord(value))
    return renderStructuredSection("Work Item Detail", value, width)

  const sections = WORK_ITEM_DETAIL_SECTIONS.map(([key, title]) =>
    renderStructuredSection(title, value[key], width)
  )
  const knownKeys = new Set(WORK_ITEM_DETAIL_SECTIONS.map(([key]) => key))
  for (const [key, entry] of Object.entries(value)) {
    if (!knownKeys.has(key as (typeof WORK_ITEM_DETAIL_SECTIONS)[number][0]))
      sections.push(renderStructuredSection(key, entry, width))
  }
  return sections.join("\n\n")
}

function renderWorkItemList(
  value: unknown,
  width: number,
  title: string
): string {
  const source = isRecord(value) ? value : { items: value }
  const items = Array.isArray(source.items) ? source.items : []
  const sections: string[] = []

  if (items.length === 0) {
    sections.push(`${wrapTerminalText(title, width)}\nNo work items`)
  } else if (width < 70) {
    sections.push(wrapTerminalText(title, width))
    items.forEach((item, index) => {
      sections.push(
        renderStructuredSection(
          `Row ${index + 1}`,
          isRecord(item)
            ? { row: index + 1, ...item }
            : { row: index + 1, value: item },
          width
        )
      )
    })
  } else if (!items.every(isRecord)) {
    sections.push(renderStructuredSection(title, items, width))
  } else {
    const records = items as Record<string, unknown>[]
    const displayFields = [
      ...WORK_LIST_PRIMARY_FIELDS,
      ...(width >= 100 ? WORK_LIST_WIDE_FIELDS : []),
    ].filter((key) => records.some((record) => key in record))
    const canSummarize = displayFields.every((key) =>
      records.every((record) => isScalar(record[key]))
    )

    if (!canSummarize || displayFields.length === 0) {
      sections.push(renderStructuredSection(title, items, width))
    } else {
      const headers = ["#", ...displayFields]
      const rows = records.map((record, index) => [
        String(index + 1),
        ...displayFields.map((key) => formatScalarValue(record[key])),
      ])
      sections.push(
        `${wrapTerminalText(title, width)}\n${renderAsciiTable(headers, rows, width)}`
      )

      const displayed = new Set<string>(displayFields)
      const remaining = records.map((record) =>
        Object.fromEntries(
          Object.entries(record).filter(([key]) => !displayed.has(key))
        )
      )
      if (remaining.some((record) => Object.keys(record).length > 0))
        sections.push(
          renderStructuredSection("Work Item Fields", remaining, width)
        )
    }
  }

  const extras = Object.fromEntries(
    Object.entries(source).filter(([key]) => key !== "items")
  )
  if (Object.keys(extras).length > 0)
    sections.push(renderStructuredSection("Work List Context", extras, width))
  return sections.join("\n\n")
}

function renderGenericResult(
  value: unknown,
  width: number,
  title: string
): string {
  if (!isRecord(value)) return renderStructuredSection(title, value, width)

  const scalarEntries = Object.entries(value).filter(([, entry]) =>
    isScalar(entry)
  )
  const nestedEntries = Object.entries(value).filter(
    ([, entry]) => !isScalar(entry)
  )
  if (nestedEntries.length === 0)
    return renderStructuredSection(title, value, width)

  const sections: string[] = []
  if (scalarEntries.length > 0)
    sections.push(
      renderStructuredSection(title, Object.fromEntries(scalarEntries), width)
    )
  for (const [key, entry] of nestedEntries)
    sections.push(renderStructuredSection(key, entry, width))
  return sections.join("\n\n")
}

function isWorkItemDetail(value: unknown): value is Record<string, unknown> {
  return (
    isRecord(value) && WORK_ITEM_DETAIL_SECTIONS.every(([key]) => key in value)
  )
}

function isWorkItemList(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && Array.isArray(value.items)
}

function itemHasWarnings(item: unknown): boolean {
  if (!isRecord(item)) return false
  if (typeof item.warningCount === "number" && item.warningCount > 0)
    return true
  if (Array.isArray(item.warnings) && item.warnings.length > 0) return true
  const recommendation = isRecord(item.recommendation)
    ? item.recommendation
    : null
  return (
    recommendation?.warningState === "warn" ||
    recommendation?.warningState === "blocked"
  )
}

function displayContextValue(value: unknown): string {
  if (value === null || value === undefined) return "(none)"
  return sanitizeTerminalText(String(value)) || "(none)"
}

function environmentLabel(mode: string): string {
  if (mode.toLowerCase() === "mock") return "Sandbox"
  if (mode.toLowerCase() === "live") return "Live"
  return mode
}

function inboxLabel(
  itemCount: unknown,
  warningCount: unknown,
  user: string
): string {
  if (typeof itemCount !== "number") {
    return user === "(none)" ? "Sign in to view inbox" : "Inbox unavailable"
  }
  if (itemCount === 0) return "Inbox clear"
  const items = `${itemCount} ${itemCount === 1 ? "item" : "items"} need review`
  if (typeof warningCount !== "number" || warningCount <= 0) return items
  return `${items} · ${warningCount} with warnings`
}

function nonNegativeCount(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback
  return Math.max(0, Math.floor(value))
}

function resolveOptions(
  options: HumanRenderOptions | Pick<HumanRenderOptions, "width"> | number
): HumanRenderOptions {
  return typeof options === "number" ? { width: options } : options
}
