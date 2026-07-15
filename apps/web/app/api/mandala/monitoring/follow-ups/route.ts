import { z } from "zod"
import {
  MonitoringRepositoryError,
  SupabaseFollowUpScheduler,
  scheduleFollowUp,
} from "@/lib/mandala/monitoring"
import { getCompanyMembership } from "@/lib/mandala/workflows"
import { authenticateRequest } from "@/lib/supabase/request"
import { monitoringJson, parseMonitoringJson } from "../http"

export const runtime = "nodejs"

export async function POST(request: Request) {
  const auth = await authenticateRequest(request)
  if (!auth) return monitoringJson({ error: "unauthorized" }, 401)
  const body = await parseMonitoringJson(request)
  const companyId = z
    .string()
    .uuid()
    .safeParse(
      typeof body === "object" && body !== null && "companyId" in body
        ? body.companyId
        : null
    )
  if (!companyId.success)
    return monitoringJson({ error: "invalid_request" }, 400)

  try {
    const membership = await getCompanyMembership({
      supabase: auth.supabase,
      companyId: companyId.data,
      userId: auth.user.id,
    })
    if (!membership || !new Set(["owner", "admin"]).has(membership.role))
      return monitoringJson({ error: "forbidden" }, 403)
    const followUp = await scheduleFollowUp({
      repository: new SupabaseFollowUpScheduler(auth.supabase),
      actorId: auth.user.id,
      request: body,
    })
    return monitoringJson({ followUp })
  } catch (error) {
    if (error instanceof z.ZodError)
      return monitoringJson(
        { error: "invalid_request", issues: error.flatten().fieldErrors },
        400
      )
    if (error instanceof MonitoringRepositoryError) {
      const statuses = {
        follow_up_not_found: 404,
        lease_lost: 409,
        stale_version: 409,
        repository_unavailable: 503,
        repository_invalid_response: 502,
      } as const
      return monitoringJson({ error: error.code }, statuses[error.code])
    }
    return monitoringJson({ error: "follow_up_schedule_failed" }, 500)
  }
}
