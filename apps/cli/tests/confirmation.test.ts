import { PassThrough, Readable, Writable } from "node:stream"
import { describe, expect, it } from "vitest"
import { createInteractiveConfirmation } from "../src/confirmation.js"

const companyId = "20000000-0000-4000-8000-000000000001"
const runId = "30000000-0000-4000-8000-000000000001"
const itemId = "40000000-0000-4000-8000-000000000001"
const draftId = "50000000-0000-4000-8000-000000000001"

describe("interactive confirmation", () => {
  it("shows a complete redacted draft preview before accepting", async () => {
    const input = Readable.from(["yes\n"]) as Readable & { isTTY: boolean }
    input.isTTY = true
    const output = new CaptureTty()
    const confirm = createInteractiveConfirmation(input, output)

    await expect(
      confirm({
        companyName: "Mandala Local Demo",
        intent: {
          kind: "record_decision",
          companyId,
          itemId,
          decision: "approve",
          warningsAcknowledged: false,
          risk: "state_change",
        },
        actionType: "execute_mock_purchase_order",
        draft: {
          id: draftId,
          workflowRunId: runId,
          workflowItemId: itemId,
          actionType: "execute_mock_purchase_order",
          status: "pending_review",
          payload: {
            vendor: "Fixture Tea Supply",
            lines: [{ sku: "MDL-TEA-001", quantity: 144 }],
            rawToken: "must-not-render",
          },
          editPolicy: { editable: true },
          updatedAt: "2026-07-09T12:00:00.000Z",
        },
      })
    ).resolves.toBe(true)

    expect(output.value).toContain("Draft Preview")
    expect(output.value).toContain("quantity")
    expect(output.value).toContain("144")
    expect(output.value).toContain("Editable")
    expect(output.value).toContain("true")
    expect(output.value).toContain("rawToken")
    expect(output.value).toContain("[REDACTED]")
    expect(output.value).not.toContain("must-not-render")
  })

  it("redacts secret edit values from the intent and change summary", async () => {
    const input = ttyInput(["yes\n"])
    const output = new CaptureTty()
    const confirm = createInteractiveConfirmation(input, output)

    await expect(
      confirm({
        companyName: "Mandala Local Demo",
        intent: {
          kind: "record_decision",
          companyId,
          itemId,
          decision: "edit",
          patches: [{ pointer: "/rawToken", value: "must-not-render" }],
          reason: "Replace the expired capability",
          warningsAcknowledged: false,
          risk: "state_change",
        },
        changes: [{ pointer: "/rawToken", value: "must-not-render" }],
      })
    ).resolves.toBe(true)

    expect(output.value).toContain("/rawToken")
    expect(output.value).toContain("[REDACTED]")
    expect(output.value).not.toContain("must-not-render")
  })

  it("returns false for a negative response", async () => {
    const confirm = createInteractiveConfirmation(
      ttyInput(["no\n"]),
      new CaptureTty()
    )

    await expect(confirm(baseContext())).resolves.toBe(false)
  })

  it("rejects non-interactive input", async () => {
    const input = Readable.from(["yes\n"])
    const confirm = createInteractiveConfirmation(input, new CaptureTty())

    await expect(confirm(baseContext())).rejects.toMatchObject({
      code: "interactive_confirmation_required",
    })
  })

  it("fails closed when input ends before an answer", async () => {
    const input = new PassThrough() as PassThrough & { isTTY: boolean }
    input.isTTY = true
    const confirm = createInteractiveConfirmation(input, new CaptureTty())
    const result = confirm(baseContext())
    input.end()

    await expect(result).rejects.toMatchObject({
      code: "interactive_confirmation_required",
    })
  })
})

function baseContext() {
  return {
    companyName: "Mandala Local Demo",
    intent: {
      kind: "execute_mock_action" as const,
      companyId,
      itemId,
      risk: "mock_execution" as const,
    },
  }
}

function ttyInput(chunks: string[]): Readable & { isTTY: boolean } {
  const input = Readable.from(chunks) as Readable & { isTTY: boolean }
  input.isTTY = true
  return input
}

class CaptureTty extends Writable {
  readonly isTTY = true
  value = ""

  override _write(
    chunk: Buffer | string,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void
  ): void {
    this.value += chunk.toString()
    callback()
  }
}
