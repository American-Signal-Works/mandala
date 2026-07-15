import "server-only"
import { createModelUsageRecorder } from "@/lib/mandala/usage"
import { createAdminClient } from "@/lib/supabase/admin"

// This is an internal server helper, not a Server Action. Keeping the
// service-role client here prevents browser/CLI callers from forging usage.
export function createServerModelUsageRecorder(input: {
  companyId: string
  actorUserId: string
  sourceOperation: string
  workflowRunId?: string | null
}) {
  return createModelUsageRecorder({
    supabase: createAdminClient,
    ...input,
  })
}
