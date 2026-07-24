import type { SignalDispatch } from "../signals/schema"
import { deriveControlInputHash } from "../control-plane/input-hash"
import { createServerContextRetriever } from "../context/retrieval-service"
import { getProductionWorkflowCheckpointer } from "../runtime/checkpointer"
import { runCompiledWorkflowInMemory } from "../runtime/memory-runner"
import type { RuntimeTrigger } from "../runtime/state"
import { createWorkspaceJudgment } from "../workspace-data/sandbox-runner"
import { WorkspaceDatasetProvider } from "../workspace-data/provider"
import { SupabaseWorkspaceDataStore } from "../workspace-data/supabase-store"
import { WorkflowMemoryStore, type WorkflowSupabaseClient } from "../workflows"
import {
  persistCompiledWorkflowReviewAutomation,
  type CompiledReviewPersistenceResult,
} from "./persistence"
import {
  ManualRunAgentNotActiveError,
  refreshWorkspaceCatalogForManualRun,
} from "./manual-run"
import { loadStoredAgentWorkflow } from "./test-run"

export type SignalAgentRunResult = {
  workflowRunId: string
  status: "blocked" | "suppressed" | "waiting_for_approval" | "completed"
  itemId: string | null
  entity: { key: string; value: string }
  duplicate: boolean
}

export async function runSignalAgentTrigger(input: {
  supabase: WorkflowSupabaseClient
  dataSupabase?: WorkflowSupabaseClient
  dispatch: SignalDispatch
  now?: () => Date
  dependencies?: {
    loadCheckpointer?: () => Promise<
      Awaited<ReturnType<typeof getProductionWorkflowCheckpointer>>
    >
    persist?: typeof persistCompiledWorkflowReviewAutomation
  }
}): Promise<SignalAgentRunResult> {
  const now = (input.now ?? (() => new Date()))()
  const persist =
    input.dependencies?.persist ?? persistCompiledWorkflowReviewAutomation
  const checkpointer = await (
    input.dependencies?.loadCheckpointer ?? getProductionWorkflowCheckpointer
  )()
  const dispatch = input.dispatch

  const [workflow, runtimeState, actorUserId] = await Promise.all([
    loadStoredAgentWorkflow({
      supabase: input.supabase,
      companyId: dispatch.companyId,
      agentId: dispatch.workflowId,
    }),
    loadSignalRuntimeState({
      supabase: input.supabase,
      companyId: dispatch.companyId,
      workflowId: dispatch.workflowId,
    }),
    loadSignalActor({
      supabase: input.supabase,
      dispatch,
    }),
  ])
  if (runtimeState.lifecycleState !== "active") {
    throw new ManualRunAgentNotActiveError(runtimeState.lifecycleState)
  }
  if (runtimeState.bindingSnapshotId !== dispatch.bindingSnapshotId) {
    throw new Error("signal_binding_snapshot_not_current")
  }

  const declaredTrigger = workflow.manifest.workflow.triggers.find(
    (candidate) =>
      candidate.id === dispatch.triggerId &&
      candidate.kind === dispatch.triggerKind
  )
  if (
    !declaredTrigger ||
    (declaredTrigger.kind !== "webhook" && declaredTrigger.kind !== "schedule")
  ) {
    throw new Error("signal_trigger_not_declared")
  }

  await refreshWorkspaceCatalogForManualRun({
    supabase: input.supabase,
    companyId: dispatch.companyId,
  })
  const store = new SupabaseWorkspaceDataStore(
    input.dataSupabase ?? input.supabase,
    dispatch.bindingSnapshotId,
    () => now
  )
  const provider = new WorkspaceDatasetProvider(store, () => now)
  const prepared = await provider.prepare({
    companyId: dispatch.companyId,
    bindings: workflow.manifest.capabilityBindings,
  })
  const trigger: RuntimeTrigger = {
    id: declaredTrigger.id,
    kind: declaredTrigger.kind,
    input: {
      operatingMode: "automation",
      signalKind: dispatch.signalKind,
      signalDispatchId: dispatch.id,
      changeWindowId: dispatch.changeWindowId,
      recordType: stringValue(dispatch.input.recordType),
      changeCount: numberValue(dispatch.input.changeCount),
      entityKey: prepared.signal.entityKey,
      entityValue: prepared.signal.entityValue,
      mappingVersionId: prepared.signal.mappingVersionId,
      bindingSnapshotId: dispatch.bindingSnapshotId,
    },
  }

  const run = await runCompiledWorkflowInMemory({
    store: new WorkflowMemoryStore(),
    manifest: workflow.manifest,
    companyId: dispatch.companyId,
    actorUserId,
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
    companyId: dispatch.companyId,
    workflowId: workflow.id,
    bindingSnapshotId: dispatch.bindingSnapshotId,
    result: run,
    inputHash: deriveControlInputHash("signal_dispatch", {
      companyId: dispatch.companyId,
      dispatchId: dispatch.id,
      workflowId: dispatch.workflowId,
      bindingSnapshotId: dispatch.bindingSnapshotId,
      manifestDigest: workflow.manifest.manifestDigest,
    }),
  })

  return {
    workflowRunId: persistence.workflowRunId,
    status: projectStatus(run.run.status),
    itemId: persistence.itemId,
    entity: {
      key: prepared.signal.entityKey,
      value: prepared.signal.entityValue,
    },
    duplicate: persistence.duplicate,
  }
}

async function loadSignalRuntimeState(input: {
  supabase: WorkflowSupabaseClient
  companyId: string
  workflowId: string
}) {
  const { data, error } = await input.supabase
    .from("agent_runtime_states")
    .select("lifecycle_state, binding_snapshot_id")
    .eq("company_id", input.companyId)
    .eq("workflow_id", input.workflowId)
    .single()
  if (error) throw new Error(`agent_runtime_state_not_found: ${error.message}`)
  if (!data.binding_snapshot_id) {
    throw new Error("agent_binding_snapshot_missing")
  }
  return {
    lifecycleState: data.lifecycle_state,
    bindingSnapshotId: data.binding_snapshot_id,
  }
}

async function loadSignalActor(input: {
  supabase: WorkflowSupabaseClient
  dispatch: SignalDispatch
}) {
  const { data, error } = await input.supabase
    .from("workflow_activations")
    .select("activated_by")
    .eq("company_id", input.dispatch.companyId)
    .eq("workflow_id", input.dispatch.workflowId)
    .eq("binding_snapshot_id", input.dispatch.bindingSnapshotId)
    .single()
  if (error) throw new Error(`signal_activation_not_found: ${error.message}`)
  return data.activated_by
}

function projectStatus(status: string): SignalAgentRunResult["status"] {
  if (status === "blocked") return "blocked"
  if (status === "suppressed") return "suppressed"
  if (status === "waiting_for_approval") return "waiting_for_approval"
  return "completed"
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : undefined
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}
