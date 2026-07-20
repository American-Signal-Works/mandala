import "server-only"

import { createAdminClient } from "@/lib/supabase/admin"

/**
 * Server-only client for company-scoped connector catalog reads. API callers
 * must authenticate and authorize the company before this client is created.
 */
export function createWorkspaceDataAdminClient() {
  return createAdminClient()
}
