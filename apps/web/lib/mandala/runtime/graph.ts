import {
  Command,
  END,
  MemorySaver,
  START,
  StateGraph,
  interrupt,
  type BaseCheckpointSaver,
} from "@langchain/langgraph"
import {
  contextRetrievalResultSchema,
  type ContextPacketProvenance,
  type ContextRetrievalResult,
} from "@workspace/control-plane"
import type {
  CompiledAgentManifest,
  CompiledCapabilityBinding,
} from "../skills/compiler"
import { projectCapabilityDataForModel } from "../capabilities/model-egress"
import { applyDeterministicRules } from "./primitives"
import { projectRuntimeRecords } from "./projections"
import {
  RuntimeStateAnnotation,
  checkpointCorrelation,
  createRuntimeStartState,
  resolveRuntimeSandboxEnabled,
  runtimeOperatingMode,
  runtimeThreadConfig,
  type RuntimeActionResult,
  type RuntimeAgentJudgment,
  type RuntimeApprovalDecision,
  type RuntimeAuditEvent,
  type RuntimeCheckpointCorrelation,
  type RuntimePersistedReview,
  type RuntimeSourceRef,
  type RuntimeStartInput,
  type RuntimeState,
  type RuntimeStateUpdate,
} from "./state"

export type RuntimeCapabilityProvider = {
  load(input: {
    state: RuntimeState
    manifest: CompiledAgentManifest
    bindings: readonly CompiledCapabilityBinding[]
    allowedTools: readonly string[]
  }): Promise<{
    data: Record<string, unknown>
    sourceRefs: RuntimeSourceRef[]
    warnings?: string[]
  }>
}

export type RuntimeAgentJudgmentHandler = (input: {
  run: Pick<
    RuntimeState,
    | "companyId"
    | "actorId"
    | "workflowDefinitionId"
    | "workflowRunId"
    | "mode"
    | "sandboxEnabled"
    | "operatingMode"
    | "trigger"
    | "warnings"
  >
  modelData: Record<string, unknown>
  operationalContext: RuntimeOperationalContext
  manifest: CompiledAgentManifest
  allowedTools: readonly string[]
}) => Promise<RuntimeAgentJudgment>

export type RuntimeOperationalContext = Readonly<{
  untrustedEvidence: true
  provenance: ContextPacketProvenance
  items: ContextRetrievalResult["items"]
}>

export type RuntimeContextRetrievalInput = Readonly<{
  run: Readonly<
    Pick<
      RuntimeState,
      | "companyId"
      | "workflowDefinitionId"
      | "workflowRunId"
      | "manifestDigest"
      | "mode"
      | "sandboxEnabled"
      | "operatingMode"
      | "trigger"
    >
  >
  workflow: Readonly<{
    identityId: string
    workflowType: string
    sourceDigest: string
  }>
  canonical: Readonly<{
    data: RuntimeState["data"]
    sourceRefs: RuntimeState["sourceRefs"]
  }>
}>

export type RuntimeContextRetriever = Readonly<{
  retrieve(input: RuntimeContextRetrievalInput): Promise<ContextRetrievalResult>
}>

export type RuntimeReviewPersister = (input: {
  state: RuntimeState
  manifest: CompiledAgentManifest
}) => Promise<RuntimePersistedReview>

export type RuntimeActionHandler = (input: {
  state: RuntimeState
  manifest: CompiledAgentManifest
  action: CompiledAgentManifest["actions"][number]
  binding: CompiledCapabilityBinding
}) => Promise<RuntimeActionResult>

export type RuntimeAuditHandler = (input: {
  state: RuntimeState
  manifest: CompiledAgentManifest
}) => Promise<RuntimeAuditEvent | RuntimeAuditEvent[]>

export type RuntimeDependencies = {
  capabilityProvider: RuntimeCapabilityProvider
  contextRetriever: RuntimeContextRetriever
  agentJudgment: RuntimeAgentJudgmentHandler
  reviewPersister: RuntimeReviewPersister
  actionHandler?: RuntimeActionHandler
  auditHandler?: RuntimeAuditHandler
  mutationBoundary?: {
    persistence: "persistent" | "ephemeral"
    externalActions: "live" | "simulate" | "disabled"
  }
}

export type RuntimeNodeHandler = (
  state: RuntimeState
) => Promise<RuntimeStateUpdate> | RuntimeStateUpdate

export type RuntimeHandlerRegistry = Record<
  CompiledAgentManifest["graph"][number]["handler"],
  RuntimeNodeHandler
>

export type RuntimeInvocationResult = {
  output: RuntimeState & { __interrupt__?: unknown }
  correlation: RuntimeCheckpointCorrelation
}

export function createRuntimeHandlerRegistry(input: {
  manifest: CompiledAgentManifest
  dependencies: RuntimeDependencies
}): RuntimeHandlerRegistry {
  const { manifest, dependencies } = input
  const toolsFor = (
    handler: CompiledAgentManifest["graph"][number]["handler"]
  ) =>
    manifest.graph.find((node) => node.handler === handler)?.allowedTools ?? []

  return {
    resolve_bindings: (state) => {
      const unavailable = manifest.capabilityBindings.filter(
        (binding) => !binding.granted || !binding.healthy
      )
      if (unavailable.length > 0) {
        return {
          status: "blocked",
          errors: unavailable.map(
            (binding) => `Capability ${binding.alias} is unavailable.`
          ),
        }
      }
      if (state.manifestDigest !== manifest.manifestDigest) {
        return {
          status: "blocked",
          errors: ["Workflow run does not match the compiled manifest."],
        }
      }
      return { status: "bindings_resolved" }
    },
    load_data: async (state) => {
      const loaded = await dependencies.capabilityProvider.load({
        state,
        manifest,
        bindings: manifest.capabilityBindings,
        allowedTools: toolsFor("load_data"),
      })
      return {
        data: loaded.data,
        sourceRefs: loaded.sourceRefs,
        warnings: loaded.warnings ?? [],
        status: "data_loaded",
      }
    },
    validate: (state) => {
      const missing = manifest.capabilityBindings
        .filter((binding) => binding.access === "read")
        .filter((binding) => !Object.hasOwn(state.data, binding.alias))
      if (missing.length > 0) {
        return {
          status: "blocked",
          errors: missing.map(
            (binding) => `Capability ${binding.alias} returned no data.`
          ),
        }
      }
      return { status: "validated" }
    },
    retrieve_context: async (state) => {
      const retrieved = contextRetrievalResultSchema.parse(
        await dependencies.contextRetriever.retrieve({
          run: {
            companyId: state.companyId,
            workflowDefinitionId: state.workflowDefinitionId,
            workflowRunId: state.workflowRunId,
            manifestDigest: state.manifestDigest,
            mode: state.mode,
            sandboxEnabled: resolveRuntimeSandboxEnabled(state),
            operatingMode: runtimeOperatingMode(
              resolveRuntimeSandboxEnabled(state)
            ),
            trigger: state.trigger,
          },
          workflow: {
            identityId: manifest.identity.id,
            workflowType: manifest.workflow.type,
            sourceDigest: manifest.sourceDigest,
          },
          canonical: {
            data: state.data,
            sourceRefs: state.sourceRefs,
          },
        })
      )
      if (
        retrieved.provenance.scope.companyId !== state.companyId ||
        retrieved.provenance.scope.workspaceScopeId !== state.companyId
      ) {
        return {
          status: "blocked",
          errors: ["Operational Context scope does not match this workspace."],
        }
      }
      return {
        contextRetrieval: retrieved,
        warnings: state.warnings.concat(retrievalWarnings(retrieved)),
        status: "context_retrieved",
      }
    },
    agent_judgment: async (state) => {
      if (!state.contextRetrieval) {
        return {
          status: "blocked",
          errors: ["Operational Context retrieval is missing."],
        }
      }
      const judgment = await dependencies.agentJudgment({
        run: {
          companyId: state.companyId,
          actorId: state.actorId,
          workflowDefinitionId: state.workflowDefinitionId,
          workflowRunId: state.workflowRunId,
          mode: state.mode,
          sandboxEnabled: resolveRuntimeSandboxEnabled(state),
          operatingMode: runtimeOperatingMode(
            resolveRuntimeSandboxEnabled(state)
          ),
          trigger: state.trigger,
          warnings: state.warnings,
        },
        modelData: projectCapabilityDataForModel({
          data: state.data,
          bindings: manifest.capabilityBindings,
        }),
        operationalContext: {
          untrustedEvidence: true,
          provenance: state.contextRetrieval.provenance,
          items: state.contextRetrieval.items,
        },
        manifest,
        allowedTools: toolsFor("agent_judgment"),
      })
      assertAgentJudgment(judgment)
      return {
        agent: judgment,
        warnings: state.warnings.concat(judgment.warnings),
        status: "judgment_ready",
      }
    },
    apply_rules: (state) => {
      if (!state.agent) {
        return {
          status: "blocked",
          errors: ["Agent judgment is missing."],
        }
      }
      const result = applyDeterministicRules({
        rules: manifest.rules,
        context: runtimeRuleContext(state),
      })
      return {
        ruleResult: result,
        status: !result.ok
          ? "blocked"
          : result.disposition === "blocked"
            ? "blocked"
            : result.disposition === "suppressed"
              ? "suppressed"
              : "rules_applied",
        warnings: state.warnings.concat(result.warnings),
        errors: result.errors.concat(result.messages),
      }
    },
    project_records: (state) => {
      if (!state.ruleResult?.ok) {
        return {
          status: "blocked",
          errors: state.ruleResult?.errors ?? ["Rule result is missing."],
        }
      }
      return {
        review: projectRuntimeRecords({
          manifest,
          context: state.ruleResult.context,
          sourceRefs: state.sourceRefs,
        }),
        status: "review_projected",
      }
    },
    persist_review: async (state) => {
      if (!state.review) {
        return {
          status: "blocked",
          errors: ["Review projection is missing."],
        }
      }
      if (
        resolveRuntimeSandboxEnabled(state) &&
        dependencies.mutationBoundary?.persistence !== "ephemeral"
      ) {
        return {
          status: "blocked",
          errors: ["Sandbox blocked a durable review persistence path."],
        }
      }
      const persistedReview = await dependencies.reviewPersister({
        state,
        manifest,
      })
      assertPersistedReview(persistedReview)
      return {
        persistedReview,
        status:
          persistedReview.disposition === "suppressed"
            ? "suppressed"
            : manifest.approvals.length > 0
              ? "waiting_for_approval"
              : "review_projected",
      }
    },
    human_approval: (state) => {
      if (!state.persistedReview) {
        return {
          status: "blocked",
          errors: ["Persisted review is missing."],
        }
      }
      const decision = interrupt<
        {
          type: "workflow_approval"
          workflowRunId: string
          workflowItemId: string
          actionDraftId: string | null
          approvalActions: string[]
        },
        RuntimeApprovalDecision
      >({
        type: "workflow_approval",
        workflowRunId: state.workflowRunId,
        workflowItemId: state.persistedReview.workflowItemId,
        actionDraftId: state.persistedReview.actionDraftId,
        approvalActions: manifest.approvals.map((approval) => approval.action),
      })
      assertApprovalDecision(decision)
      return {
        approval: decision,
        status:
          decision.decision === "reject"
            ? "rejected"
            : decision.decision === "request_rework"
              ? "rework_requested"
              : "approved",
      }
    },
    execute_action: async (state) => {
      if (!state.review?.draft) {
        return {
          status: "blocked",
          errors: ["Action draft is missing."],
        }
      }
      const action = manifest.actions.find(
        (candidate) => candidate.id === state.review!.draft!.action
      )
      if (!action) {
        return {
          status: "blocked",
          errors: ["Draft references an undeclared action."],
        }
      }
      const actionBindings = manifest.capabilityBindings.filter(
        (candidate) =>
          candidate.id === action.capability && candidate.access !== "read"
      )
      if (actionBindings.length !== 1) {
        return {
          status: "blocked",
          errors: [
            actionBindings.length === 0
              ? "Action capability binding is unavailable."
              : "Action must target exactly one frozen connector binding.",
          ],
        }
      }
      const binding = actionBindings[0]!
      if (action.requires_approval && state.status !== "approved") {
        return {
          status: "blocked",
          errors: ["Action requires a recorded human approval."],
        }
      }
      if (!dependencies.actionHandler) {
        return {
          status: "blocked",
          errors: ["No action handler is configured."],
        }
      }
      if (
        resolveRuntimeSandboxEnabled(state) &&
        dependencies.mutationBoundary?.externalActions !== "simulate"
      ) {
        return {
          status: "blocked",
          errors: ["Sandbox blocked a live or unclassified action path."],
        }
      }
      const actionResult = await dependencies.actionHandler({
        state,
        manifest,
        action,
        binding,
      })
      return {
        actionResult,
        status: actionResult.status === "succeeded" ? "executed" : "failed",
        ...(actionResult.status !== "succeeded"
          ? {
              errors: [
                actionResult.code
                  ? `Action execution failed (${actionResult.code}).`
                  : "Action execution failed.",
              ],
            }
          : {}),
      }
    },
    audit: async (state) => {
      const generated = dependencies.auditHandler
        ? await dependencies.auditHandler({ state, manifest })
        : defaultAuditEvent(state)
      return {
        auditEvents: Array.isArray(generated) ? generated : [generated],
        status: terminalStatus(state.status),
      }
    },
  }
}

export function createGenericWorkflowRuntime(input: {
  manifest: CompiledAgentManifest
  dependencies: RuntimeDependencies
  checkpointer?: BaseCheckpointSaver
}) {
  assertSupportedManifest(input.manifest)
  const checkpointer = input.checkpointer ?? new MemorySaver()
  const handlers = createRuntimeHandlerRegistry(input)
  const hasApproval = input.manifest.approvals.length > 0
  const hasAction = input.manifest.actions.length > 0

  const graph = new StateGraph(RuntimeStateAnnotation)
    .addNode("resolve_bindings", handlers.resolve_bindings)
    .addNode("load_data", handlers.load_data)
    .addNode("validate", handlers.validate)
    .addNode("retrieve_context", handlers.retrieve_context)
    .addNode("agent_judgment", handlers.agent_judgment)
    .addNode("apply_rules", handlers.apply_rules)
    .addNode("project_records", handlers.project_records)
    .addNode("persist_review", handlers.persist_review)
    .addNode("human_approval", handlers.human_approval)
    .addNode("execute_action", handlers.execute_action)
    .addNode("audit", handlers.audit)
    .addEdge(START, "resolve_bindings")
    .addConditionalEdges("resolve_bindings", routeBlocked, [
      "load_data",
      "audit",
    ])
    .addEdge("load_data", "validate")
    .addConditionalEdges("validate", routeBlocked, [
      "retrieve_context",
      "audit",
    ])
    .addConditionalEdges("retrieve_context", routeBlocked, [
      "agent_judgment",
      "audit",
    ])
    .addEdge("agent_judgment", "apply_rules")
    .addConditionalEdges("apply_rules", routeBlocked, [
      "project_records",
      "audit",
    ])
    .addConditionalEdges("project_records", routeBlocked, [
      "persist_review",
      "audit",
    ])
    .addConditionalEdges(
      "persist_review",
      (state) => {
        if (isBlocked(state.status)) return "audit"
        if (hasApproval) return "human_approval"
        if (hasAction) return "execute_action"
        return "audit"
      },
      ["human_approval", "execute_action", "audit"]
    )
    .addConditionalEdges(
      "human_approval",
      (state) =>
        state.status === "approved" && hasAction ? "execute_action" : "audit",
      ["execute_action", "audit"]
    )
    .addEdge("execute_action", "audit")
    .addEdge("audit", END)
    .compile({ checkpointer })

  async function resultFor(
    output: RuntimeState & { __interrupt__?: unknown },
    workflowRunId: string,
    checkpointId?: string
  ): Promise<RuntimeInvocationResult> {
    const snapshot = await graph.getState(
      runtimeThreadConfig(workflowRunId, checkpointId)
    )
    return {
      output,
      correlation: checkpointCorrelation(workflowRunId, snapshot),
    }
  }

  return {
    graph,
    checkpointer,
    handlers,
    async start(
      startInput: RuntimeStartInput
    ): Promise<RuntimeInvocationResult> {
      const output = await graph.invoke(
        createRuntimeStartState(startInput),
        runtimeThreadConfig(startInput.workflowRunId)
      )
      return resultFor(output, startInput.workflowRunId)
    },
    async resume(input: {
      workflowRunId: string
      decision: RuntimeApprovalDecision
      checkpointId?: string
    }): Promise<RuntimeInvocationResult> {
      assertApprovalDecision(input.decision)
      const config = runtimeThreadConfig(
        input.workflowRunId,
        input.checkpointId
      )
      const current = await graph.getState(config)
      if (current.next.length === 0) {
        const state = current.values as RuntimeState
        if (
          state.approval &&
          (state.approval.decisionId !== input.decision.decisionId ||
            state.approval.decision !== input.decision.decision)
        ) {
          throw new Error(
            "Workflow run was already resumed with a different decision."
          )
        }
        return {
          output: state,
          correlation: checkpointCorrelation(input.workflowRunId, current),
        }
      }
      const output = await graph.invoke(
        new Command({ resume: input.decision }),
        config
      )
      return resultFor(output, input.workflowRunId)
    },
    async state(workflowRunId: string, checkpointId?: string) {
      return graph.getState(runtimeThreadConfig(workflowRunId, checkpointId))
    },
  }
}

function runtimeRuleContext(state: RuntimeState): Record<string, unknown> {
  return {
    trigger: {
      ...state.trigger.input,
      id: state.trigger.id,
      kind: state.trigger.kind,
    },
    data: state.data,
    agent: state.agent
      ? {
          ...state.agent.proposal,
          rationale: state.agent.rationale,
          confidence: state.agent.confidence,
          warnings: state.agent.warnings,
          context: state.agent.context,
        }
      : {},
    rules: {},
    context: {
      companyId: state.companyId,
      workflowRunId: state.workflowRunId,
      mode: state.mode,
      sandboxEnabled: resolveRuntimeSandboxEnabled(state),
      operatingMode: runtimeOperatingMode(resolveRuntimeSandboxEnabled(state)),
      warnings: state.warnings,
      sourceRefs: state.sourceRefs,
    },
  }
}

function routeBlocked(
  state: RuntimeState
):
  | "audit"
  | "load_data"
  | "retrieve_context"
  | "agent_judgment"
  | "project_records"
  | "persist_review" {
  if (isBlocked(state.status)) return "audit"
  if (state.status === "bindings_resolved") return "load_data"
  if (state.status === "validated") return "retrieve_context"
  if (state.status === "context_retrieved") return "agent_judgment"
  if (state.status === "rules_applied") return "project_records"
  return "persist_review"
}

function isBlocked(status: RuntimeState["status"]): boolean {
  return status === "blocked" || status === "suppressed" || status === "failed"
}

function terminalStatus(
  status: RuntimeState["status"]
): RuntimeState["status"] {
  if (
    status === "blocked" ||
    status === "suppressed" ||
    status === "failed" ||
    status === "executed" ||
    status === "rejected" ||
    status === "rework_requested"
  ) {
    return status
  }
  return "completed"
}

function defaultAuditEvent(state: RuntimeState): RuntimeAuditEvent {
  return {
    eventType: "workflow_runtime_completed",
    summary: `Workflow runtime reached ${state.status}.`,
    payload: {
      workflowRunId: state.workflowRunId,
      status: state.status,
      errorCount: state.errors.length,
      operationalContext: state.contextRetrieval
        ? {
            provider: state.contextRetrieval.provenance.provider,
            status: state.contextRetrieval.provenance.status,
            requestId: state.contextRetrieval.provenance.requestId,
            resultCount: state.contextRetrieval.provenance.resultCount,
            fallbackReason: state.contextRetrieval.provenance.fallbackReason,
            indexSnapshotMarker:
              state.contextRetrieval.provenance.indexSnapshotMarker,
          }
        : null,
    },
  }
}

function retrievalWarnings(result: ContextRetrievalResult): string[] {
  const { status, fallbackReason } = result.provenance
  if (status === "disabled" || status === "complete" || status === "empty") {
    return []
  }
  const reason =
    fallbackReason === "timeout"
      ? "timed out"
      : fallbackReason === "provider_unavailable"
        ? "was unavailable"
        : fallbackReason === "bounds_exceeded"
          ? "reached its evidence bounds"
          : fallbackReason === "policy_rejected"
            ? "was rejected by local policy"
            : "failed"
  return [
    `Operational Context ${reason}; canonical capability data remains authoritative.`,
  ]
}

function assertSupportedManifest(manifest: CompiledAgentManifest): void {
  const handlers = new Set(manifest.graph.map((node) => node.handler))
  if (handlers.size !== manifest.graph.length) {
    throw new Error("Compiled manifest contains duplicate graph handlers.")
  }
  for (const node of manifest.graph) {
    if (node.id !== node.handler) {
      throw new Error(
        `Compiled graph node ${node.id} does not match handler ${node.handler}.`
      )
    }
  }
  const required = [
    "resolve_bindings",
    "load_data",
    "validate",
    "retrieve_context",
    "agent_judgment",
    "apply_rules",
    "project_records",
    "persist_review",
    "audit",
  ] as const
  for (const handler of required) {
    if (!handlers.has(handler)) {
      throw new Error(`Compiled manifest is missing ${handler}.`)
    }
  }
  if (manifest.approvals.length > 0 && !handlers.has("human_approval")) {
    throw new Error("Compiled manifest is missing human_approval.")
  }
  if (manifest.actions.length > 0 && !handlers.has("execute_action")) {
    throw new Error("Compiled manifest is missing execute_action.")
  }
}

function assertAgentJudgment(
  judgment: RuntimeAgentJudgment
): asserts judgment is RuntimeAgentJudgment {
  if (
    !judgment ||
    typeof judgment !== "object" ||
    !judgment.proposal ||
    typeof judgment.proposal !== "object" ||
    typeof judgment.rationale !== "string" ||
    !judgment.rationale.trim() ||
    typeof judgment.confidence !== "number" ||
    !Number.isFinite(judgment.confidence) ||
    judgment.confidence < 0 ||
    judgment.confidence > 1 ||
    !Array.isArray(judgment.warnings) ||
    !judgment.context ||
    typeof judgment.context !== "object"
  ) {
    throw new Error("Agent judgment is invalid.")
  }
}

function assertPersistedReview(
  review: RuntimePersistedReview
): asserts review is RuntimePersistedReview {
  if (
    !review.workflowItemId ||
    !review.recommendationId ||
    !review.evidenceId
  ) {
    throw new Error("Persisted review references are invalid.")
  }
}

function assertApprovalDecision(
  decision: RuntimeApprovalDecision
): asserts decision is RuntimeApprovalDecision {
  if (
    !decision ||
    typeof decision !== "object" ||
    typeof decision.decisionId !== "string" ||
    !decision.decisionId.trim() ||
    !["approve", "edit", "reject", "request_rework"].includes(decision.decision)
  ) {
    throw new Error("Approval decision is invalid.")
  }
}
