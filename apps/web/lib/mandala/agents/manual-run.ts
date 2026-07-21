import type { AgentManualRunRequest } from "@workspace/control-plane"
import type { BaseCheckpointSaver } from "@langchain/langgraph"
import { deriveControlInputHash } from "../control-plane/input-hash"
import { createServerContextRetriever } from "../context/retrieval-service"
import { getProductionWorkflowCheckpointer } from "../runtime/checkpointer"
import { runCompiledWorkflowInMemory } from "../runtime/memory-runner"
import type { RuntimeTrigger } from "../runtime/state"
import { createWorkspaceJudgment } from "../workspace-data/sandbox-runner"
import {
  WorkspaceDatasetProvider,
  type WorkspaceProjection,
  type WorkspaceSignal,
} from "../workspace-data/provider"
import { SupabaseWorkspaceDataStore } from "../workspace-data/supabase-store"
import { WorkflowMemoryStore, type WorkflowSupabaseClient } from "../workflows"
import type { WorkflowClientSurface } from "../workflows"
import {
  persistCompiledWorkflowReview,
  type CompiledReviewPersistenceResult,
} from "./persistence"
import { loadStoredAgentWorkflow } from "./test-run"

// Runs an already-active agent's declared `manual` trigger against real,
// cataloged company data and persists whatever it finds as a reviewable
// work item — the missing link between "agent is active" and "someone can
// see and act on a real recommendation."
//
// Deliberately does not pass an actionHandler to runCompiledWorkflowInMemory.
// This agent's only non-read capability bindings (purchase-order draft /
// execute) are bound to a mock connector today, so a run node reaching the
// draft step comes back `blocked` ("No action handler is configured")
// rather than doing anything — real data flows in, nothing external is
// ever attempted. Wiring the draft/execute step is a separate, later change.

const BATCH_DEFAULT_LIMIT = 10
const BATCH_MAXIMUM_LIMIT = 25

export class ManualRunAgentNotActiveError extends Error {
  constructor(readonly lifecycleState: string) {
    super(
      `Agent lifecycle state is "${lifecycleState}", not "active." Manual real-data runs are only allowed once an agent has been activated.`
    )
    this.name = "ManualRunAgentNotActiveError"
  }
}

export type ManualAgentRunResult = {
  agentId: string
  workflowRunId: string
  status: "blocked" | "suppressed" | "waiting_for_approval" | "completed"
  itemId: string | null
  entity: { key: string; value: string }
  result: Record<string, unknown>
}

export type ManualAgentBatchRunResult = {
  agentId: string
  matchedEntities: number
  limit: number
  runs: Array<{
    entity: { key: string; value: string }
    workflowRunId: string
    status: ManualAgentRunResult["status"]
    itemId: string | null
    duplicate: boolean
  }>
}

type ManualRunInput = {
  supabase: WorkflowSupabaseClient
  dataSupabase?: WorkflowSupabaseClient
  agentId: string
  request: AgentManualRunRequest
  actorUserId: string
  clientSurface: WorkflowClientSurface
  now?: () => Date
  dependencies?: {
    loadCheckpointer?: () => Promise<BaseCheckpointSaver>
    persist?: typeof persistCompiledWorkflowReview
  }
}

export async function runManualAgentTrigger(
  input: ManualRunInput
): Promise<ManualAgentRunResult> {
  const context = await loadManualRunContext(input)
  const prepared = await context.provider.prepareAll({
    companyId: input.request.companyId,
    bindings: context.workflow.manifest.capabilityBindings,
  })
  const signal = prepared.signals[0]!
  const { run, persistence } = await executeEntityRun({
    input,
    context,
    signal,
    projections: prepared.projections,
  })
  return {
    agentId: context.workflow.id,
    workflowRunId: persistence.workflowRunId,
    status: projectStatus(run.run.status),
    itemId: persistence.itemId,
    entity: { key: signal.entityKey, value: signal.entityValue },
    result: {
      recommendation: run.recommendation?.output ?? null,
      rationale: run.recommendation?.rationaleSummary ?? null,
      warnings: run.recommendation?.warnings ?? [],
      duplicate: persistence.duplicate,
      draftId: persistence.draftId,
    },
  }
}

// Batch mode: one work item per qualifying entity instead of first-match
// only. Entities run sequentially — they share the projection load, and
// per-entity persistence stays idempotent via the entity-scoped input hash.
export async function runManualAgentTriggerBatch(
  input: ManualRunInput
): Promise<ManualAgentBatchRunResult> {
  const limit = Math.min(
    Math.max(input.request.limit ?? BATCH_DEFAULT_LIMIT, 1),
    BATCH_MAXIMUM_LIMIT
  )
  const context = await loadManualRunContext(input)
  const prepared = await context.provider.prepareAll({
    companyId: input.request.companyId,
    bindings: context.workflow.manifest.capabilityBindings,
  })
  const runs: ManualAgentBatchRunResult["runs"] = []
  for (const signal of prepared.signals.slice(0, limit)) {
    context.provider.selectSignal(signal)
    const { run, persistence } = await executeEntityRun({
      input,
      context,
      signal,
      projections: prepared.projections,
    })
    runs.push({
      entity: { key: signal.entityKey, value: signal.entityValue },
      workflowRunId: persistence.workflowRunId,
      status: projectStatus(run.run.status),
      itemId: persistence.itemId,
      duplicate: persistence.duplicate,
    })
  }
  return {
    agentId: context.workflow.id,
    matchedEntities: prepared.signals.length,
    limit,
    runs,
  }
}

type ManualRunContext = {
  workflow: Awaited<ReturnType<typeof loadStoredAgentWorkflow>>
  bindingSnapshotId: string
  provider: WorkspaceDatasetProvider
  checkpointer: BaseCheckpointSaver
  persist: typeof persistCompiledWorkflowReview
  now: Date
}

async function loadManualRunContext(
  input: ManualRunInput
): Promise<ManualRunContext> {
  const now = (input.now ?? (() => new Date()))()
  const persist = input.dependencies?.persist ?? persistCompiledWorkflowReview
  const checkpointer = await (
    input.dependencies?.loadCheckpointer ?? getProductionWorkflowCheckpointer
  )()

  const workflow = await loadStoredAgentWorkflow({
    supabase: input.supabase,
    companyId: input.request.companyId,
    agentId: input.agentId,
  })

  const runtimeState = await loadAgentRuntimeState({
    supabase: input.supabase,
    companyId: input.request.companyId,
    agentId: input.agentId,
  })
  if (runtimeState.lifecycleState !== "active") {
    throw new ManualRunAgentNotActiveError(runtimeState.lifecycleState)
  }

  await refreshWorkspaceCatalogForManualRun({
    supabase: input.supabase,
    companyId: input.request.companyId,
  })

  const store = new SupabaseWorkspaceDataStore(
    input.dataSupabase ?? input.supabase,
    runtimeState.bindingSnapshotId,
    () => now
  )
  const provider = new WorkspaceDatasetProvider(store, () => now)
  return {
    workflow,
    bindingSnapshotId: runtimeState.bindingSnapshotId,
    provider,
    checkpointer,
    persist,
    now,
  }
}

async function executeEntityRun(args: {
  input: ManualRunInput
  context: ManualRunContext
  signal: WorkspaceSignal
  projections: WorkspaceProjection[]
}): Promise<{
  run: Awaited<ReturnType<typeof runCompiledWorkflowInMemory>>
  persistence: CompiledReviewPersistenceResult
}> {
  const { input, context, signal, projections } = args
  const declaredTrigger =
    context.workflow.manifest.workflow.triggers.find(
      (candidate) => candidate.kind === "manual"
    ) ?? context.workflow.manifest.workflow.triggers[0]!
  const trigger: RuntimeTrigger = {
    id: declaredTrigger.id,
    kind: declaredTrigger.kind,
    input: {
      operatingMode: "manual",
      entityKey: signal.entityKey,
      entityValue: signal.entityValue,
      mappingVersionId: signal.mappingVersionId,
      bindingSnapshotId: context.bindingSnapshotId,
      reason: input.request.reason,
    },
  }

  const memory = new WorkflowMemoryStore()
  const run = await runCompiledWorkflowInMemory({
    store: memory,
    manifest: context.workflow.manifest,
    companyId: input.request.companyId,
    actorUserId: input.actorUserId,
    workflowDefinitionId: context.workflow.id,
    trigger,
    capabilityProvider: context.provider,
    contextRetriever: createServerContextRetriever({
      supabase: input.supabase,
      now: () => context.now,
    }),
    agentJudgment: createWorkspaceJudgment(projections, signal.entityValue),
    skillMarkdown: context.workflow.skillMarkdown,
    now: context.now,
    checkpointer: context.checkpointer,
  })

  const persistence = await context.persist({
    supabase: input.supabase,
    companyId: input.request.companyId,
    workflowId: context.workflow.id,
    bindingSnapshotId: context.bindingSnapshotId,
    result: run,
    inputHash: deriveControlInputHash("manual_trigger", {
      companyId: input.request.companyId,
      agentId: input.agentId,
      entityValue: signal.entityValue,
      manifestDigest: context.workflow.manifest.manifestDigest,
      bindingSnapshotId: context.bindingSnapshotId,
    }),
    clientSurface: input.clientSurface,
  })
  return { run, persistence }
}

export async function refreshWorkspaceCatalogForManualRun(input: {
  supabase: WorkflowSupabaseClient
  companyId: string
}): Promise<void> {
  const { error } = await input.supabase.rpc(
    "refresh_workspace_data_catalog_v1",
    { p_company_id: input.companyId }
  )
  if (error) {
    throw new Error(`workspace_catalog_refresh_failed: ${error.message}`)
  }
}

async function loadAgentRuntimeState(input: {
  supabase: WorkflowSupabaseClient
  companyId: string
  agentId: string
}): Promise<{ lifecycleState: string; bindingSnapshotId: string }> {
  const { data, error } = await input.supabase
    .from("agent_runtime_states")
    .select("lifecycle_state, binding_snapshot_id")
    .eq("company_id", input.companyId)
    .eq("workflow_id", input.agentId)
    .single()
  if (error) throw new Error(`agent_runtime_state_not_found: ${error.message}`)
  if (!data.binding_snapshot_id) {
    throw new Error(
      "agent_binding_snapshot_missing: active agent has no bound workspace mappings"
    )
  }
  return {
    lifecycleState: data.lifecycle_state,
    bindingSnapshotId: data.binding_snapshot_id,
  }
}

function projectStatus(status: string): ManualAgentRunResult["status"] {
  if (status === "blocked") return "blocked"
  if (status === "suppressed") return "suppressed"
  if (status === "waiting_for_approval") return "waiting_for_approval"
  return "completed"
}
