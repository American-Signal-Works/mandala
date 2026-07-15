import "server-only"

import { createAdminClient } from "@/lib/supabase/admin"

export function createInvitationHandoffAdminClient() {
  return createAdminClient()
}
