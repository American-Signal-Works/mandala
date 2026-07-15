import { createAdminClient } from "@/lib/supabase/admin"
import { executeWorkflowActionRpc } from "@/lib/mandala/workflows"

type ExecuteWorkflowActionInput = Omit<
  Parameters<typeof executeWorkflowActionRpc>[0],
  "completionSupabase"
>

export function executeAgentActionFromServer(
  input: ExecuteWorkflowActionInput
) {
  return executeWorkflowActionRpc({
    ...input,
    completionSupabase: createAdminClient(),
  })
}
