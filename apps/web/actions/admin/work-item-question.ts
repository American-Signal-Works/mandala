import "server-only"

import type { WorkItemDetail } from "@workspace/control-plane"
import { loadWorkItemQuestionModelContext } from "@/lib/mandala/control-plane/work-item-model-context"
import { createAdminClient } from "@/lib/supabase/admin"

// The calling routes verify CLI workspace scope and membership before reaching
// this helper. Model projection needs server-owned workflow metadata that is
// intentionally unavailable through the member-scoped database client.
export function loadServerWorkItemQuestionModelContext(input: {
  companyId: string
  itemId: string
  detail: WorkItemDetail
}) {
  return loadWorkItemQuestionModelContext({
    supabase: createAdminClient(),
    ...input,
  })
}
