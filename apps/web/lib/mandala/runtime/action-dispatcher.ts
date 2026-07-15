import {
  currentSkillActionVersion,
  type ActionExecutionRequest,
  type ActionExecutionResult,
} from "../actions"
import type { RuntimeActionHandler } from "./graph"

export type RuntimeDispatchContext = {
  itemId: string | null
  approvalId: string | null
  idempotencyKey: string
  expected: ActionExecutionRequest["expected"]
}

export function createRegistryRuntimeActionHandler(input: {
  dispatch: (request: ActionExecutionRequest) => Promise<ActionExecutionResult>
  context: (
    runtime: Parameters<RuntimeActionHandler>[0]
  ) => RuntimeDispatchContext
}): RuntimeActionHandler {
  return async (runtime) => {
    const context = input.context(runtime)
    const result = await input.dispatch({
      companyId: runtime.state.companyId,
      agentId: runtime.state.workflowDefinitionId,
      workflowRunId: runtime.state.workflowRunId,
      itemId: context.itemId,
      actorId: runtime.state.actorId,
      actionId: runtime.action.id,
      actionVersion: currentSkillActionVersion,
      capabilityId: runtime.action.capability,
      capabilityVersion: runtime.binding.version,
      connectorId: runtime.binding.connectorId,
      schemaDigest: runtime.binding.schemaDigest,
      mode: runtime.state.mode,
      idempotencyKey: context.idempotencyKey,
      input: runtime.state.review?.draft?.payload ?? {},
      approvalId: context.approvalId,
      expected: context.expected,
    })

    return {
      attemptId: result.executionId,
      status: result.status,
      output: result.output ?? {},
      code: result.code,
      retryClass: result.retryClass,
      replayed: result.replayed,
    }
  }
}
