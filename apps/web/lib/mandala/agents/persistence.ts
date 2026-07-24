import { z } from "zod"
import {
  WorkflowRpcError,
  createWorkflowFixturePersistencePayload,
  type WorkflowClientSurface,
  type WorkflowFixtureRunResult,
  type WorkflowSupabaseClient,
} from "../workflows"

const compiledReviewPersistenceSchema = z
  .object({
    workflowRunId: z.string().uuid(),
    itemId: z.string().uuid().nullable(),
    draftId: z.string().uuid().nullable(),
    duplicate: z.boolean(),
  })
  .strict()

export type CompiledReviewPersistenceResult = z.infer<
  typeof compiledReviewPersistenceSchema
>

export async function persistCompiledWorkflowReview(input: {
  supabase: WorkflowSupabaseClient
  companyId: string
  workflowId: string
  bindingSnapshotId: string
  result: WorkflowFixtureRunResult
  inputHash: string
  clientSurface: WorkflowClientSurface
}): Promise<CompiledReviewPersistenceResult> {
  const { data, error } = await input.supabase.rpc(
    "persist_compiled_workflow_review_controlled",
    {
      p_company_id: input.companyId,
      p_workflow_id: input.workflowId,
      p_binding_snapshot_id: input.bindingSnapshotId,
      p_payload: createWorkflowFixturePersistencePayload(input.result),
      p_input_hash: input.inputHash,
      p_client_surface: input.clientSurface,
    }
  )
  if (error) {
    throw new WorkflowRpcError(rpcErrorCode(error.message), error.code)
  }
  return compiledReviewPersistenceSchema.parse(data)
}

export async function persistCompiledWorkflowReviewAutomation(input: {
  supabase: WorkflowSupabaseClient
  companyId: string
  workflowId: string
  bindingSnapshotId: string
  result: WorkflowFixtureRunResult
  inputHash: string
}): Promise<CompiledReviewPersistenceResult> {
  const { data, error } = await input.supabase.rpc(
    "persist_compiled_workflow_review_automation",
    {
      p_company_id: input.companyId,
      p_workflow_id: input.workflowId,
      p_binding_snapshot_id: input.bindingSnapshotId,
      p_payload: createWorkflowFixturePersistencePayload(input.result),
      p_input_hash: input.inputHash,
    }
  )
  if (error) {
    throw new WorkflowRpcError(rpcErrorCode(error.message), error.code)
  }
  return compiledReviewPersistenceSchema.parse(data)
}

function rpcErrorCode(message: string): string {
  const knownCodes = [
    "unauthorized",
    "forbidden",
    "invalid_compiled_workflow_review",
    "invalid_compiled_workflow_payload",
    "invalid_compiled_workflow_contract",
    "workflow_not_found",
    "workflow_not_successfully_compiled",
    "workflow_binding_snapshot_not_found",
    "workflow_binding_snapshot_invalidated",
    "binding_snapshot_not_activatable",
    "workflow_capability_binding_unhealthy",
    "compiled_workflow_manifest_mismatch",
    "workflow_manifest_mismatch",
    "invalid_compiled_review_graph",
    "unsafe_compiled_workflow_action",
    "workflow_run_id_conflict",
    "compiled_event_key_conflict",
    "compiled_item_key_conflict",
    "idempotency_key_reused",
    "signal_activation_not_current",
    "signal_activation_actor_forbidden",
  ]
  return (
    knownCodes.find((candidate) => message.includes(candidate)) ??
    "compiled_workflow_review_persist_failed"
  )
}
