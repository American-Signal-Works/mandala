import { describe, expect, it } from "vitest"
import {
  renderActivityHistory,
  renderAssistantMessage,
  renderDecisionResult,
  renderDraftPreview,
  renderEvidenceSummary,
  renderExecutionResult,
  renderHeader,
  renderHomeSummary,
  renderHumanResult,
  renderInbox,
  renderInboxItemOverview,
  renderInboxSummary,
  renderProcurementReview,
  sanitizeTerminalText,
} from "../src/terminal/index.js"
import { terminalTextWidth, wrapTerminalText } from "../src/terminal/table.js"

const itemId = "40000000-0000-4000-8000-000000000001"
const draftId = "50000000-0000-4000-8000-000000000001"

describe("terminal renderer", () => {
  it("renders assistant prose safely without a data table", () => {
    const output = renderAssistantMessage(
      "Hello\u001b[2J. What would you like to work on?",
      { width: 40 }
    )

    expect(output).toContain("Mandala")
    expect(output).toContain("Hello. What would you like")
    expect(output).not.toContain("\u001b")
    expect(output).not.toContain("+---")
  })

  it("preserves readable paragraphs and bullet lines in assistant answers", () => {
    const output = renderAssistantMessage(
      "648 units is reasonable.\n\nWhy:\n- It covers 40 days.\n- Lead time is 26 days.",
      { width: 40 }
    )

    expect(output).toContain(
      "648 units is reasonable.\n\nWhy:\n- It covers 40 days."
    )
    expect(output).toContain("\n- Lead time is 26 days.")
  })

  it("wraps CJK, emoji, and combining graphemes by terminal cell width", () => {
    const output = wrapTerminalText(
      "库存提醒 📦 cafe\u0301 库存提醒 📦 cafe\u0301 库存提醒",
      24
    )

    expect(output).toContain("📦")
    expect(output).toContain("cafe\u0301")
    expect(
      output.split("\n").every((line) => terminalTextWidth(line) <= 24)
    ).toBe(true)
  })

  it("retains every known detail section and unknown nested field", () => {
    const output = renderHumanResult(completeDetail(), { width: 120 })

    for (const section of [
      "Item",
      "Context Packet",
      "Recommendation",
      "Evidence",
      "Draft",
      "Decision",
      "Attempt",
      "Audit Events",
      "futureSection",
    ]) {
      expect(output).toContain(section)
    }
    for (const marker of [
      "source-marker",
      "fact-marker",
      "memory-marker",
      "output-marker",
      "evidence-marker",
      "payload-marker",
      "policy-marker",
      "result-marker",
      "audit-marker",
      "future-marker",
    ]) {
      expect(output).toContain(marker)
    }
    expect(output).toContain(itemId)
    expect(output).toContain(draftId)
  })

  it("fits nested data at 40, 80, and 120 columns without truncating values", () => {
    for (const width of [40, 80, 120]) {
      const output = renderHumanResult(
        {
          deeplyNested: {
            identifier: itemId,
            message: "a long value that must wrap instead of being elided",
          },
        },
        { width }
      )

      expect(
        Math.max(...output.split("\n").map((line) => line.length))
      ).toBeLessThanOrEqual(width)
      expect(output).toContain("Field")
      expect(output).toContain("Type")
      expect(output).not.toContain("...")
    }
  })

  it("renders uniform record arrays as generated grids", () => {
    const output = renderHumanResult(
      [
        { code: "A-1", active: true, quantity: 2 },
        { code: "B-2", active: false, quantity: 0 },
      ],
      { title: "Lines", width: 80 }
    )

    expect(output).toContain("| #")
    expect(output).toContain("code")
    expect(output).toContain("active")
    expect(output).toContain("quantity")
    expect(output).toContain("true")
    expect(output).toContain("false")
  })

  it("keeps narrow work-list row numbers visibly one-based", () => {
    const output = renderHumanResult(
      {
        items: [
          {
            id: itemId,
            status: "active",
            title: "Review purchase order",
          },
        ],
      },
      { width: 40 }
    )

    expect(output).toContain("Row 1")
    expect(output).toContain("row")
    expect(output).not.toContain("[0].id")
    expect(
      Math.max(...output.split("\n").map((line) => line.length))
    ).toBeLessThanOrEqual(40)
  })

  it("renders explicit null and empty states", () => {
    const output = renderHumanResult(
      { missing: null, emptyObject: {}, emptyArray: [] },
      { width: 80 }
    )

    expect(output).toContain("null")
    expect(output).toContain("(empty)")
    expect(output).toContain("{}")
    expect(output).toContain("[]")
    expect(renderHumanResult(null)).toContain("(none)")
    expect(renderHumanResult([])).toContain("(empty)")
  })

  it("redacts secrets before draft and generic tables are constructed", () => {
    const secret = "must-not-render"
    const draft = {
      id: draftId,
      payload: {
        rawToken: secret,
        nested: { authorization: `Bearer ${secret}` },
      },
      editPolicy: { codeVerifier: secret },
    }
    const preview = renderDraftPreview(draft, { width: 120 })
    const generic = renderHumanResult({ draft }, { width: 120 })

    expect(preview).not.toContain(secret)
    expect(generic).not.toContain(secret)
    expect(preview).toContain("[REDACTED]")
    expect(generic).toContain("[REDACTED]")
  })

  it("removes CSI, OSC, C0, C1, carriage-return, and backspace injection", () => {
    const malicious =
      "safe\u001b[31m-red\u001b[0m\u001b]8;;https://evil.test\u0007-click\u001b]8;;\u0007\u009b32m-green\u0000\r\b-end"
    const sanitized = sanitizeTerminalText(malicious)
    const output = renderHumanResult({ message: malicious }, { width: 80 })

    expect(sanitized).toBe("safe-red-click-green-end")
    expect(output).toContain("safe-red-click-green-end")
    expect(hasUnsafeControls(output)).toBe(false)
  })

  it("renders compact header context and inbox summary states", () => {
    const header = renderHeader(
      {
        companyName: "Mandala Local Demo",
        inboxCount: 3,
        mode: "mock",
        userEmail: "seed@example.com",
        warningCount: 2,
      },
      { width: 80 }
    )

    expect(header).toContain("▝▜▌▐▙▟▙▟▌▜▛▘")
    expect(header).toContain("Mandala")
    expect(header).toContain("Mandala Local Demo")
    expect(header).toContain("Sandbox")
    expect(header).toContain("3 items need review · 2 with warnings")
    expect(
      renderHeader({}, { color: false, width: 40 }).split("\n").slice(0, 7)
    ).toEqual([
      " ▗▖   ▐▌   ▗▖",
      " ▝▜▌▐▙▟▙▟▌▜▛▘",
      "  ▐▙▖▝▘▝▘▄▟▌",
      "▐▌▐█▌ ▜▌ ▐█▌▜▌",
      "  ▐▛▘▗▖▗▖▝▜▌",
      " ▗▟▌▜▛▜▛▜▌▐▙▖",
      " ▝▘   ▐▌   ▝▘",
    ])
    expect(renderInboxSummary([], 40)).toBe("Inbox clear")
    expect(
      renderInboxSummary(
        [{ warningCount: 2 }, { warningCount: 0 }, { warnings: ["stale"] }],
        80
      )
    ).toBe("3 items need your review - 2 have warnings.  /inbox")
  })

  it("uses optional semantic header color without making it required", () => {
    const context = {
      companyName: "Mandala Local Demo",
      mode: "mock",
      userEmail: "seed@example.com",
    }
    const colored = renderHeader(context, { color: true, width: 80 })
    const plain = renderHeader(context, { color: false, width: 80 })

    expect(colored).toContain("\u001b[")
    expect(colored.split("\n").map(sanitizeTerminalText).join("\n")).toBe(plain)
    expect(plain).not.toContain("\u001b[")
  })

  it.each([40, 80, 120])(
    "keeps the work-context header within %s columns",
    (width) => {
      const header = renderHeader(
        {
          companyName: "Mandala Local Demo With A Very Long Company Name",
          inboxCount: 12,
          mode: "mock",
          userEmail: "seed@example.com",
          warningCount: 3,
        },
        { color: false, width }
      )

      expect(header).toContain("▝▜▌▐▙▟▙▟▌▜▛▘")
      expect(header).toContain("12 items need review")
      expect(header.split("\n").every((line) => line.length <= width)).toBe(
        true
      )
    }
  )

  it.each([40, 80, 120])(
    "renders the product review flow within %s columns",
    (width) => {
      const detail = productDetail()
      const outputs = [
        renderHomeSummary(
          {
            context: {
              companyName: "Mandala Local Demo",
              mode: "mock",
            },
            items: [
              detail.item,
              {
                title: "Old completed work",
                status: "resolved",
                type: "Status",
              },
            ],
            itemCount: 1,
            warningCount: 2,
          },
          { width }
        ),
        renderInbox(
          { items: [detail.item, { title: "Done", status: "resolved" }] },
          { width }
        ),
        renderInboxItemOverview(detail, { width }),
        renderProcurementReview(detail, { width }),
        renderEvidenceSummary(detail, { width }),
        renderDecisionResult(detail, { width }),
        renderExecutionResult(detail, { width }),
        renderActivityHistory(detail, { width }),
      ]

      for (const output of outputs) {
        expect(output).not.toContain("\u001b")
        expect(output.split("\n").every((line) => line.length <= width)).toBe(
          true
        )
      }
      expect(outputs[0]).toContain("Workspace")
      expect(outputs[1]).toContain("1 active")
      expect(outputs[1]).not.toContain("Done")
      expect(outputs[2]).toContain("Why it exists")
      expect(outputs[3]).toContain("Current stock")
      expect(outputs[4]).toContain("Memory provenance")
      expect(outputs[5]).toContain("APPROVE")
      expect(outputs[6]).toContain("MOCK ONLY")
      expect(outputs[7]).toContain("audit-marker")
    }
  )

  it("projects canonical procurement facts, evidence, and warning severity", () => {
    const detail = productDetail()
    const review = renderProcurementReview(detail, { width: 120 })
    const evidence = renderEvidenceSummary(detail, { width: 120 })

    for (const marker of [
      "8 units",
      "31 units / 30 days",
      "12 units",
      "24",
      "Acme Supply",
      "ShipHero inventory",
    ]) {
      expect(`${review}\n${evidence}`).toContain(marker)
    }
    expect(review).toContain("Warning · Blocking")
    expect(review).toContain("Vendor is missing a destination code")
    expect(review).toContain("Warning · Informational")
    expect(review).toContain("Sales increased 42%")
    expect(evidence).toContain("Current as of 10:42 AM")
  })

  it("makes mock execution unmistakable and supports confirmation previews", () => {
    const preview = renderExecutionResult(
      {
        preview: true,
        actionType: "create_purchase_order",
        draft: {
          payload: { vendor: "Acme Supply", quantity: 24 },
        },
        mode: "mock",
        status: "awaiting_confirmation",
      },
      { width: 80 }
    )
    const decision = renderDecisionResult(
      {
        preview: true,
        decision: "approve",
        reason: "Inventory checks confirmed",
        warningsAcknowledged: true,
      },
      { width: 80 }
    )

    expect(preview).toContain("Approval execution · MOCK")
    expect(preview).toContain("create_purchase_order")
    expect(preview).toContain("No live external record was created")
    expect(decision).toContain("APPROVE")
    expect(decision).toContain("Confirm decision")
    expect(decision).toContain("Inventory checks confirmed")
    expect(decision).not.toContain("Decision recorded")
  })

  it("treats canonical blocked recommendation warnings as blocking", () => {
    const detail = productDetail()
    const output = renderEvidenceSummary(
      {
        ...detail,
        recommendation: {
          ...detail.recommendation,
          warningState: "blocked",
          warnings: ["Destination code is missing."],
        },
        evidence: {
          ...detail.evidence,
          warnings: ["Destination code is missing."],
        },
      },
      { width: 100 }
    )

    expect(output).toContain("Warning · Blocking")
    expect(output).toContain("Destination code is missing.")
    expect(output).not.toContain("Blocking          None")
    expect(output).not.toMatch(
      /Warning · Informational\s+Destination code is missing\./
    )
  })

  it("redacts and sanitizes every product projection before rendering", () => {
    const secret = "must-not-render-product"
    const malicious = `safe\u001b[2J authorization Bearer ${secret}`
    const input = {
      companyName: malicious,
      items: [{ title: malicious, warnings: [malicious] }],
      item: { title: malicious },
      recommendation: { rationaleSummary: malicious },
      evidence: { assumptions: [malicious] },
      decision: { kind: "approve", reason: malicious },
      attempt: {
        mode: "mock",
        status: "succeeded",
        mockExternalId: malicious,
      },
      auditEvents: [{ summary: malicious }],
      rawToken: secret,
    }
    const outputs = [
      renderHomeSummary(input),
      renderInbox(input),
      renderInboxItemOverview(input),
      renderProcurementReview(input),
      renderEvidenceSummary(input),
      renderDecisionResult(input),
      renderExecutionResult(input),
      renderActivityHistory(input),
    ]

    for (const output of outputs) {
      expect(output).not.toContain(secret)
      expect(hasUnsafeControls(output)).toBe(false)
    }
  })
})

function completeDetail() {
  return {
    item: {
      id: itemId,
      title: "Review purchase order",
      status: "pending_review",
      priority: 50,
      resolutionState: { owner: "ops" },
    },
    contextPacket: {
      sources: [{ source: "source-marker" }],
      facts: { note: "fact-marker" },
      memoryRefs: [{ ref: "memory-marker" }],
      warnings: [],
    },
    recommendation: {
      rationaleSummary: "order now",
      confidence: 0.91,
      output: { note: "output-marker" },
    },
    evidence: {
      assumptions: ["stable demand"],
      evidence: [{ note: "evidence-marker" }],
    },
    draft: {
      id: draftId,
      payload: {
        note: "payload-marker",
        lines: [{ sku: "TEA-1", quantity: 12 }],
      },
      editPolicy: { note: "policy-marker" },
    },
    decision: { decision: "approve", warningsAcknowledged: true },
    attempt: { status: "succeeded", resultPayload: { note: "result-marker" } },
    auditEvents: [{ eventType: "executed", summary: "audit-marker" }],
    futureSection: { nested: [{ preserved: "future-marker" }] },
  }
}

function productDetail() {
  return {
    item: {
      id: itemId,
      title: "Reorder review · SKU-1042",
      type: "Review",
      status: "active",
      priority: "urgent",
      source: "ShipHero",
      ownerRole: "Inventory manager",
      waitingAge: "2h",
      requiredAttention: "Review the proposed reorder",
      nextAction: "Approve, edit, request rework, or reject",
    },
    contextPacket: {
      trigger: "Stock is below the reorder point",
      sources: ["ShipHero inventory", "Shopify sales"],
      sourceRefs: ["inventory/SKU-1042", "sales/SKU-1042"],
      freshnessState: "Current as of 10:42 AM",
      createdAt: "2026-07-12T10:42:00-07:00",
      facts: {
        availableInventory: "8 units",
        reorderPoint: "12 units",
        recent30DaySales: "31 units / 30 days",
        openPOs: "None",
      },
      blockingWarnings: [
        {
          blocking: true,
          message: "Vendor is missing a destination code",
        },
      ],
      warnings: [
        {
          severity: "informational",
          message: "Sales increased 42%",
        },
      ],
      memoryRefs: ["prior approved reorder"],
    },
    recommendation: {
      rationaleSummary: "Order 24 units from Acme Supply",
      confidence: 0.91,
      output: {
        recommendedQuantity: 24,
        vendor: "Acme Supply",
        flags: ["unusual sales spike"],
      },
      availableActions: ["Approve", "Edit", "Request rework", "Reject"],
    },
    evidence: {
      trigger: "Below reorder point after a sales spike",
      assumptions: ["Demand remains stable"],
      missingData: ["Destination code"],
      confidence: 0.91,
      memoryProvenance: ["prior approved reorder"],
      rationale: "Stock and recent sales support replenishment",
    },
    draft: {
      id: draftId,
      payload: {
        vendor: "Acme Supply",
        lines: [{ sku: "SKU-1042", quantity: 24 }],
      },
    },
    decision: {
      kind: "approve",
      actorEmail: "seed@example.com",
      reason: "Inventory and open-PO checks confirmed",
      decidedAt: "2026-07-12T10:45:00-07:00",
      stateBefore: "active",
      stateAfter: "approved",
      warningsAcknowledged: true,
    },
    attempt: {
      status: "succeeded",
      mode: "mock",
      actionType: "create_purchase_order",
      mockExternalId: "mock_po_01J",
      resultPayload: { outcome: "Purchase order simulated" },
      completedAt: "2026-07-12T10:46:00-07:00",
      auditEventId: "evt_01J",
    },
    auditEvents: [
      {
        eventType: "executed",
        createdAt: "2026-07-12T10:46:00-07:00",
        actorEmail: "seed@example.com",
        summary: "Mock execution completed",
        auditReference: "audit-marker",
      },
    ],
  }
}

function hasUnsafeControls(value: string): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0)
    return (
      (code >= 0 && code <= 9) ||
      (code >= 11 && code <= 31) ||
      (code >= 127 && code <= 159)
    )
  })
}
