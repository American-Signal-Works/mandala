import "server-only"

import { answerWorkspaceQuestion } from "@/lib/mandala/control-plane/workspace-question"
import { createAdminClient } from "@/lib/supabase/admin"

// Membership and CLI workspace scope are verified by the route before this
// helper is called. Connector configuration stays server-only while the
// bounded query remains explicitly scoped to one company.
export function answerServerWorkspaceQuestion(input: {
  companyId: string
  question: string
}) {
  return answerWorkspaceQuestion({
    supabase: createAdminClient(),
    companyId: input.companyId,
    question: input.question,
  })
}
