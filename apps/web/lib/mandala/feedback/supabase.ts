import type { WorkflowSupabaseClient } from "../workflows"
import { FeedbackRepositoryError, type FeedbackRepository } from "./repository"
import {
  feedbackRecordSchema,
  type FeedbackCaptureRequest,
  type FeedbackRecord,
} from "./schema"

type RpcInvoker = (
  functionName: string,
  args: Record<string, unknown>
) => PromiseLike<{
  data: unknown
  error: { code?: string; message: string } | null
}>

export class SupabaseFeedbackRepository implements FeedbackRepository {
  private readonly rpc: RpcInvoker

  constructor(supabase: WorkflowSupabaseClient) {
    this.rpc = supabase.rpc.bind(supabase) as unknown as RpcInvoker
  }

  async capture(input: {
    request: Omit<FeedbackCaptureRequest, "memorySuggestion">
    actorId: string
  }): Promise<FeedbackRecord> {
    const { data, error } = await this.rpc("record_agent_feedback_v1", {
      p_company_id: input.request.companyId,
      p_actor_id: input.actorId,
      p_payload: input.request,
    })
    if (error) {
      const knownCodes = [
        "recommendation_not_found",
        "recommendation_version_mismatch",
        "source_item_mismatch",
        "feedback_conflict",
      ] as const
      const known = knownCodes.find((code) => error.message.includes(code))
      throw new FeedbackRepositoryError(known ?? "repository_unavailable", {
        cause: error,
      })
    }
    const parsed = feedbackRecordSchema.safeParse(data)
    if (!parsed.success)
      throw new FeedbackRepositoryError("repository_invalid_response", {
        cause: parsed.error,
      })
    return parsed.data
  }
}
