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

export type ReviewWorkspaceTabId =
  | "overview"
  | "evidence"
  | "draft"
  | "activity"
  | "actions"

export type ReviewWorkspaceTab = {
  content: string
  id: ReviewWorkspaceTabId
  label: string
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

  if (kind === "auto" && isWorkspaceSandboxRun(safeValue))
    return renderWorkspaceSandboxRun(safeValue, resolved)

  if (kind === "auto" && isSandboxSession(safeValue))
    return renderSandboxSession(safeValue, resolved)

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

export function renderSandboxSession(
  value: unknown,
  options: HumanRenderOptions | number = {}
): string {
  const resolved = resolveOptions(options)
  const width = normalizeTerminalWidth(resolved.width)
  const source = isRecord(value) ? value : {}
  const sources = Array.isArray(source.sources)
    ? source.sources.filter(isRecord)
    : []
  const candidates = Array.isArray(source.candidates)
    ? source.candidates.filter(isRecord)
    : []
  const sessionId = valueText(source.sessionId, "temporary")
  const recordCount = formatCount(source.recordCount)
  const candidateCount = formatCount(source.candidateCount)
  const title = resolved.color
    ? styleText(["bold", "cyan"], "Real-data Sandbox", {
        validateStream: false,
      })
    : "Real-data Sandbox"
  const sections = [
    [
      title,
      wrapTerminalText(
        `Session ${sessionId} · ${recordCount} connected records · ${candidateCount} review candidates`,
        width
      ),
      wrapTerminalText(
        "This temporary view reads real workspace data but is read-only. It creates no workflow records and sends nothing to connected systems.",
        width
      ),
    ].join("\n"),
  ]

  if (sources.length) {
    sections.push(
      [
        "Connected Sources",
        renderAsciiTable(
          ["Source", "Records", "Freshness"],
          sources.map((entry) => [
            valueText(entry.name, valueText(entry.key, "Unknown")),
            valueText(entry.recordCount, "0"),
            entry.stale === true ? "Stale" : "Current",
          ]),
          width,
          [3, 1, 1]
        ),
      ].join("\n")
    )
  }

  if (candidates.length) {
    sections.push(
      [
        "Procurement Candidates",
        renderAsciiTable(
          ["SKU", "Available", "Recommend", "Vendor", "Status"],
          candidates.map((entry) => {
            const inventory = recordOrEmpty(entry.inventory)
            const recommendation = recordOrEmpty(entry.recommendation)
            const vendor = recordOrEmpty(entry.vendor)
            return [
              valueText(entry.sku, "Unknown"),
              valueText(inventory.available, "0"),
              valueText(recommendation.quantity, "0"),
              valueText(vendor.name, "Unmapped"),
              valueText(recommendation.status, "Unknown").replaceAll("_", " "),
            ]
          }),
          width,
          [2, 1, 1, 2, 2]
        ),
      ].join("\n")
    )
  } else {
    sections.push("Procurement Candidates\nNo candidates need review.")
  }

  return sections.join("\n\n")
}

export function renderWorkspaceSandboxRun(
  value: unknown,
  options: HumanRenderOptions | number = {}
): string {
  const resolved = resolveOptions(options)
  const width = normalizeTerminalWidth(resolved.width)
  const source = isRecord(value) ? value : {}
  const catalog = recordOrEmpty(source.catalog)
  const agent = recordOrEmpty(source.agent)
  const signal = recordOrEmpty(source.signal)
  const harness = recordOrEmpty(source.harness)
  const proof = recordOrEmpty(source.proof)
  const deliverable = recordOrEmpty(source.deliverable)
  const recommendation = recordOrEmpty(deliverable.recommendation)
  const output = recordOrEmpty(recommendation.output)
  return [
    [
      "Sandbox Golden Path",
      wrapTerminalText(
        `${formatCount(catalog.records)} records across ${formatCount(catalog.datasets)} cataloged datasets`,
        width
      ),
      wrapTerminalText(
        `Installed ${valueText(agent.name, "agent")} v${valueText(agent.version, "unknown")} inactive and bound ${formatCount(Array.isArray(source.mappings) ? source.mappings.length : 0)} declarative mappings.`,
        width
      ),
    ].join("\n"),
    [
      "Detected Signal",
      wrapTerminalText(
        `${valueText(signal.id, "Unknown")} · ${valueText(signal.entityKey, "record")} ${valueText(signal.entityValue, "Unknown")}`,
        width
      ),
    ].join("\n"),
    [
      "Typed Deliverable",
      wrapTerminalText(
        `${valueText(harness.status, "Unknown").replaceAll("_", " ")} · ${valueText(recommendation.rationale, "No deliverable was produced.")}`,
        width
      ),
      Object.keys(output).length
        ? renderAsciiTable(
            ["Field", "Value"],
            Object.entries(output).map(([key, entry]) => [
              key,
              valueText(entry, ""),
            ]),
            width,
            [1, 2]
          )
        : "No recommendation output.",
    ].join("\n"),
    [
      "Zero-write Proof",
      wrapTerminalText(
        proof.unchanged === true
          ? `PASS · ${formatCount(proof.persistenceWrites)} persisted writes · ${formatCount(proof.externalWriteAttempts)} external write attempts`
          : "FAILED · monitored state changed during the Sandbox run",
        width
      ),
    ].join("\n"),
  ].join("\n\n")
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
  const payload = recordOrEmpty(draft.payload)
  const policy = recordOrEmpty(draft.editPolicy)
  const lines = arrayAt(payload, ["lines"])
  const itemSummary = lines.map((line) => {
    const record = recordOrEmpty(line)
    const sku = valueText(read(record, ["sku", "item", "itemCode"]), "Item")
    const quantity = valueText(
      read(record, ["quantity", "qty"]),
      "Unknown quantity"
    )
    return `${sku} · quantity ${quantity}`
  })
  const reasons = lines
    .map((line) => valueText(read(recordOrEmpty(line), ["reason"])))
    .filter(Boolean)
  const additionalPayload = Object.fromEntries(
    Object.entries(payload).filter(
      ([key]) => !["lines", "mode", "supplier", "vendor"].includes(key)
    )
  )

  return renderProductSections(
    title,
    [
      ["Action", read(draft, ["actionType", "type"])],
      ["Status", read(draft, ["status"])],
      ["Mode", firstValue(payload, draft, ["mode"])],
      ["Vendor", read(payload, ["vendor", "supplier"])],
      ["Items", itemSummary],
      ["Reason", reasons],
      [
        "Additional payload",
        Object.keys(additionalPayload).length > 0
          ? additionalPayload
          : undefined,
      ],
      ["Editable", read(policy, ["editable"])],
      ["Reason required", read(policy, ["requireReason"])],
    ],
    width
  )
}

export function renderAssistantMessage(
  message: string,
  options: Pick<HumanRenderOptions, "color" | "width"> | number = {}
): string {
  const resolved = resolveOptions(options)
  const width = normalizeTerminalWidth(resolved.width)
  const safeMessage = String(redactSecrets(message))
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => sanitizeTerminalText(line))
    .join("\n")
  const label = resolved.color
    ? styleText(["bold", "cyan"], "Mandala", { validateStream: false })
    : "Mandala"
  const wrappedMessage = safeMessage
    .split("\n")
    .map((line) => wrapTerminalText(line, width))
    .join("\n")
  return `${label}\n${wrappedMessage}`
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
    mode: context.mode ?? "sandbox",
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

/** A compact, product-shaped home view. The complete diagnostic renderer remains
 * available through renderHumanResult for callers that need every field. */
export function renderHomeSummary(
  input: unknown,
  options: HumanRenderOptions | number = {}
): string {
  const { width, value } = productInput(input, options)
  const source = recordOrEmpty(value)
  const context = recordOrEmpty(source.context)
  const items = arrayAt(source, ["items"])
  const active = countAt(source, ["itemCount", "activeCount"], items.length)
  const urgent = countAt(
    source,
    ["urgentCount"],
    countMatching(items, isUrgent)
  )
  const blocked = countAt(
    source,
    ["blockedCount"],
    countMatching(items, isBlocked)
  )
  const warnings = countAt(
    source,
    ["warningCount"],
    countMatching(items, itemHasWarnings)
  )
  const categories = summarizeCategories(items)
  const authenticated =
    read(context, ["authenticated"]) ?? read(source, ["authenticated"])
  const workspace = firstValue(context, source, [
    "workspaceName",
    "companyName",
    "workspace",
    "company",
  ])

  return renderProductSections(
    resolvedTitle(options, "Home"),
    [
      ["Workspace", workspace],
      [
        "Mode",
        environmentLabel(
          valueText(
            firstValue(context, source, ["mode", "environment"]),
            "Unknown"
          )
        ),
      ],
      ["Active work", active],
      ["Urgent", urgent],
      ["Blocked", blocked],
      ["With warnings", warnings],
      ["Needs attention", categories],
      [
        "Next action",
        authenticated === false
          ? "Sign in with /login"
          : workspace === undefined || workspace === null
            ? "Choose a workspace with /companies, then /company 1"
            : active > 0
              ? "Open the inbox to review work"
              : "Ask Mandala or refresh the inbox",
      ],
    ],
    width
  )
}

/** Concise active-inbox projection. Unknown item fields remain available through
 * renderHumanResult rather than being silently discarded from diagnostic output. */
export function renderInbox(
  input: unknown,
  options: HumanRenderOptions | number = {}
): string {
  const { width, value } = productInput(input, options)
  const source = Array.isArray(value) ? { items: value } : recordOrEmpty(value)
  const allItems = arrayAt(source, ["items"])
  const items = allItems.filter((item) => !isResolved(item))
  const urgent = countMatching(items, isUrgent)
  const blocked = countMatching(items, isBlocked)
  const title = `${resolvedTitle(options, "Inbox")} · ${items.length} active`
  const wide = width >= 100
  if (items.length === 0)
    return `${wrapTerminalText(title, width)}\n${wrapTerminalText("Nothing requires review. Ask Mandala or refresh when new work arrives.", width)}`

  const heading = wrapTerminalText(
    `${title}${urgent || blocked ? ` · ${urgent} urgent · ${blocked} blocked` : ""}`,
    width
  )
  if (width < 70) {
    const cards = items.map((item, index) =>
      renderProductSections(
        `${index + 1}. ${valueText(read(item, ["title", "summary", "name"]), "Untitled item")}`,
        inboxRows(item),
        width
      )
    )
    return [
      heading,
      ...cards,
      wrapTerminalText(
        "Rows belong to this inbox view. Open a row to review it.",
        width
      ),
    ].join("\n\n")
  }

  const headers = wide
    ? [
        "#",
        "Needs attention",
        "Type",
        "Status",
        "Priority",
        "Source",
        "Owner",
        "Updated",
        "Warning",
      ]
    : [
        "#",
        "Needs attention",
        "Type",
        "Status",
        "Priority",
        "Source",
        "Updated",
      ]
  const rows = items.map((item, index) => {
    const values = [
      String(index + 1),
      valueText(read(item, ["title", "summary", "name"]), "Untitled item"),
      valueText(inboxValue(item, ["type", "itemType", "workType"]), "Work"),
      valueText(inboxValue(item, ["status", "state"]), "Unknown"),
      valueText(inboxValue(item, ["priority", "urgency"]), "Normal"),
      valueText(
        inboxValue(item, ["source", "sourceSystem", "origin"]),
        "Unknown"
      ),
    ]
    if (wide) {
      values.push(
        valueText(
          inboxValue(item, ["owner", "ownerRole", "role", "assignedTo"]),
          "Unassigned"
        )
      )
    }
    values.push(
      valueText(
        inboxValue(item, [
          "waitingAge",
          "age",
          "updatedAgo",
          "waiting",
          "updatedAt",
        ]),
        "—"
      )
    )
    if (wide) values.push(warningLabel(item))
    return values
  })
  return [
    heading,
    renderAsciiTable(headers, rows, width),
    wrapTerminalText(
      "Rows belong to this inbox view. Open a row to see its context and next action.",
      width
    ),
  ].join("\n")
}

export function renderInboxItemOverview(
  input: unknown,
  options: HumanRenderOptions | number = {}
): string {
  const { width, value } = productInput(input, options)
  const root = recordOrEmpty(value)
  const item = recordOrEmpty(isRecord(root.item) ? root.item : root)
  const context = recordOrEmpty(
    firstValue(root, item, ["contextPacket", "context", "sourceContext"])
  )
  const recommendation = recordOrEmpty(root.recommendation)
  const warnings = collectWarnings(root)
  return renderProductSections(
    `${resolvedTitle(options, "Inbox item")} · ${valueText(read(item, ["title", "summary", "name"]), "Untitled item")}`,
    [
      ["Type", read(item, ["type", "itemType", "workType"])],
      ["Status", read(item, ["status", "state"])],
      ["Priority", read(item, ["priority", "urgency"])],
      ["Owner", read(item, ["owner", "ownerRole", "role", "assignedTo"])],
      [
        "Why it exists",
        read(item, ["why", "reason", "trigger"]) ??
          read(context, ["why", "reason", "trigger"]) ??
          read(recommendation, ["rationaleSummary", "reason", "summary"]),
      ],
      [
        "Needs attention",
        firstValue(item, context, [
          "requiredAttention",
          "attention",
          "nextWorkflow",
          "requestedAction",
        ]),
      ],
      [
        "Source",
        firstValue(item, context, [
          "source",
          "sourceSystem",
          "origin",
          "sources",
        ]),
      ],
      [
        "Source reference",
        firstValue(item, context, [
          "sourceReference",
          "sourceRef",
          "recordReference",
          "references",
        ]),
      ],
      [
        "Freshness",
        firstValue(item, context, [
          "freshness",
          "freshnessState",
          "asOf",
          "updatedAt",
          "createdAt",
          "sourceTimestamp",
        ]),
      ],
      [
        "Missing context",
        firstValue(item, context, [
          "missingData",
          "missingContext",
          "incompleteContext",
        ]),
      ],
      ["Warnings", warnings.all],
      [
        "Next action",
        firstValue(item, context, [
          "nextAction",
          "nextWorkflow",
          "availableActions",
        ]),
      ],
    ],
    width
  )
}

/** One decision-first projection for a selected item. The caller may provide a
 * canonical detail alone or pair it with the permission-aware review payload. */
export function renderReviewWorkspace(
  input: unknown,
  options: HumanRenderOptions | number = {}
): string {
  const { width, value } = productInput(input, options)
  const root = recordOrEmpty(value)
  const detail = recordOrEmpty(isRecord(root.detail) ? root.detail : root)
  const review = recordOrEmpty(root.review)
  const reviewItem = recordOrEmpty(review.item)
  const detailItem = recordOrEmpty(detail.item)
  const recordSnapshot = recordOrEmpty(review.recordSnapshot)
  const activity = recordOrEmpty(review.activity)
  const availableActions = Array.isArray(review.availableActions)
    ? review.availableActions
    : Array.isArray(root.availableActions)
      ? root.availableActions
      : []
  const item = { ...detailItem, ...reviewItem }
  const context = recordOrEmpty(
    Object.keys(recordSnapshot).length > 0
      ? recordSnapshot
      : detail.contextPacket
  )
  const facts = recordOrEmpty(context.facts)
  const recommendation = recordOrEmpty(
    review.recommendation ?? detail.recommendation
  )
  const output = recordOrEmpty(recommendation.output)
  const evidence = recordOrEmpty(review.evidence ?? detail.evidence)
  const draft = recordOrEmpty(review.draft ?? detail.draft)
  const payload = recordOrEmpty(draft.payload)
  const reviewActivityItems = Array.isArray(activity.items)
    ? activity.items
    : []
  const detailActivityItems = Array.isArray(detail.activity)
    ? detail.activity
    : []
  const auditActivityItems = Array.isArray(detail.auditEvents)
    ? detail.auditEvents
    : []
  const activityItems =
    reviewActivityItems.length > 0
      ? reviewActivityItems
      : detailActivityItems.length > 0
        ? detailActivityItems
        : auditActivityItems
  const latestActivity = latestProductActivity(activityItems)
  const warnings = collectWarnings({
    contextPacket: context,
    recommendation,
    evidence,
  })
  const title = valueText(read(item, ["title", "summary"]), "Selected item")
  const mode = root.sandbox === true ? " · SANDBOX" : ""

  return [
    renderCompactProductSections(
      `Review workspace${mode} · ${title}`,
      [
        ["Status", read(item, ["status", "state"])],
        ["Type", read(item, ["itemType", "type"])],
        ["Priority", read(item, ["priority", "urgency"])],
        ["Owner", read(item, ["owner", "ownerRole", "assignedTo"])],
      ],
      width
    ),
    renderCompactProductSections(
      "Recommendation",
      [
        [
          "Summary",
          read(recommendation, [
            "rationaleSummary",
            "summary",
            "recommendation",
          ]),
        ],
        [
          "Current stock",
          read(output, [
            "currentStock",
            "stock",
            "onHand",
            "inventoryOnHand",
          ]) ?? read(facts, ["availableInventory", "currentStock", "onHand"]),
        ],
        [
          "Recent sales",
          read(output, ["recentSales", "sales30Days", "salesVelocity"]) ??
            read(facts, ["recent30DaySales", "recentSales", "salesTrend"]),
        ],
        [
          "Reorder trigger",
          read(output, ["reorderTrigger", "reorderPoint", "trigger"]) ??
            read(facts, ["reorderPoint", "reorderTrigger", "trigger"]),
        ],
        [
          "Open POs",
          read(output, ["openPurchaseOrders", "openPOs", "openOrders"]) ??
            read(facts, ["openPurchaseOrders", "openPOs", "openOrders"]),
        ],
        [
          "Suggested quantity",
          read(output, [
            "recommendedQuantity",
            "suggestedQuantity",
            "quantity",
            "reorderQuantity",
          ]) ?? read(payload, ["quantity", "lines"]),
        ],
        [
          "Vendor",
          read(output, ["vendor", "vendorName", "supplier"]) ??
            read(payload, ["vendor", "vendorName", "supplier"]),
        ],
        ["Warnings", warnings.all],
      ],
      width
    ),
    renderCompactProductSections(
      "Record context",
      [
        [
          "Why it exists",
          read(item, ["why", "reason", "trigger"]) ??
            read(recommendation, ["rationaleSummary"]),
        ],
        [
          "Sources",
          read(context, ["sources"]) ?? read(evidence, ["sourceRefs"]),
        ],
        ["Captured", read(context, ["capturedAt", "createdAt"])],
        ["Draft", read(draft, ["actionType", "status"])],
      ],
      width
    ),
    renderCompactProductSections(
      "Evidence & freshness",
      [
        [
          "Freshness",
          firstValue(context, recommendation, [
            "freshnessState",
            "freshness",
            "asOf",
            "createdAt",
          ]),
        ],
        ["Evidence", read(evidence, ["evidence"])],
        ["Assumptions", read(evidence, ["assumptions"])],
        [
          "Confidence",
          read(recommendation, ["confidenceMarker", "confidence"]),
        ],
        ["Memory provenance", read(context, ["memoryRefs"])],
        ["Warning · Blocking", warnings.blocking],
        ["Warning · Informational", warnings.informational],
      ],
      width
    ),
    renderCompactProductSections(
      "Activity",
      [
        ["Entries", activityItems.length],
        [
          "Latest",
          read(latestActivity, ["summary", "type", "eventType", "status"]),
        ],
        ["When", read(latestActivity, ["createdAt", "timestamp", "updatedAt"])],
      ],
      width,
      "No activity recorded."
    ),
    renderCompactProductSections(
      "Actions",
      [
        [
          "Available",
          availableActions.length > 0
            ? availableActions.map(reviewActionLabel)
            : "No actions are currently allowed",
        ],
        [
          "Ask Mandala",
          "Type a question about this selected item for a read-only answer",
        ],
        ...(root.sandbox === true
          ? ([
              [
                "Persistence",
                "Temporary only. Nothing is written or sent to a connected system.",
              ],
            ] as const)
          : []),
      ],
      width
    ),
  ].join("\n\n")
}

/** Compact, independently replaceable sections for the persistent Ink item
 * workspace. Action availability is display-only here; the caller keeps the
 * backend-owned action values and existing mutation path. */
export function renderReviewWorkspaceTabs(
  input: unknown,
  options: HumanRenderOptions | number = {}
): ReviewWorkspaceTab[] {
  const { width, value } = productInput(input, options)
  const root = recordOrEmpty(value)
  const detail = recordOrEmpty(isRecord(root.detail) ? root.detail : root)
  const review = recordOrEmpty(root.review)
  const item = {
    ...recordOrEmpty(detail.item),
    ...recordOrEmpty(review.item),
  }
  const recordSnapshot = recordOrEmpty(review.recordSnapshot)
  const context = recordOrEmpty(
    Object.keys(recordSnapshot).length > 0
      ? recordSnapshot
      : detail.contextPacket
  )
  const facts = recordOrEmpty(context.facts)
  const recommendation = recordOrEmpty(
    review.recommendation ?? detail.recommendation
  )
  const output = recordOrEmpty(recommendation.output)
  const evidence = recordOrEmpty(review.evidence ?? detail.evidence)
  const draft = recordOrEmpty(review.draft ?? detail.draft)
  const payload = recordOrEmpty(draft.payload)
  const reviewActivity = recordOrEmpty(review.activity)
  const reviewActivityItems = Array.isArray(reviewActivity.items)
    ? reviewActivity.items
    : []
  const detailActivityItems = Array.isArray(detail.activity)
    ? detail.activity
    : []
  const auditActivityItems = Array.isArray(detail.auditEvents)
    ? detail.auditEvents
    : []
  const activityItems =
    reviewActivityItems.length > 0
      ? reviewActivityItems
      : detailActivityItems.length > 0
        ? detailActivityItems
        : auditActivityItems
  const availableActions = Array.isArray(review.availableActions)
    ? review.availableActions
    : Array.isArray(root.availableActions)
      ? root.availableActions
      : []
  const warnings = collectWarnings({
    contextPacket: context,
    recommendation,
    evidence,
  })
  const overview = [
    renderCompactProductSections(
      "Overview",
      [
        ["Type", read(item, ["itemType", "type"])],
        ["Priority", read(item, ["priority", "urgency"])],
        ["Owner", read(item, ["owner", "ownerRole", "assignedTo"])],
        [
          "Why it exists",
          read(item, ["why", "reason", "trigger"]) ??
            read(recommendation, ["rationaleSummary"]),
        ],
      ],
      width
    ),
    renderCompactProductSections(
      "Recommendation",
      [
        [
          "Summary",
          read(recommendation, [
            "rationaleSummary",
            "summary",
            "recommendation",
          ]),
        ],
        [
          "Current stock",
          read(output, [
            "currentStock",
            "stock",
            "onHand",
            "inventoryOnHand",
          ]) ?? read(facts, ["availableInventory", "currentStock", "onHand"]),
        ],
        [
          "Recent sales",
          read(output, ["recentSales", "sales30Days", "salesVelocity"]) ??
            read(facts, ["recent30DaySales", "recentSales", "salesTrend"]),
        ],
        [
          "Reorder trigger",
          read(output, ["reorderTrigger", "reorderPoint", "trigger"]) ??
            read(facts, ["reorderPoint", "reorderTrigger", "trigger"]),
        ],
        [
          "Open POs",
          read(output, ["openPurchaseOrders", "openPOs", "openOrders"]) ??
            read(facts, ["openPurchaseOrders", "openPOs", "openOrders"]),
        ],
        [
          "Suggested quantity",
          read(output, [
            "recommendedQuantity",
            "suggestedQuantity",
            "quantity",
            "reorderQuantity",
          ]) ?? read(payload, ["quantity", "lines"]),
        ],
        [
          "Vendor",
          read(output, ["vendor", "vendorName", "supplier"]) ??
            read(payload, ["vendor", "vendorName", "supplier"]),
        ],
        ["Warnings", warnings.all],
      ],
      width
    ),
    renderCompactProductSections(
      "Record context",
      [
        [
          "Sources",
          read(context, ["sources"]) ?? read(evidence, ["sourceRefs"]),
        ],
        ["Captured", read(context, ["capturedAt", "createdAt"])],
      ],
      width
    ),
  ].join("\n\n")
  const evidenceContent = renderCompactProductSections(
    "Evidence & freshness",
    [
      [
        "Freshness",
        firstValue(context, recommendation, [
          "freshnessState",
          "freshness",
          "asOf",
          "createdAt",
        ]),
      ],
      ["Evidence", read(evidence, ["evidence", "sourceRefs"])],
      ["Assumptions", read(evidence, ["assumptions"])],
      ["Missing data", read(evidence, ["missingData", "missing"])],
      ["Confidence", read(recommendation, ["confidenceMarker", "confidence"])],
      [
        "Memory provenance",
        read(evidence, ["memoryProvenance"]) ?? read(context, ["memoryRefs"]),
      ],
      ["Warning · Blocking", warnings.blocking],
      ["Warning · Informational", warnings.informational],
    ],
    width
  )
  const draftContent =
    Object.keys(draft).length > 0
      ? renderDraftPreview(draft, { width, title: "Draft" })
      : `${wrapTerminalText("Draft", width)}\nNo draft is attached to this item.`
  const activityRows = [...activityItems]
    .filter(isRecord)
    .sort((left, right) =>
      activityTimestamp(right).localeCompare(activityTimestamp(left))
    )
    .slice(0, 6)
    .map(
      (event, index): ProductRow => [
        String(index + 1),
        [
          read(event, ["createdAt", "timestamp", "updatedAt"]),
          read(event, ["summary", "type", "eventType", "status"]),
        ]
          .filter(hasProductValue)
          .map((entry) => valueText(entry))
          .join(" · "),
      ]
    )
  const activityContent = renderCompactProductSections(
    "Activity",
    activityRows,
    width,
    "No activity recorded."
  )
  const actionsContent = renderCompactProductSections(
    "Actions",
    [
      [
        "Next",
        availableActions.length > 0
          ? "Choose one of the allowed actions below."
          : "No actions are currently allowed",
      ],
      [
        "Confirmation",
        availableActions.length > 0
          ? "Choose below. Existing warning, reason, preview, and confirmation steps still apply."
          : undefined,
      ],
    ],
    width
  )

  return [
    { id: "overview", label: "Overview", content: overview },
    { id: "evidence", label: "Evidence", content: evidenceContent },
    { id: "draft", label: "Draft", content: draftContent },
    { id: "activity", label: "Activity", content: activityContent },
    { id: "actions", label: "Actions", content: actionsContent },
  ]
}

function renderCompactProductSections(
  title: string,
  rows: readonly ProductRow[],
  width: number,
  emptyMessage = "No details available."
): string {
  const present = rows.filter(([, value]) => hasProductValue(value))
  return present.length > 0
    ? renderProductSections(title, present, width)
    : `${wrapTerminalText(title, width)}\n${wrapTerminalText(emptyMessage, width)}`
}

function hasProductValue(value: unknown): boolean {
  if (value === undefined || value === null || value === "") return false
  if (Array.isArray(value)) return value.length > 0
  if (isRecord(value)) return Object.keys(value).length > 0
  return true
}

function latestProductActivity(
  items: readonly unknown[]
): Record<string, unknown> {
  let latest: Record<string, unknown> = {}
  let latestTime = Number.NEGATIVE_INFINITY
  for (const value of items) {
    const item = recordOrEmpty(value)
    if (Object.keys(item).length === 0) continue
    const timestamp = valueText(
      read(item, ["createdAt", "timestamp", "updatedAt"]),
      ""
    )
    const time = Date.parse(timestamp)
    if (Object.keys(latest).length === 0 || time > latestTime) {
      latest = item
      latestTime = Number.isFinite(time) ? time : latestTime
    }
  }
  return latest
}

function reviewActionLabel(value: unknown): string {
  switch (valueText(value)) {
    case "approve":
      return "Approve"
    case "edit":
      return "Edit and approve"
    case "reject":
      return "Reject"
    case "request_rework":
      return "Request rework"
    case "resolve":
      return "Resolve"
    case "execute_mock":
      return "Execute approved mock action"
    default:
      return valueText(value, "Unknown action")
  }
}

export function renderProcurementReview(
  input: unknown,
  options: HumanRenderOptions | number = {}
): string {
  const { width, value } = productInput(input, options)
  const root = recordOrEmpty(value)
  const item = recordOrEmpty(root.item)
  const recommendation = recordOrEmpty(
    isRecord(root.recommendation) ? root.recommendation : root
  )
  const output = recordOrEmpty(recommendation.output)
  const context = recordOrEmpty(root.contextPacket)
  const facts = recordOrEmpty(context.facts)
  const draft = recordOrEmpty(root.draft)
  const payload = recordOrEmpty(draft.payload)
  const warnings = collectWarnings(root)
  const title = valueText(
    firstValue(item, recommendation, ["title", "sku", "itemName", "product"]),
    "Procurement review"
  )

  return renderProductSections(
    `${resolvedTitle(options, "Review")} · ${title}`,
    [
      [
        "Business",
        read(output, ["businessName"]) ?? read(facts, ["businessName"]),
      ],
      [
        "Product",
        read(output, ["productTitle"]) ?? read(facts, ["productTitle"]),
      ],
      ["Category", read(output, ["category"]) ?? read(facts, ["category"])],
      [
        "Recommendation",
        firstValue(recommendation, output, [
          "recommendation",
          "summary",
          "rationaleSummary",
          "action",
        ]),
      ],
      [
        "Why now",
        firstValue(recommendation, context, [
          "whyNow",
          "reason",
          "trigger",
          "reorderReason",
        ]),
      ],
      [
        "Current stock",
        read(output, ["currentStock", "stock", "onHand", "inventoryOnHand"]) ??
          read(facts, [
            "availableInventory",
            "currentStock",
            "stock",
            "onHand",
          ]),
      ],
      [
        "Recent sales",
        read(output, [
          "recentSales",
          "salesTrend",
          "sales30Days",
          "salesVelocity",
        ]) ?? read(facts, ["recent30DaySales", "recentSales", "salesTrend"]),
      ],
      [
        "Reorder trigger",
        read(output, [
          "reorderTrigger",
          "trigger",
          "reorderPoint",
          "reorderReason",
        ]) ?? read(facts, ["reorderPoint", "reorderTrigger", "trigger"]),
      ],
      [
        "Open POs",
        read(output, [
          "openPurchaseOrders",
          "openPOs",
          "openPos",
          "openOrders",
        ]) ??
          read(facts, [
            "openPurchaseOrders",
            "openPOs",
            "openPos",
            "openOrders",
          ]),
      ],
      [
        "Suggested quantity",
        read(output, [
          "recommendedQuantity",
          "suggestedQuantity",
          "quantity",
          "reorderQuantity",
          "qty",
        ]) ?? read(payload, ["quantity", "recommendedQuantity", "lines"]),
      ],
      [
        "Vendor",
        read(output, ["vendor", "vendorName", "supplier"]) ??
          read(payload, ["vendor", "vendorName", "supplier"]),
      ],
      [
        "Flags",
        firstValue(output, recommendation, [
          "flags",
          "variableSku",
          "unusualSpike",
          "edgeCaseFlags",
        ]),
      ],
      [
        "Run context",
        firstValue(recommendation, context, [
          "runContext",
          "runId",
          "recordContext",
          "recordFields",
        ]),
      ],
      ["Dataset", datasetSummary(facts)],
      ["Agent", read(facts, ["agentModel"])],
      ["Read-only tool calls", read(facts, ["agentToolCallCount"])],
      ["Warning · Blocking", warnings.blocking],
      ["Warning · Informational", warnings.informational],
      [
        "Sources",
        firstValue(context, recommendation, [
          "sources",
          "sourceReferences",
          "source",
        ]),
      ],
      [
        "Freshness",
        firstValue(context, recommendation, [
          "freshness",
          "freshnessState",
          "asOf",
          "updatedAt",
          "createdAt",
        ]),
      ],
      [
        "Next actions",
        firstValue(recommendation, item, [
          "availableActions",
          "nextActions",
          "actions",
        ]),
      ],
    ],
    width
  )
}

function datasetSummary(facts: Record<string, unknown>): string | undefined {
  const products = read(facts, ["syntheticProductCount"])
  const sales = read(facts, ["syntheticSalesRecordCount"])
  const events = read(facts, ["syntheticBusinessEventCount"])
  if (products === undefined && sales === undefined && events === undefined)
    return undefined
  return `${valueText(products, "?")} products · ${valueText(sales, "?")} daily sales · ${valueText(events, "?")} events`
}

export function renderEvidenceSummary(
  input: unknown,
  options: HumanRenderOptions | number = {}
): string {
  const { width, value } = productInput(input, options)
  const root = recordOrEmpty(value)
  const evidence = recordOrEmpty(isRecord(root.evidence) ? root.evidence : root)
  const context = recordOrEmpty(root.contextPacket)
  const recommendation = recordOrEmpty(root.recommendation)
  const warnings = collectWarnings(root)
  return renderProductSections(
    resolvedTitle(options, "Evidence & freshness"),
    [
      [
        "Trigger",
        firstValue(evidence, context, ["trigger", "reason", "reorderTrigger"]),
      ],
      [
        "Sources",
        firstValue(evidence, context, [
          "sources",
          "sourceRefs",
          "sourceInputs",
          "evidence",
          "sourceReferences",
        ]),
      ],
      [
        "Freshness",
        firstValue(evidence, context, [
          "freshness",
          "freshnessState",
          "asOf",
          "updatedAt",
          "createdAt",
          "sourceTimestamps",
        ]),
      ],
      ["Assumptions", read(evidence, ["assumptions"])],
      [
        "Missing data",
        firstValue(evidence, context, ["missingData", "missing", "gaps"]),
      ],
      [
        "Confidence",
        firstValue(evidence, recommendation, [
          "confidence",
          "confidenceScore",
          "confidenceIndicators",
        ]),
      ],
      [
        "Memory provenance",
        firstValue(evidence, context, [
          "memoryProvenance",
          "memoryRefs",
          "memoryReferences",
        ]),
      ],
      ["Warning · Blocking", warnings.blocking],
      ["Warning · Informational", warnings.informational],
      [
        "Rationale",
        firstValue(evidence, recommendation, [
          "rationale",
          "rationaleSummary",
          "summary",
        ]),
      ],
    ],
    width
  )
}

export function renderDecisionResult(
  input: unknown,
  options: HumanRenderOptions | number = {}
): string {
  const { width, value } = productInput(input, options)
  const root = recordOrEmpty(value)
  const outerDecision = recordOrEmpty(
    isRecord(root.decision) ? root.decision : root
  )
  const decision = recordOrEmpty(
    isRecord(outerDecision.decision) ? outerDecision.decision : outerDecision
  )
  const action = valueText(
    read(decision, ["action", "decision", "kind", "type", "status"]),
    "Recorded"
  )
  if (root.preview === true) {
    const item = recordOrEmpty(root.item)
    return renderProductSections(
      `${resolvedTitle(options, "Confirm decision")} · ${action.toUpperCase()}`,
      [
        ["Action", action],
        ["Item", read(item, ["title", "name", "id"])],
        [
          "Reason",
          read(decision, ["reason", "feedback", "comment"]) ??
            read(root, ["reason", "feedback", "comment"]),
        ],
        ["Warnings", read(root, ["warnings"])],
        [
          "Warnings acknowledged",
          read(decision, ["warningsAcknowledged", "warningAcknowledged"]) ??
            read(root, ["warningsAcknowledged", "warningAcknowledged"]),
        ],
        [
          "Next",
          action === "approve"
            ? "Record approval, then review mock execution"
            : "Record this decision",
        ],
      ],
      width
    )
  }
  return renderProductSections(
    `${resolvedTitle(options, "Decision recorded")} · ${action.toUpperCase()}`,
    [
      [
        "By",
        read(decision, ["actor", "actorEmail", "userEmail", "decidedBy"]) ??
          read(outerDecision, [
            "actor",
            "actorEmail",
            "userEmail",
            "decidedBy",
          ]),
      ],
      ["Action", action],
      [
        "Reason",
        read(decision, ["reason", "feedback", "comment"]) ??
          read(outerDecision, ["reason", "feedback", "comment"]) ??
          read(root, ["reason", "feedback", "comment"]),
      ],
      ["Timestamp", read(decision, ["timestamp", "decidedAt", "createdAt"])],
      ["State", stateTransition(decision)],
      [
        "Warnings acknowledged",
        read(decision, ["warningsAcknowledged", "warningAcknowledged"]) ??
          read(outerDecision, [
            "warningsAcknowledged",
            "warningAcknowledged",
          ]) ??
          read(root, ["warningsAcknowledged", "warningAcknowledged"]),
      ],
      [
        "Revision status",
        read(decision, [
          "revisionStatus",
          "revisedOutputStatus",
          "reworkStatus",
        ]),
      ],
      [
        "Next action",
        firstValue(root, decision, ["nextAction", "availableActions"]),
      ],
    ],
    width
  )
}

export function renderExecutionResult(
  input: unknown,
  options: HumanRenderOptions | number = {}
): string {
  const { width, value } = productInput(input, options)
  const root = recordOrEmpty(value)
  const execution = recordOrEmpty(
    isRecord(root.execution) ? root.execution : root
  )
  const attempt = recordOrEmpty(
    isRecord(execution.attempt)
      ? execution.attempt
      : isRecord(root.attempt)
        ? root.attempt
        : execution
  )
  const draft = recordOrEmpty(
    isRecord(execution.draft) ? execution.draft : root.draft
  )
  const rawMode = firstValue(attempt, root, ["mode", "executionMode"])
  const mock =
    read(attempt, ["isMock"]) === true ||
    valueText(rawMode).toLowerCase() === "mock" ||
    hasMockIdentifier(attempt)
  const mode = mock ? "MOCK" : valueText(rawMode, "UNKNOWN").toUpperCase()
  const requestSummary =
    read(attempt, ["requestSummary", "payloadSummary", "wouldCreate"]) ??
    read(execution, ["requestSummary", "payloadSummary", "wouldCreate"]) ??
    read(root, ["requestSummary", "payloadSummary", "wouldCreate"])
  const actionOrPayload =
    read(attempt, ["request", "payload", "actionType"]) ??
    read(execution, ["request", "payload", "actionType"]) ??
    read(root, ["request", "payload", "actionType"]) ??
    read(draft, ["payload"])
  const output = renderProductSections(
    `${resolvedTitle(options, "Approval execution")} · ${mode}`,
    [
      ["Mode", mode],
      ["Attempt status", read(attempt, ["status", "attemptStatus", "outcome"])],
      ["Would create", requestSummary ?? actionOrPayload],
      [
        mock ? "Mock external ID" : "External ID",
        read(attempt, [
          "mockExternalId",
          "externalId",
          "externalRecordId",
          "resultId",
        ]),
      ],
      [
        "Outcome",
        firstValue(attempt, root, [
          "result",
          "resultPayload",
          "outcome",
          "message",
        ]),
      ],
      ["Error", read(attempt, ["error", "errorMessage", "failureReason"])],
      [
        "Timestamp",
        read(attempt, ["timestamp", "attemptedAt", "completedAt", "createdAt"]),
      ],
      [
        "Retry",
        firstValue(attempt, root, ["retryState", "retryable", "nextAction"]),
      ],
      [
        "Audit reference",
        firstValue(attempt, root, [
          "auditReference",
          "auditEventId",
          "auditId",
        ]),
      ],
    ],
    width
  )
  return mock
    ? `${output}\n\n${wrapTerminalText("MOCK ONLY — No live external record was created.", width)}`
    : output
}

export function renderActivityHistory(
  input: unknown,
  options: HumanRenderOptions | number = {}
): string {
  const { width, value } = productInput(input, options)
  const root = recordOrEmpty(value)
  const arrays = [
    "activity",
    "history",
    "auditEvents",
    "events",
    "attempts",
    "decisions",
  ].flatMap((key) => (Array.isArray(root[key]) ? (root[key] as unknown[]) : []))
  const singletons = [
    activityEntry("Draft", root.draft),
    activityEntry("Decision", root.decision),
    activityEntry("Execution", root.attempt),
  ].filter((entry): entry is Record<string, unknown> => entry !== undefined)
  const events = deduplicateActivity([...singletons, ...arrays]).sort(
    (left, right) =>
      activityTimestamp(left).localeCompare(activityTimestamp(right))
  )
  const title = resolvedTitle(options, "Activity & history")
  if (events.length === 0)
    return `${wrapTerminalText(title, width)}\nNo activity recorded.`
  const sections = events.map((event, index) => {
    const record = recordOrEmpty(event)
    return renderProductSections(
      `${index + 1}. ${valueText(read(record, ["eventType", "type", "action", "decision", "status"]), "Activity")}`,
      [
        [
          "When",
          read(record, ["timestamp", "createdAt", "occurredAt", "decidedAt"]),
        ],
        [
          "Actor",
          read(record, ["actor", "actorEmail", "userEmail", "createdBy"]),
        ],
        [
          "Summary",
          read(record, [
            "summary",
            "reason",
            "message",
            "feedback",
            "errorMessage",
          ]),
        ],
        ["State", stateTransition(record)],
        ["Draft", read(record, ["draft", "draftId", "revision"])],
        [
          "Downstream outcome",
          read(record, [
            "outcome",
            "result",
            "resultPayload",
            "attemptStatus",
            "executionStatus",
            "status",
          ]),
        ],
        [
          "Audit reference",
          read(record, ["auditReference", "auditEventId", "auditId", "id"]),
        ],
      ],
      width
    )
  })
  return [wrapTerminalText(title, width), ...sections].join("\n\n")
}

function activityEntry(
  eventType: string,
  value: unknown
): Record<string, unknown> | undefined {
  return isRecord(value) ? { eventType, ...value } : undefined
}

function activityTimestamp(value: unknown): string {
  return valueText(
    read(value, [
      "timestamp",
      "createdAt",
      "occurredAt",
      "decidedAt",
      "updatedAt",
    ])
  )
}

function deduplicateActivity(
  entries: readonly unknown[]
): Record<string, unknown>[] {
  const seen = new Set<string>()
  return entries.flatMap((entry, index) => {
    const record = recordOrEmpty(entry)
    if (Object.keys(record).length === 0) return []
    const id = valueText(read(record, ["id", "auditReference", "auditEventId"]))
    const key =
      id ||
      `${valueText(record.eventType)}:${activityTimestamp(record)}:${index}`
    if (seen.has(key)) return []
    seen.add(key)
    return [record]
  })
}

type ProductRow = readonly [label: string, value: unknown]

function productInput(
  input: unknown,
  options: HumanRenderOptions | number
): { width: number; value: unknown } {
  const resolved = resolveOptions(options)
  return {
    width: normalizeTerminalWidth(resolved.width),
    value: redactSecrets(input),
  }
}

function resolvedTitle(
  options: HumanRenderOptions | number,
  fallback: string
): string {
  return typeof options === "number" ? fallback : (options.title ?? fallback)
}

function renderProductSections(
  title: string,
  rows: readonly ProductRow[],
  width: number
): string {
  const lines = [wrapTerminalText(title, width)]
  const longestLabel = Math.max(
    ...rows.map(([label]) => sanitizeTerminalText(label).length)
  )
  const labelWidth = Math.min(
    28,
    Math.max(14, Math.floor(width * 0.25), longestLabel)
  )
  for (const [label, rawValue] of rows) {
    const value = valueText(rawValue, "Not provided")
    const safeLabel = sanitizeTerminalText(label)
    if (width < 56) {
      lines.push(safeLabel)
      lines.push(
        wrapTerminalText(value, Math.max(1, width - 2))
          .split("\n")
          .map((line) => `  ${line}`)
          .join("\n")
      )
      continue
    }
    const valueWidth = Math.max(1, width - labelWidth - 1)
    const wrapped = wrapTerminalText(value, valueWidth).split("\n")
    lines.push(`${safeLabel.padEnd(labelWidth)} ${wrapped[0] ?? ""}`)
    for (const line of wrapped.slice(1))
      lines.push(`${"".padEnd(labelWidth)} ${line}`)
  }
  return lines.join("\n")
}

function recordOrEmpty(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {}
}

function read(record: unknown, keys: readonly string[]): unknown {
  if (!isRecord(record)) return undefined
  for (const key of keys) {
    if (record[key] !== undefined && record[key] !== null) return record[key]
  }
  return undefined
}

function firstValue(
  primary: unknown,
  secondary: unknown,
  keys: readonly string[]
): unknown {
  return read(primary, keys) ?? read(secondary, keys)
}

function arrayAt(record: unknown, keys: readonly string[]): unknown[] {
  const value = read(record, keys)
  return Array.isArray(value) ? value : []
}

function countAt(
  record: unknown,
  keys: readonly string[],
  fallback: number
): number {
  const value = read(record, keys)
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : fallback
}

function valueText(value: unknown, fallback = ""): string {
  if (value === undefined || value === null || value === "") return fallback
  if (typeof value === "string") return sanitizeTerminalText(value) || fallback
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  )
    return sanitizeTerminalText(String(value))
  if (Array.isArray(value)) {
    if (value.length === 0) return "None"
    return value.map((entry) => valueText(entry, "Unknown")).join(" · ")
  }
  if (isRecord(value)) {
    const preferred = read(value, [
      "label",
      "name",
      "title",
      "summary",
      "message",
      "value",
      "id",
    ])
    if (preferred !== undefined) return valueText(preferred, fallback)
    const entries = Object.entries(value).slice(0, 6)
    if (entries.length === 0) return "None"
    return entries
      .map(
        ([key, entry]) =>
          `${sanitizeTerminalText(key)}: ${valueText(entry, "Unknown")}`
      )
      .join(" · ")
  }
  return sanitizeTerminalText(String(value)) || fallback
}

function formatCount(value: unknown): string {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.floor(value)).toLocaleString("en-US")
    : "0"
}

function countMatching(
  items: readonly unknown[],
  predicate: (item: unknown) => boolean
): number {
  return items.reduce<number>(
    (count, item) => count + (predicate(item) ? 1 : 0),
    0
  )
}

function isUrgent(item: unknown): boolean {
  const priority = read(item, ["priority", "urgency"])
  if (typeof priority === "number") return priority >= 80
  return /urgent|critical|high/i.test(valueText(priority))
}

function isBlocked(item: unknown): boolean {
  const state = valueText(read(item, ["status", "state", "warningState"]))
  const recommendationState = isRecord(item)
    ? valueText(read(item.recommendation, ["warningState", "status"]))
    : ""
  return (
    /block|failed|error/i.test(`${state} ${recommendationState}`) ||
    collectWarnings(item).blocking !== "None"
  )
}

function isResolved(item: unknown): boolean {
  const state = valueText(read(item, ["status", "state", "resolutionState"]))
  return /^(resolved|completed|closed|dismissed|archived)$/i.test(state)
}

function summarizeCategories(items: readonly unknown[]): string {
  if (items.length === 0) return "None"
  const counts = new Map<string, number>()
  for (const item of items) {
    const category = valueText(
      read(item, ["type", "itemType", "workType", "category"]),
      "Review"
    )
    counts.set(category, (counts.get(category) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([name, count]) => `${name} ${count}`)
    .join(" · ")
}

function inboxRows(item: unknown): ProductRow[] {
  return [
    ["Type", inboxValue(item, ["type", "itemType", "workType"])],
    ["Status", inboxValue(item, ["status", "state"])],
    ["Priority", inboxValue(item, ["priority", "urgency"])],
    ["Source", inboxValue(item, ["source", "sourceSystem", "origin"])],
    ["Owner", inboxValue(item, ["owner", "ownerRole", "role", "assignedTo"])],
    [
      "Updated",
      inboxValue(item, [
        "waitingAge",
        "age",
        "updatedAgo",
        "waiting",
        "updatedAt",
      ]),
    ],
    ["Warning", warningLabel(item)],
  ]
}

function inboxValue(item: unknown, keys: readonly string[]): unknown {
  const direct = read(item, keys)
  if (direct !== undefined) return direct
  const record = recordOrEmpty(item)
  return read(record.resolutionState, keys)
}

function warningLabel(item: unknown): string {
  const warnings = collectWarnings(item)
  if (warnings.blocking !== "None") return `Blocked: ${warnings.blocking}`
  if (warnings.informational !== "None") return warnings.informational
  const warningCount = read(item, ["warningCount"])
  if (typeof warningCount === "number" && warningCount > 0)
    return `${warningCount} warning${warningCount === 1 ? "" : "s"}`
  return "None"
}

function collectWarnings(value: unknown): {
  blocking: string
  informational: string
  all: string
} {
  const blocking: string[] = []
  const informational: string[] = []
  const visit = (
    entry: unknown,
    keyHint = "",
    depth = 0,
    blockingContext = false
  ): void => {
    if (depth > 5 || entry === null || entry === undefined) return
    if (Array.isArray(entry)) {
      entry.forEach((item) => visit(item, keyHint, depth + 1, blockingContext))
      return
    }
    if (isRecord(entry)) {
      const recordBlocking =
        blockingContext ||
        read(entry, ["blocking"]) === true ||
        /block|critical|error/i.test(
          valueText(
            read(entry, ["severity", "level", "warningState", "status"])
          )
        )
      const looksLikeWarning =
        /warning|block/i.test(keyHint) ||
        read(entry, ["severity", "level", "blocking", "warningState"]) !==
          undefined
      if (looksLikeWarning) {
        const text = valueText(
          read(entry, ["message", "summary", "warning", "reason", "title"]),
          ""
        )
        if (text) {
          const severity = valueText(
            read(entry, ["severity", "level", "warningState"])
          )
          const isEntryBlocking =
            recordBlocking ||
            /block|critical|error/i.test(severity) ||
            /block/i.test(keyHint)
          ;(isEntryBlocking ? blocking : informational).push(text)
          return
        }
      }
      for (const [key, child] of Object.entries(entry)) {
        if (/^(?:warningState|warningCount)$/i.test(key)) continue
        if (/warning|block/i.test(key))
          visit(child, key, depth + 1, recordBlocking)
        else if (
          ["contextPacket", "evidence", "recommendation", "item"].includes(key)
        )
          visit(child, key, depth + 1, recordBlocking)
      }
      return
    }
    if (/warning|block/i.test(keyHint)) {
      const text = valueText(entry)
      if (text)
        (blockingContext || /block/i.test(keyHint)
          ? blocking
          : informational
        ).push(text)
    }
  }
  visit(value)
  const uniqueBlocking = [...new Set(blocking)]
  const blockingSet = new Set(uniqueBlocking)
  const uniqueInformational = [...new Set(informational)].filter(
    (warning) => !blockingSet.has(warning)
  )
  const uniqueWarnings = [...uniqueBlocking, ...uniqueInformational]
  return {
    blocking: uniqueBlocking.length > 0 ? uniqueBlocking.join(" · ") : "None",
    informational:
      uniqueInformational.length > 0 ? uniqueInformational.join(" · ") : "None",
    all: uniqueWarnings.length > 0 ? uniqueWarnings.join(" · ") : "None",
  }
}

function stateTransition(value: unknown): unknown {
  const before = read(value, [
    "stateBefore",
    "previousState",
    "fromState",
    "before",
  ])
  const after = read(value, ["stateAfter", "newState", "toState", "after"])
  if (before !== undefined || after !== undefined)
    return `${valueText(before, "Unknown")} -> ${valueText(after, "Unknown")}`
  return read(value, ["stateTransition", "state", "status"])
}

function hasMockIdentifier(value: unknown): boolean {
  const identifier = valueText(
    read(value, ["mockExternalId", "externalId", "externalRecordId"])
  )
  return /^mock(?:_|-)/i.test(identifier)
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

function isSandboxSession(value: unknown): value is Record<string, unknown> {
  return (
    isRecord(value) &&
    value.mode === "sandbox" &&
    value.ephemeral === true &&
    Array.isArray(value.sources) &&
    Array.isArray(value.candidates)
  )
}

function isWorkspaceSandboxRun(
  value: unknown
): value is Record<string, unknown> {
  return (
    isRecord(value) &&
    value.mode === "sandbox" &&
    value.ephemeral === true &&
    isRecord(value.proof) &&
    value.proof.scope === "sandbox_execution"
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
  if (new Set(["mock", "sandbox"]).has(mode.toLowerCase())) return "Sandbox"
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
