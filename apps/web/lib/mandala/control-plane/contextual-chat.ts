import {
  contextualChatResponseSchema,
  type ContextualChatRequest,
  type ContextualChatResponse,
  type ControlOutcome,
} from "@workspace/control-plane"

export type ContextualChatDependencies = {
  getReviewVersion: (itemId: string) => Promise<string>
  answerQuestion: (itemId: string, question: string) => Promise<string>
  parseCommand: (phrase: string) => Promise<ControlOutcome>
}

export async function routeContextualChat(
  request: ContextualChatRequest,
  dependencies: ContextualChatDependencies
): Promise<ContextualChatResponse> {
  const selectedItemId = request.selectedItemId
  let reviewVersion: string | null = null

  if (selectedItemId) {
    reviewVersion = await dependencies.getReviewVersion(selectedItemId)
    if (
      request.expectedReviewVersion &&
      request.expectedReviewVersion !== reviewVersion
    ) {
      return response(request, {
        route: "blocked",
        message:
          "That work item changed since you opened it. Refresh it before continuing.",
        selectedItemId,
        reviewVersion,
      })
    }

    if (isReadOnlyQuestion(request.input) && !isExplicitAction(request.input)) {
      return response(request, {
        route: "question",
        message: await dependencies.answerQuestion(
          selectedItemId,
          request.input
        ),
        selectedItemId,
        reviewVersion,
      })
    }
  }

  const phrase = selectedItemId
    ? bindSelectedItem(request.input, selectedItemId)
    : request.input
  const outcome = await dependencies.parseCommand(phrase)
  if (outcome.status === "clarification_required") {
    return response(request, {
      route: "clarification",
      message: outcome.questions.join(" "),
      selectedItemId,
      reviewVersion,
    })
  }
  if (outcome.status === "blocked") {
    return response(request, {
      route: "blocked",
      message: outcome.reasons.join(" "),
      selectedItemId,
      reviewVersion,
    })
  }
  return contextualChatResponseSchema.parse({
    route: "command",
    message: outcome.confirmationRequired
      ? "I understood the requested action. Review and confirm it before anything changes."
      : "I understood the request.",
    companyId: request.companyId,
    selectedItemId,
    reviewVersion,
    command: outcome.intent,
    confirmationRequired: outcome.confirmationRequired,
    mutated: false,
  })
}

function response(
  request: ContextualChatRequest,
  value: Pick<
    ContextualChatResponse,
    "route" | "message" | "selectedItemId" | "reviewVersion"
  >
): ContextualChatResponse {
  return contextualChatResponseSchema.parse({
    ...value,
    companyId: request.companyId,
    command: null,
    confirmationRequired: false,
    mutated: false,
  })
}

export function isReadOnlyQuestion(input: string): boolean {
  const normalized = input.trim()
  return (
    normalized.endsWith("?") ||
    /^(?:who|what|when|where|why|how|is|are|am|was|were|can|could|should|would|will|do|does|did|has|have|had)\b/i.test(
      normalized
    ) ||
    /^(?:tell me|explain|describe|assess|evaluate|walk me through)\b/i.test(
      normalized
    )
  )
}

function isExplicitAction(input: string): boolean {
  return /\b(?:approve|reject|resolve|rework|edit|change|update|execute|perform|run|activate|pause|resume|disable|rollback)\b/i.test(
    input
  )
}

function bindSelectedItem(input: string, selectedItemId: string): string {
  if (
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i.test(
      input
    )
  )
    return input
  if (/\b(?:do not|don't|not|never)\b/i.test(input)) return input
  if (/\bapprove\b/i.test(input)) return `approve work item ${selectedItemId}`
  if (/\bresolve\b/i.test(input)) return `resolve work item ${selectedItemId}`
  if (/\bexecute\b/i.test(input)) return `execute work item ${selectedItemId}`

  const reasoned = /\b(reject|rework)\b.*?\b(?:because|reason)\b\s+(.+)/i.exec(
    input
  )
  if (reasoned) {
    return `${reasoned[1]!.toLowerCase()} work item ${selectedItemId} because ${reasoned[2]!.trim()}`
  }
  if (/\breject\b/i.test(input)) return `reject work item ${selectedItemId}`
  if (/\brework\b/i.test(input)) return `rework work item ${selectedItemId}`
  return `${input.trim()} for work item ${selectedItemId}`
}
