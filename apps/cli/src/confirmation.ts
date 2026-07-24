import { createInterface } from "node:readline/promises"
import type { Readable, Writable } from "node:stream"
import type { ControlIntent, WorkItemDetail } from "@workspace/control-plane"
import { CliError } from "./errors.js"
import { redactSecrets } from "./output.js"
import { renderDraftPreview, renderHumanResult } from "./terminal/index.js"

export type ActionDraftPreview = NonNullable<WorkItemDetail["draft"]>

export type ConfirmationContext = {
  intent: ControlIntent
  companyName: string
  item?: WorkItemDetail["item"]
  warnings?: string[]
  changes?: Array<{ pointer: string; value: unknown }>
  actionType?: string
  draft?: ActionDraftPreview
}

export type ConfirmMutation = (context: ConfirmationContext) => Promise<boolean>

export function confirmationDisplay(context: ConfirmationContext) {
  return {
    actionType: context.actionType ?? null,
    changes: (context.changes ?? []).map((change) => ({
      pointer: change.pointer,
      value: redactPointerValue(change.pointer, change.value),
    })),
    company: context.companyName,
    intent: redactIntent(context.intent),
    mode: "mock",
    selectedItem: context.item ?? null,
    warnings: context.warnings ?? [],
  }
}

export function createInteractiveConfirmation(
  input: Readable,
  output: Writable
): ConfirmMutation {
  return async (context) => {
    if (
      !(input as Readable & { isTTY?: boolean }).isTTY ||
      !(output as Writable & { isTTY?: boolean }).isTTY
    ) {
      throw new CliError(
        "interactive_confirmation_required",
        "Mutating commands require an interactive terminal confirmation."
      )
    }

    const width = (output as Writable & { columns?: number }).columns
    output.write("\n")
    output.write(
      `${renderHumanResult(
        {
          confirmation: confirmationDisplay(context),
        },
        { title: "Confirm State-Changing Command", width }
      )}\n`
    )
    if (context.draft) {
      output.write(`${renderDraftPreview(context.draft, { width })}\n`)
    }

    const prompt = createInterface({ input, output })
    try {
      const answer = (await askForConfirmation(prompt, input))
        .trim()
        .toLowerCase()
      return answer === "y" || answer === "yes"
    } finally {
      prompt.close()
    }
  }
}

function askForConfirmation(
  prompt: ReturnType<typeof createInterface>,
  input: Readable
): Promise<string> {
  return new Promise((resolve, reject) => {
    let closeTimer: ReturnType<typeof setImmediate> | undefined
    const failClosed = () => {
      closeTimer ??= setImmediate(() => {
        cleanup()
        reject(
          new CliError(
            "interactive_confirmation_required",
            "The interactive confirmation ended before an answer was received."
          )
        )
      })
    }
    const cleanup = () => {
      if (closeTimer) clearImmediate(closeTimer)
      input.off("end", failClosed)
      input.off("close", failClosed)
      input.off("error", failClosed)
      prompt.off("error", failClosed)
    }

    input.once("end", failClosed)
    input.once("close", failClosed)
    input.once("error", failClosed)
    prompt.once("error", failClosed)
    prompt.question("Continue? [y/N] ").then((answer) => {
      cleanup()
      resolve(answer)
    }, failClosed)
  })
}

function redactIntent(intent: ControlIntent): unknown {
  if (intent.kind !== "record_decision" || !intent.patches) {
    return redactSecrets(intent)
  }
  return redactSecrets({
    ...intent,
    patches: intent.patches.map((patch) => ({
      ...patch,
      value: redactPointerValue(patch.pointer, patch.value),
    })),
  })
}

function redactPointerValue(pointer: string, value: unknown): unknown {
  const encodedKey = pointer.split("/").at(-1) ?? ""
  const key = encodedKey.replaceAll("~1", "/").replaceAll("~0", "~")
  const wrapped = redactSecrets({ [key]: value }) as Record<string, unknown>
  return wrapped[key]
}
