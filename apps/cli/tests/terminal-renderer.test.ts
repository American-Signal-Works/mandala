import { describe, expect, it } from "vitest"
import {
  renderAssistantMessage,
  renderDraftPreview,
  renderHeader,
  renderHumanResult,
  renderInboxSummary,
  sanitizeTerminalText,
} from "../src/terminal/index.js"

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
