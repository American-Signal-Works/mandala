import "server-only"

import { createAdminClient } from "@/lib/supabase/admin"

/**
 * Read-only verification client for comparing company-scoped persistence state
 * around an in-memory execution. Callers must authenticate and authorize the
 * company before requesting a fingerprint.
 */
export function createPersistenceVerificationAdminClient() {
  return createAdminClient()
}
