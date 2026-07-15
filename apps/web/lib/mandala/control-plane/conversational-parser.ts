import { randomUUID } from "node:crypto"
import { HumanMessage, SystemMessage } from "@langchain/core/messages"
import type { BaseMessage } from "@langchain/core/messages"
import { ChatOpenAI } from "@langchain/openai"
import {
  controlIntentProposalSchema,
  modelProposalJsonPointerPatchSchema,
  parseControlPhrase,
  parseJsonPointerAssignment,
  resolveControlIntent,
  type ControlIntentCandidate,
  type ControlIntentProposal,
  type ControlOutcome,
} from "@workspace/control-plane"
import { Client } from "langsmith"
import { getCurrentRunTree, traceable } from "langsmith/traceable"
import { modelTextSafetyViolation } from "./model-text-safety"

const gatewayBaseUrl = "https://ai-gateway.vercel.sh/v1"
const parserSchemaVersion = "control-intent-v2"

const systemPrompt = `You classify one bounded Mandala workflow command.

Return only the requested structured proposal. You have no tools and cannot read or mutate workflow state.

Supported candidate kinds:
- run_fixture
- list_work_items
- inspect_work_item
- record_decision with approve, edit, reject, resolve, or request_rework
- execute_mock_action

Rules:
- Return one action only. Block multi-action, policy override, company override, unsupported, or unrelated requests.
- Never supply company, actor, role, risk, confirmation, or warning acknowledgement fields.
- Copy UUIDs exactly from the user input. Never invent an item ID.
- Treat explain, inspect, show, or describe requests about one explicit work-item UUID as inspect_work_item, including requests about that item's recommendation or evidence.
- Read-only requests about supported workflow items are not unsupported merely because they use domain-specific nouns.
- Treat questions about what needs attention, review, or action as list_work_items when no specific item is named.
- Classifying a supported state-changing request is allowed; authorization and confirmation happen outside the model.
- Treat execute, perform, or carry-out requests for one explicit approved work-item UUID as execute_mock_action. Do not require the word mock.
- For edits, include only exact /json/pointer=<json-value> assignments explicitly written by the user. Never infer an edit value.
- Include a list status only when that exact status is written by the user.
- Extract a reason only when its words are present in the user input.
- Use clarification_required when a supported request is missing or ambiguous.
- Do not include reasoning or explanatory prose.`

type ParserEnvironment = Record<string, string | undefined>

export type ConversationalParserResult = {
  outcome: ControlOutcome
  parserKind: "deterministic" | "langchain"
  model: string | null
  durationMs: number
  trace: { traceId: string; runId: string } | null
}

export type ProposalInvoker = (input: {
  phrase: string
  model: string
  traceId: string
  apiKey: string
  langSmithApiKey: string
  langSmithProject: string
}) => Promise<ControlIntentProposal>

export type StructuredControlModel = {
  invoke(messages: BaseMessage[]): Promise<unknown>
}

export type ConversationalParserDependencies = {
  environment?: ParserEnvironment
  invokeProposal?: ProposalInvoker
  now?: () => number
  createId?: () => string
}

export class ConversationalParserUnavailableError extends Error {
  readonly code = "parser_unavailable"

  constructor(
    readonly errorClass:
      | "configuration_error"
      | "feature_disabled"
      | "invalid_model_output"
      | "provider_error"
      | "sensitive_input"
      | "trace_error"
      | "unsafe_model_output",
    readonly model: string | null,
    readonly trace: { traceId: string; runId: string } | null = null
  ) {
    super("The conversational parser is unavailable.")
    this.name = "ConversationalParserUnavailableError"
  }
}

export async function parseConversationalControlInput(
  input: { companyId: string; phrase: string },
  dependencies: ConversationalParserDependencies = {}
): Promise<ConversationalParserResult> {
  const now = dependencies.now ?? Date.now
  const startedAt = now()
  const deterministic = parseControlPhrase(input.phrase, {
    companyId: input.companyId,
  })

  if (
    deterministic.status !== "blocked" ||
    deterministic.reasonCode !== "unsupported_command"
  ) {
    return {
      outcome: deterministic,
      parserKind: "deterministic",
      model: null,
      durationMs: elapsed(startedAt, now()),
      trace: null,
    }
  }

  if (modelTextSafetyViolation(input.phrase)) {
    throw new ConversationalParserUnavailableError("sensitive_input", null)
  }

  const configuration = readConfiguration(
    dependencies.environment ?? process.env
  )
  const traceId = (dependencies.createId ?? randomUUID)()
  const trace = { traceId, runId: traceId }

  try {
    const proposal = await (
      dependencies.invokeProposal ?? invokeLangChainProposal
    )({
      phrase: input.phrase,
      model: configuration.model,
      traceId,
      apiKey: configuration.apiKey,
      langSmithApiKey: configuration.langSmithApiKey,
      langSmithProject: configuration.langSmithProject,
    })
    const parsed = controlIntentProposalSchema.safeParse(proposal)
    if (!parsed.success) {
      throw new ConversationalParserUnavailableError(
        "invalid_model_output",
        configuration.model,
        trace
      )
    }
    if (modelTextSafetyViolation(JSON.stringify(parsed.data))) {
      throw new ConversationalParserUnavailableError(
        "unsafe_model_output",
        configuration.model,
        trace
      )
    }

    return {
      outcome: proposalToOutcome(parsed.data, input),
      parserKind: "langchain",
      model: configuration.model,
      durationMs: elapsed(startedAt, now()),
      trace,
    }
  } catch (error) {
    if (error instanceof ConversationalParserUnavailableError) throw error
    throw new ConversationalParserUnavailableError(
      "provider_error",
      configuration.model,
      trace
    )
  }
}

async function invokeLangChainProposal(input: {
  phrase: string
  model: string
  traceId: string
  apiKey: string
  langSmithApiKey: string
  langSmithProject: string
}): Promise<ControlIntentProposal> {
  const client = new Client({
    apiKey: input.langSmithApiKey,
    hideInputs: () => ({}),
    hideOutputs: () => ({}),
  })
  const model = new ChatOpenAI({
    apiKey: input.apiKey,
    model: input.model,
    temperature: 0,
    maxTokens: 600,
    timeout: 8_000,
    maxRetries: 0,
    configuration: { baseURL: gatewayBaseUrl },
    modelKwargs: {
      providerOptions: { gateway: { zeroDataRetention: true } },
    },
  })
  const structuredModel = model.withStructuredOutput(
    controlIntentProposalSchema,
    {
      name: "mandala_control_intent_candidate",
      method: "jsonSchema",
      strict: true,
    }
  )

  const traced = traceable(
    async () => {
      try {
        const parsed = await invokeStructuredControlModel(
          structuredModel,
          input.phrase
        )
        updateCurrentTrace({ resolutionStatus: parsed.resolution })
        return parsed
      } catch (error) {
        const errorClass = isSchemaError(error)
          ? "invalid_model_output"
          : "provider_error"
        updateCurrentTrace({ errorClass })
        throw new ConversationalParserUnavailableError(
          errorClass,
          input.model,
          { traceId: input.traceId, runId: input.traceId }
        )
      }
    },
    {
      id: input.traceId,
      name: "mandala_control_intent_parser",
      run_type: "chain",
      project_name: input.langSmithProject,
      client,
      tracingEnabled: true,
      tags: ["mandala-control-parser", "parser:langchain"],
      metadata: {
        parserKind: "langchain",
        parserSchemaVersion,
        model: input.model,
        parserRequestId: input.traceId,
      },
      processInputs: () => ({}),
      processOutputs: () => ({}),
    }
  )

  let proposal: ControlIntentProposal | undefined
  let invocationError: unknown
  try {
    proposal = await traced()
  } catch (error) {
    invocationError = error
  }
  try {
    await client.awaitPendingTraceBatches()
  } catch {
    throw new ConversationalParserUnavailableError("trace_error", input.model, {
      traceId: input.traceId,
      runId: input.traceId,
    })
  }
  if (invocationError instanceof ConversationalParserUnavailableError) {
    throw invocationError
  }
  if (invocationError || !proposal) {
    throw new ConversationalParserUnavailableError(
      "provider_error",
      input.model,
      { traceId: input.traceId, runId: input.traceId }
    )
  }
  return proposal
}

export async function invokeStructuredControlModel(
  model: StructuredControlModel,
  phrase: string
): Promise<ControlIntentProposal> {
  const proposal = await model.invoke([
    new SystemMessage(systemPrompt),
    new HumanMessage(phrase),
  ])
  return controlIntentProposalSchema.parse(proposal)
}

function proposalToOutcome(
  proposal: ControlIntentProposal,
  input: { companyId: string; phrase: string }
): ControlOutcome {
  if (proposal.resolution === "clarification_required") {
    return {
      status: "clarification_required",
      questions: ["What single supported workflow action should be taken?"],
      confirmationRequired: false,
    }
  }
  if (proposal.resolution === "blocked") {
    return {
      status: "blocked",
      reasonCode: "unsupported_command",
      reasons: [
        "The request is outside the supported workflow command boundary.",
      ],
      confirmationRequired: false,
    }
  }
  if (!proposal.candidate) {
    return {
      status: "clarification_required",
      questions: ["What single supported workflow action should be taken?"],
      confirmationRequired: false,
    }
  }

  const consistencyFailure = validateCandidateConsistency(
    proposal.candidate,
    input.phrase
  )
  if (consistencyFailure) return consistencyFailure

  const candidate = preserveOnlyGroundedFields(proposal.candidate, input.phrase)
  return resolveControlIntent(candidate, {
    companyId: input.companyId,
    warningsAcknowledged: false,
  })
}

function validateCandidateConsistency(
  candidate: ControlIntentCandidate,
  phrase: string
): ControlOutcome | null {
  if (candidate.itemId && !phrase.toLowerCase().includes(candidate.itemId)) {
    return blocked(
      "unverified_target",
      "The work item ID must appear exactly in the command."
    )
  }
  if (
    candidate.scenarioId &&
    !normalizedWords(phrase).includes(normalizedWords(candidate.scenarioId))
  ) {
    return blocked(
      "unverified_target",
      "The fixture scenario must be named in the command."
    )
  }
  if (candidate.patches.some((patch) => !phrase.includes(patch.pointer))) {
    return {
      status: "clarification_required",
      questions: ["Provide the exact JSON Pointer path for the edit."],
      confirmationRequired: false,
    }
  }
  const statedPatches = parseExactPatchAssignments(phrase)
  if (
    candidate.patches.some(
      (patch) => !statedPatches.some((stated) => samePatch(stated, patch))
    )
  ) {
    return {
      status: "clarification_required",
      questions: [
        "Provide each edit as an exact /json/pointer=<json-value> assignment.",
      ],
      confirmationRequired: false,
    }
  }
  if (
    candidate.decision === "edit" &&
    !samePatchCollection(candidate.patches, statedPatches)
  ) {
    return {
      status: "clarification_required",
      questions: ["Provide one unambiguous value for every edit assignment."],
      confirmationRequired: false,
    }
  }
  if (!hasActionEvidence(candidate, phrase)) {
    return blocked(
      "unsupported_command",
      "The requested action is not stated in the command."
    )
  }
  if (hasIrrelevantCandidateFields(candidate)) {
    return blocked(
      "multiple_actions_not_supported",
      "Submit one workflow action at a time."
    )
  }
  return null
}

function hasIrrelevantCandidateFields(
  candidate: ControlIntentCandidate
): boolean {
  const hasItem = candidate.itemId !== null
  const hasScenario = candidate.scenarioId !== null
  const hasStatus = candidate.status !== null
  const hasDecision = candidate.decision !== null
  const hasPatches = candidate.patches.length > 0
  const hasReason = candidate.reason !== null

  switch (candidate.kind) {
    case "run_fixture":
      return hasItem || hasStatus || hasDecision || hasPatches || hasReason
    case "list_work_items":
      return hasItem || hasScenario || hasDecision || hasPatches || hasReason
    case "inspect_work_item":
      return hasScenario || hasStatus || hasDecision || hasPatches || hasReason
    case "record_decision":
      return hasScenario || hasStatus
    case "execute_mock_action":
      return hasScenario || hasStatus || hasDecision || hasPatches || hasReason
  }
}

function hasActionEvidence(
  candidate: ControlIntentCandidate,
  phrase: string
): boolean {
  const patterns: Record<ControlIntentCandidate["kind"], RegExp> = {
    run_fixture: /\b(?:run|start)\b.{0,50}\bfixture\b/i,
    list_work_items: /\b(?:list|show|which|what|find|review)\b/i,
    inspect_work_item: /\b(?:inspect|show|explain|detail|about)\b/i,
    record_decision:
      candidate.decision === "approve"
        ? /\b(?:approve|accept|okay)\b/i
        : candidate.decision === "reject"
          ? /\b(?:reject|decline)\b/i
          : candidate.decision === "request_rework"
            ? /\b(?:rework|revise|send\s+back)\b/i
            : /\b(?:edit|change|update|adjust|set)\b/i,
    execute_mock_action: /\b(?:execute|perform|carry\s+out)\b/i,
  }
  return patterns[candidate.kind].test(phrase)
}

function preserveOnlyGroundedFields(
  candidate: ControlIntentCandidate,
  phrase: string
): ControlIntentCandidate {
  const reason =
    !candidate.reason ||
    phrase.toLowerCase().includes(candidate.reason.toLowerCase())
      ? candidate.reason
      : null
  const status =
    candidate.kind !== "list_work_items" ||
    !candidate.status ||
    phrase
      .toLowerCase()
      .split(/[^a-z0-9_]+/)
      .includes(candidate.status.toLowerCase())
      ? candidate.status
      : null
  return { ...candidate, reason, status }
}

function parseExactPatchAssignments(
  phrase: string
): ControlIntentCandidate["patches"] {
  const assignments = phrase.match(/\/[^\s=]+=[^\s]+/g) ?? []
  return assignments.flatMap((assignment) => {
    try {
      const parsed = modelProposalJsonPointerPatchSchema.safeParse(
        parseJsonPointerAssignment(assignment)
      )
      return parsed.success ? [parsed.data] : []
    } catch {
      return []
    }
  })
}

function samePatch(
  left: ControlIntentCandidate["patches"][number],
  right: ControlIntentCandidate["patches"][number]
): boolean {
  return (
    left.pointer === right.pointer &&
    JSON.stringify(left.value) === JSON.stringify(right.value)
  )
}

function samePatchCollection(
  left: ControlIntentCandidate["patches"],
  right: ControlIntentCandidate["patches"]
): boolean {
  if (left.length !== right.length) return false
  const signatures = (patches: ControlIntentCandidate["patches"]) =>
    patches.map((patch) => JSON.stringify([patch.pointer, patch.value])).sort()
  return JSON.stringify(signatures(left)) === JSON.stringify(signatures(right))
}

function readConfiguration(environment: ParserEnvironment): {
  apiKey: string
  model: string
  langSmithApiKey: string
  langSmithProject: string
} {
  if (environment.MANDALA_CONVERSATIONAL_PARSER_ENABLED !== "true") {
    throw new ConversationalParserUnavailableError("feature_disabled", null)
  }
  const model = environment.MANDALA_CONTROL_PARSER_MODEL?.trim()
  const apiKey =
    environment.AI_GATEWAY_API_KEY?.trim() ||
    environment.VERCEL_OIDC_TOKEN?.trim()
  const langSmithApiKey = environment.LANGSMITH_API_KEY?.trim()
  const langSmithProject = environment.LANGSMITH_PROJECT?.trim()
  const privacyEnabled =
    environment.LANGSMITH_TRACING === "true" &&
    environment.LANGSMITH_HIDE_INPUTS === "true" &&
    environment.LANGSMITH_HIDE_OUTPUTS === "true"

  if (
    !model ||
    !/^[a-z0-9-]+\/[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(model) ||
    model.length > 200 ||
    !apiKey ||
    !langSmithApiKey ||
    !langSmithProject ||
    !privacyEnabled
  ) {
    throw new ConversationalParserUnavailableError(
      "configuration_error",
      model ?? null
    )
  }
  return { apiKey, model, langSmithApiKey, langSmithProject }
}

function updateCurrentTrace(metadata: Record<string, string>): void {
  try {
    const run = getCurrentRunTree()
    run.metadata = { ...run.metadata, ...metadata }
  } catch {
    // Trace delivery is checked after the wrapped call.
  }
}

function isSchemaError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "ZodError"
  )
}

function normalizedWords(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "")
}

function elapsed(startedAt: number, endedAt: number): number {
  return Math.max(0, Math.round(endedAt - startedAt))
}

function blocked(reasonCode: string, reason: string): ControlOutcome {
  return {
    status: "blocked",
    reasonCode,
    reasons: [reason],
    confirmationRequired: false,
  }
}
