import { z } from "zod"
import {
  controlIntentCandidateSchema,
  controlIntentSchema,
  type ControlIntentCandidate,
  type ControlIntent,
  type NormalizedControlIntent,
  type ControlOutcome,
  type JsonPointerPatch,
  workflowItemStatusSchema,
} from "./schemas.js"
import { JsonPointerError, parseJsonPointerAssignment } from "./json-pointer.js"

const maxInputLength = 2_000
const uuidSource =
  "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}"
const uuidSchema = z.string().uuid()

export type ControlParserContext = {
  companyId?: string
  warningsPresent?: boolean
  warningsAcknowledged?: boolean
}

export type ControlIntentCandidateInput = {
  kind: ControlIntentCandidate["kind"]
  scenarioId?: string | null
  status?: string | null
  itemId?: string | null
  decision?: "approve" | "edit" | "reject" | "request_rework" | null
  patches?: JsonPointerPatch[]
  reason?: string | null
}

export function createControlIntentCandidate(
  input: ControlIntentCandidateInput
): ControlIntentCandidate {
  return controlIntentCandidateSchema.parse({
    kind: input.kind,
    scenarioId: input.scenarioId ?? null,
    status: input.status ?? null,
    itemId: input.itemId ?? null,
    decision: input.decision ?? null,
    patches: input.patches ?? [],
    reason: input.reason ?? null,
  })
}

export function projectControlIntentForAudit(
  intent: ControlIntent
): NormalizedControlIntent {
  if (intent.kind !== "record_decision") return intent
  const patchPointers = (intent.patches ?? []).map((patch) => patch.pointer)
  return {
    kind: intent.kind,
    companyId: intent.companyId,
    itemId: intent.itemId,
    decision: intent.decision,
    patchPointers,
    patchCount: patchPointers.length,
    warningsAcknowledged: intent.warningsAcknowledged,
    risk: intent.risk,
  }
}

export function resolveControlIntent(
  candidate: ControlIntentCandidate,
  context: ControlParserContext
): ControlOutcome {
  if (!context.companyId || !uuidSchema.safeParse(context.companyId).success) {
    return clarification("Which accessible company should be active?")
  }

  switch (candidate.kind) {
    case "run_fixture": {
      if (!candidate.scenarioId)
        return clarification("Which fixture scenario should run?")
      return resolved({
        kind: "run_fixture",
        companyId: context.companyId,
        scenarioId: candidate.scenarioId,
        risk: "state_change",
      })
    }
    case "list_work_items": {
      const status = candidate.status
        ? workflowItemStatusSchema.safeParse(candidate.status)
        : undefined
      if (status && !status.success)
        return clarification(
          "Which supported work-item status should be listed?"
        )
      return resolved({
        kind: "list_work_items",
        companyId: context.companyId,
        status: status?.data,
        risk: "read",
      })
    }
    case "inspect_work_item": {
      if (
        !candidate.itemId ||
        !uuidSchema.safeParse(candidate.itemId).success
      ) {
        return clarification(
          "Which work item should be inspected? Provide its full ID."
        )
      }
      return resolved({
        kind: "inspect_work_item",
        companyId: context.companyId,
        itemId: candidate.itemId,
        risk: "read",
      })
    }
    case "record_decision": {
      if (
        !candidate.itemId ||
        !uuidSchema.safeParse(candidate.itemId).success
      ) {
        return clarification(
          "Which work item should receive the decision? Provide its full ID."
        )
      }
      if (!candidate.decision)
        return clarification(
          "Should this item be approved, edited, rejected, or sent for rework?"
        )
      if (candidate.decision === "edit" && !candidate.patches.length) {
        return clarification(
          "Which JSON Pointer assignment should be applied to the draft?"
        )
      }
      if (
        ["edit", "reject", "request_rework"].includes(candidate.decision) &&
        !candidate.reason?.trim()
      ) {
        return clarification(
          "What reason should be recorded with this decision?"
        )
      }
      if (
        ["approve", "edit"].includes(candidate.decision) &&
        context.warningsPresent &&
        !context.warningsAcknowledged
      ) {
        return clarification(
          "Acknowledge the current warnings before approving this draft."
        )
      }
      return resolved({
        kind: "record_decision",
        companyId: context.companyId,
        itemId: candidate.itemId,
        decision: candidate.decision,
        patches: candidate.patches.length ? candidate.patches : undefined,
        reason: candidate.reason?.trim(),
        warningsAcknowledged: context.warningsAcknowledged ?? false,
        risk: "state_change",
      })
    }
    case "execute_mock_action": {
      if (
        !candidate.itemId ||
        !uuidSchema.safeParse(candidate.itemId).success
      ) {
        return clarification(
          "Which approved work item should execute in mock mode? Provide its full ID."
        )
      }
      return resolved({
        kind: "execute_mock_action",
        companyId: context.companyId,
        itemId: candidate.itemId,
        risk: "mock_execution",
      })
    }
  }
}

export function parseControlPhrase(
  input: string,
  context: ControlParserContext = {}
): ControlOutcome {
  const phrase = input.trim()
  const unsafe = validatePhrase(phrase)
  if (unsafe) return unsafe
  if (!phrase) return clarification("What would you like to do?")

  let match =
    /^(?:list|show)\s+(?:work|work items?)(?:\s+(?:with\s+)?status\s+([a-z_]+))?$/i.exec(
      phrase
    )
  if (match)
    return resolveControlIntent(
      createControlIntentCandidate({
        kind: "list_work_items",
        status: match[1]?.toLowerCase(),
      }),
      context
    )

  match = new RegExp(
    `^(?:inspect|show)\\s+(?:work(?: item)?\\s+)?(${uuidSource})$`,
    "i"
  ).exec(phrase)
  if (match)
    return resolveControlIntent(
      createControlIntentCandidate({
        kind: "inspect_work_item",
        itemId: match[1],
      }),
      context
    )

  match =
    /^(?:run|start)\s+fixture(?:\s+([A-Za-z0-9][A-Za-z0-9._:-]*))?$/i.exec(
      phrase
    )
  if (match)
    return resolveControlIntent(
      createControlIntentCandidate({
        kind: "run_fixture",
        scenarioId: match[1],
      }),
      context
    )

  match = new RegExp(
    `^approve(?:\\s+work(?: item)?)?\\s+(${uuidSource})(?:\\s+(ack(?:nowledge)? warnings))?$`,
    "i"
  ).exec(phrase)
  if (match) {
    return resolveControlIntent(
      createControlIntentCandidate({
        kind: "record_decision",
        itemId: match[1],
        decision: "approve",
      }),
      { ...context, warningsAcknowledged: Boolean(match[2]) }
    )
  }

  match = new RegExp(
    `^(reject|rework)(?:\\s+work(?: item)?)?\\s+(${uuidSource})(?:\\s+(?:because|reason)\\s+(.+))?$`,
    "i"
  ).exec(phrase)
  if (match) {
    return resolveControlIntent(
      createControlIntentCandidate({
        kind: "record_decision",
        itemId: match[2],
        decision:
          match[1]?.toLowerCase() === "reject" ? "reject" : "request_rework",
        reason: match[3],
      }),
      context
    )
  }

  match = new RegExp(
    `^execute(?:\\s+work(?: item)?)?\\s+(${uuidSource})$`,
    "i"
  ).exec(phrase)
  if (match)
    return resolveControlIntent(
      createControlIntentCandidate({
        kind: "execute_mock_action",
        itemId: match[1],
      }),
      context
    )

  match = new RegExp(
    `^edit(?:\\s+work(?: item)?)?\\s+(${uuidSource})\\s+set\\s+([^\\s]+=[^\\s]+)(?:\\s+reason\\s+(.+))?$`,
    "i"
  ).exec(phrase)
  if (match) {
    try {
      const patch = parseJsonPointerAssignment(match[2] ?? "")
      return resolveControlIntent(
        createControlIntentCandidate({
          kind: "record_decision",
          itemId: match[1],
          decision: "edit",
          patches: [patch],
          reason: match[3],
        }),
        context
      )
    } catch (error) {
      if (error instanceof JsonPointerError) return clarification(error.message)
      return blocked("invalid_edit", "The edit could not be parsed safely.")
    }
  }

  if (/^(?:inspect|show)(?:\s+work(?: item)?)?$/i.test(phrase)) {
    return clarification(
      "Which work item should be inspected? Provide its full ID."
    )
  }
  if (
    /^(?:approve|reject|rework|execute|edit)(?:\s+work(?: item)?)?$/i.test(
      phrase
    )
  ) {
    return clarification(
      "Which work item should this command target? Provide its full ID."
    )
  }

  return blocked(
    "unsupported_command",
    "The phrase does not match a supported bounded command."
  )
}

function validatePhrase(phrase: string): ControlOutcome | null {
  if (phrase.length > maxInputLength)
    return blocked(
      "input_too_large",
      `Commands are limited to ${maxInputLength} characters.`
    )
  if (
    [...phrase].some((character) =>
      isDisallowedControl(character.charCodeAt(0))
    )
  ) {
    return blocked(
      "invalid_control_character",
      "Commands cannot contain control characters."
    )
  }
  if (/\r|\n|&&|\|\||[;`]|\$\(|(?:^|\s)[<>](?:\s|$)/.test(phrase)) {
    return blocked(
      "multi_action_or_shell_syntax",
      "Multi-action and shell-like syntax is not supported."
    )
  }
  if (
    /\b(?:ignore|disregard|override)\b.{0,40}\b(?:instructions?|prompt|policy|rules?)\b|\b(?:system prompt|developer message)\b/i.test(
      phrase
    )
  ) {
    return blocked(
      "prompt_injection",
      "Instructions that attempt to override parser policy are not supported."
    )
  }
  if (
    /\b(?:switch|change|override|use)\s+(?:the\s+)?(?:company|tenant|organization)\b|\b(?:company|tenant|organization)\s+(?:id\s+)?[0-9a-f]{8}-/i.test(
      phrase
    )
  ) {
    return blocked(
      "company_override_not_allowed",
      "Company context must be selected outside the conversational command."
    )
  }
  if (hasMultipleActionKinds(phrase)) {
    return blocked(
      "multiple_actions_not_supported",
      "Submit one workflow action at a time."
    )
  }
  return null
}

function hasMultipleActionKinds(phrase: string): boolean {
  const patterns = [
    /\b(?:run|start)\b.{0,30}\bfixture\b/i,
    /\blist\b.{0,30}\b(?:work|items?)\b/i,
    /\b(?:inspect|show)\b.{0,30}\b(?:work|item)\b/i,
    /\bapprove\b/i,
    /\breject\b/i,
    /\b(?:rework|send\s+back)\b/i,
    /\b(?:edit|change|update|set)\b/i,
    /\bexecute\b/i,
  ]
  return patterns.filter((pattern) => pattern.test(phrase)).length > 1
}

function isDisallowedControl(code: number): boolean {
  return (
    code <= 8 ||
    code === 11 ||
    code === 12 ||
    (code >= 14 && code <= 31) ||
    code === 127
  )
}

function resolved(intent: ControlIntent): ControlOutcome {
  const parsed = controlIntentSchema.safeParse(intent)
  if (!parsed.success)
    return blocked(
      "invalid_intent",
      "The command could not be normalized into a valid intent."
    )
  return {
    status: "resolved",
    intent: parsed.data,
    confirmationRequired: parsed.data.risk !== "read",
  }
}

function clarification(question: string): ControlOutcome {
  return {
    status: "clarification_required",
    questions: [question],
    confirmationRequired: false,
  }
}

function blocked(reasonCode: string, reason: string): ControlOutcome {
  return {
    status: "blocked",
    reasonCode,
    reasons: [reason],
    confirmationRequired: false,
  }
}
