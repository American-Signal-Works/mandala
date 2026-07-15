import type { WorkflowSupabaseClient } from "../workflows"
import {
  MemoryProviderError,
  type GovernedMemoryProvider,
  type MemoryProviderContext,
} from "./provider"
import {
  createMemoryCandidateSchema,
  memoryCandidateSchema,
  memoryForgetReceiptSchema,
  type CreateMemoryCandidate,
  type MemoryCandidate,
  type MemoryRetrievalRequest,
  type MemoryReviewRequest,
} from "./schema"

type RpcResult = {
  data: unknown
  error: { code?: string; message: string } | null
}

type RpcInvoker = (
  functionName: string,
  args: Record<string, unknown>
) => PromiseLike<RpcResult>

export class SupabasePostgresMemoryProvider implements GovernedMemoryProvider {
  readonly name = "supabase-postgres-v1"
  private readonly rpc: RpcInvoker

  constructor(supabase: WorkflowSupabaseClient) {
    this.rpc = supabase.rpc.bind(supabase) as unknown as RpcInvoker
  }

  async createCandidate(
    candidate: CreateMemoryCandidate,
    context: MemoryProviderContext
  ): Promise<MemoryCandidate> {
    const safeCandidate = createMemoryCandidateSchema.parse(candidate)
    return this.parseCandidate(
      await this.invoke("create_agent_memory_candidate_v1", {
        p_company_id: safeCandidate.companyId,
        p_actor_id: context.actorId,
        p_payload: safeCandidate,
      })
    )
  }

  async reviewCandidate(
    request: MemoryReviewRequest,
    context: MemoryProviderContext
  ): Promise<MemoryCandidate> {
    return this.parseCandidate(
      await this.invoke("review_agent_memory_candidate_v1", {
        p_company_id: request.companyId,
        p_candidate_id: request.candidateId,
        p_actor_id: context.actorId,
        p_decision: request.decision,
        p_reason: request.reason,
        p_expires_at: request.expiresAt ?? null,
        p_expected_updated_at: request.expectedUpdatedAt,
      })
    )
  }

  async retrieve(request: MemoryRetrievalRequest): Promise<MemoryCandidate[]> {
    const result = await this.invoke("retrieve_agent_memory_v1", {
      p_company_id: request.companyId,
      p_scope: {
        workspaceId: request.workspaceId ?? null,
        agentId: request.agentId ?? null,
        itemId: request.itemId ?? null,
        vendorId: request.vendorId ?? null,
        productId: request.productId ?? null,
        userId: request.userId ?? null,
      },
      p_limit: request.maxResults,
      p_as_of: request.asOf ?? new Date().toISOString(),
    })
    const parsed = memoryCandidateSchema.array().safeParse(result)
    if (!parsed.success)
      throw new MemoryProviderError("provider_invalid_response", {
        cause: parsed.error,
      })
    return parsed.data
  }

  async forgetCandidate(input: {
    companyId: string
    candidateId: string
    reason: string
    expectedUpdatedAt: string
    actorId: string
  }) {
    const result = await this.invoke("forget_agent_memory_candidate_v1", {
      p_company_id: input.companyId,
      p_candidate_id: input.candidateId,
      p_actor_id: input.actorId,
      p_reason: input.reason,
      p_expected_updated_at: input.expectedUpdatedAt,
    })
    const parsed = memoryForgetReceiptSchema.safeParse(result)
    if (!parsed.success)
      throw new MemoryProviderError("provider_invalid_response", {
        cause: parsed.error,
      })
    return parsed.data
  }

  async exportCompany(input: {
    companyId: string
  }): Promise<MemoryCandidate[]> {
    const result = await this.invoke("export_agent_memory_v1", {
      p_company_id: input.companyId,
    })
    const parsed = memoryCandidateSchema.array().safeParse(result)
    if (!parsed.success)
      throw new MemoryProviderError("provider_invalid_response", {
        cause: parsed.error,
      })
    return parsed.data
  }

  private async invoke(
    functionName: string,
    args: Record<string, unknown>
  ): Promise<unknown> {
    const { data, error } = await this.rpc(functionName, args)
    if (!error) return data

    const knownCodes = [
      "candidate_not_found",
      "invalid_state",
      "stale_version",
    ] as const
    const known = knownCodes.find((code) => error.message.includes(code))
    throw new MemoryProviderError(known ?? "provider_unavailable", {
      cause: error,
    })
  }

  private parseCandidate(value: unknown): MemoryCandidate {
    const parsed = memoryCandidateSchema.safeParse(value)
    if (!parsed.success)
      throw new MemoryProviderError("provider_invalid_response", {
        cause: parsed.error,
      })
    return parsed.data
  }
}
