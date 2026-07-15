import type { WorkflowSupabaseClient } from "../workflows"
import {
  MonitoringRepositoryError,
  type FollowUpSchedulerRepository,
} from "./repository"
import {
  followUpRecordSchema,
  type FollowUpRecord,
  type FollowUpScheduleRequest,
} from "./schema"

type RpcInvoker = (
  functionName: string,
  args: Record<string, unknown>
) => PromiseLike<{
  data: unknown
  error: { code?: string; message: string } | null
}>

export class SupabaseFollowUpScheduler implements FollowUpSchedulerRepository {
  private readonly rpc: RpcInvoker

  constructor(supabase: WorkflowSupabaseClient) {
    this.rpc = supabase.rpc.bind(supabase) as unknown as RpcInvoker
  }

  async schedule(input: {
    request: FollowUpScheduleRequest
    actorId: string
  }): Promise<FollowUpRecord> {
    const { data, error } = await this.rpc("schedule_agent_follow_up_v1", {
      p_company_id: input.request.companyId,
      p_actor_id: input.actorId,
      p_payload: input.request,
    })
    if (error) {
      const knownCodes = ["follow_up_not_found", "stale_version"] as const
      const known = knownCodes.find((code) => error.message.includes(code))
      throw new MonitoringRepositoryError(known ?? "repository_unavailable", {
        cause: error,
      })
    }
    const parsed = followUpRecordSchema.safeParse(data)
    if (!parsed.success)
      throw new MonitoringRepositoryError("repository_invalid_response", {
        cause: parsed.error,
      })
    return parsed.data
  }
}
