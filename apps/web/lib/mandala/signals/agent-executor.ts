import { runSignalAgentTrigger } from "../agents/signal-run"
import { ManualRunAgentNotActiveError } from "../agents/manual-run"
import { WorkspaceDataProviderError } from "../workspace-data/provider"
import type { WorkflowSupabaseClient } from "../workflows"
import { SignalExecutionError, type SignalDispatchExecutor } from "./worker"

export function createAgentSignalExecutor(input: {
  supabase: WorkflowSupabaseClient
  dataSupabase?: WorkflowSupabaseClient
  run?: typeof runSignalAgentTrigger
}): SignalDispatchExecutor {
  const run = input.run ?? runSignalAgentTrigger
  return {
    async execute(dispatch) {
      try {
        const result = await run({
          supabase: input.supabase,
          dataSupabase: input.dataSupabase,
          dispatch,
        })
        return {
          status: result.status === "suppressed" ? "suppressed" : "completed",
          result: {
            workflowRunId: result.workflowRunId,
            itemId: result.itemId,
            runStatus: result.status,
            entityKey: result.entity.key,
            entityValue: result.entity.value,
            duplicate: result.duplicate,
            externalWriteAttempted: false,
          },
        }
      } catch (error) {
        if (
          error instanceof WorkspaceDataProviderError &&
          error.code === "qualifying_signal_not_found"
        ) {
          return {
            status: "suppressed",
            result: {
              reason: "qualifying_signal_not_found",
              externalWriteAttempted: false,
            },
          }
        }
        throw classifySignalRunError(error)
      }
    },
  }
}

function classifySignalRunError(error: unknown) {
  if (error instanceof ManualRunAgentNotActiveError) {
    return new SignalExecutionError("agent_not_active", false, {
      cause: error,
    })
  }
  const message = error instanceof Error ? error.message : ""
  const terminalCodes = [
    "agent_runtime_state_not_found",
    "signal_activation_not_current",
    "signal_activation_not_found",
    "signal_binding_snapshot_not_current",
    "signal_trigger_not_declared",
    "agent_binding_snapshot_missing",
    "signal_activation_actor_forbidden",
  ]
  const terminal = terminalCodes.find((code) => message.includes(code))
  if (terminal) {
    return new SignalExecutionError(terminal, false, { cause: error })
  }
  if (error instanceof WorkspaceDataProviderError) {
    return new SignalExecutionError("workspace_data_unavailable", true, {
      cause: error,
    })
  }
  return new SignalExecutionError("signal_agent_run_failed", true, {
    cause: error,
  })
}
