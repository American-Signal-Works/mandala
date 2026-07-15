import "server-only"

import { createAdminClient } from "@/lib/supabase/admin"

export function createEmailPayloadAdminClient() {
  return createAdminClient()
}
