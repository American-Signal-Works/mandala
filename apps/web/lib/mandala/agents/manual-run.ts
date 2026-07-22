import type { AgentManualRunRequest } from "@workspace/control-plane"
import { deriveControlInputHash } from "../control-plane/input-hash"
import { createServerContextRetriever } from "../context/retrieval-service"
import { getProductionWorkflowCheckpointer } from "../runtime/checkpointer"
import { runCompiledWorkflowInMemory } from "../runtime/memory-runner"
import type { RuntimeTrigger } from "../runtime/state"
import { createWorkspaceJudgment } from "../workspace-data/sandbox-runner"
import { WorkspaceDatasetProvider } from "../workspace-data/provider"
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

export async function runManualAgentTrigger(input: {
  supabase: WorkflowSupabaseClient
  dataSupabase?: WorkflowSupabaseClient
  agentId: string
  request: AgentManualRunRequest
  actorUserId: string
  clientSurface: WorkflowClientSurface
  now?: () => Date
  dependencies?: {
    loadCheckpointer?: () => Promise<
      Awaited<ReturnType<typeof getProductionWorkflowCheckpointer>>
    >
    persist?: typeof persistCompiledWorkflowReview
  }
}): Promise<ManualAgentRunResult> {
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
  const prepared = await provider.prepare({
    companyId: input.request.companyId,
    bindings: workflow.manifest.capabilityBindings,
  })

  const declaredTrigger =
    workflow.manifest.workflow.triggers.find(
      (candidate) => candidate.kind === "manual"
    ) ?? workflow.manifest.workflow.triggers[0]!
  const trigger: RuntimeTrigger = {
    id: declaredTrigger.id,
    kind: declaredTrigger.kind,
    input: {
      operatingMode: "manual",
      entityKey: prepared.signal.entityKey,
      entityValue: prepared.signal.entityValue,
      mappingVersionId: prepared.signal.mappingVersionId,
      bindingSnapshotId: runtimeState.bindingSnapshotId,
      reason: input.request.reason,
    },
  }

  const memory = new WorkflowMemoryStore()
  const run = await runCompiledWorkflowInMemory({
    store: memory,
    manifest: workflow.manifest,
    companyId: input.request.companyId,
    actorUserId: input.actorUserId,
    workflowDefinitionId: workflow.id,
    trigger,
    capabilityProvider: provider,
    contextRetriever: createServerContextRetriever({
      supabase: input.supabase,
      now: () => now,
    }),
    agentJudgment: createWorkspaceJudgment(
      prepared.projections,
      prepared.signal.entityValue
    ),
    skillMarkdown: workflow.skillMarkdown,
    now,
    checkpointer,
  })

  const persistence: CompiledReviewPersistenceResult = await persist({
    supabase: input.supabase,
    companyId: input.request.companyId,
    workflowId: workflow.id,
    bindingSnapshotId: runtimeState.bindingSnapshotId,
    result: run,
    inputHash: deriveControlInputHash("manual_trigger", {
      companyId: input.request.companyId,
      agentId: input.agentId,
      entityValue: prepared.signal.entityValue,
      manifestDigest: workflow.manifest.manifestDigest,
      bindingSnapshotId: runtimeState.bindingSnapshotId,
    }),
    clientSurface: input.clientSurface,
  })

  return {
    agentId: workflow.id,
    workflowRunId: persistence.workflowRunId,
    status: projectStatus(run.run.status),
    itemId: persistence.itemId,
    entity: {
      key: prepared.signal.entityKey,
      value: prepared.signal.entityValue,
    },
    result: {
      recommendation: run.recommendation?.output ?? null,
      rationale: run.recommendation?.rationaleSummary ?? null,
      warnings: run.recommendation?.warnings ?? [],
      duplicate: persistence.duplicate,
      draftId: persistence.draftId,
    },
  }
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
