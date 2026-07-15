import { describe, expect, it, vi } from "vitest"
import type { MemoryCandidate } from "./schema"
import { SupabasePostgresMemoryProvider } from "./supabase"

const companyId = "20000000-0000-4000-8000-000000000001"

describe("Supabase Postgres memory provider", () => {
  it("uses the controlled bounded retrieval RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [candidate()], error: null })
    const provider = new SupabasePostgresMemoryProvider({ rpc } as never)
    const result = await provider.retrieve({
      companyId,
      itemId: "30000000-0000-4000-8000-000000000001",
      maxResults: 5,
      asOf: "2026-07-14T00:00:00.000Z",
    })
    expect(result).toHaveLength(1)
    expect(rpc).toHaveBeenCalledWith("retrieve_agent_memory_v1", {
      p_company_id: companyId,
      p_scope: {
        workspaceId: null,
        agentId: null,
        itemId: "30000000-0000-4000-8000-000000000001",
        vendorId: null,
        productId: null,
        userId: null,
      },
      p_limit: 5,
      p_as_of: "2026-07-14T00:00:00.000Z",
    })
  })

  it("maps malformed provider data to a stable error", async () => {
    const provider = new SupabasePostgresMemoryProvider({
      rpc: vi
        .fn()
        .mockResolvedValue({ data: [{ secret: "raw" }], error: null }),
    } as never)
    await expect(
      provider.retrieve({ companyId, maxResults: 10 })
    ).rejects.toMatchObject({
      code: "provider_invalid_response",
    })
  })

  it("rejects prohibited content before invoking Postgres", async () => {
    const rpc = vi.fn()
    const provider = new SupabasePostgresMemoryProvider({ rpc } as never)
    const record = candidate()
    await expect(
      provider.createCandidate(
        {
          companyId,
          type: record.type,
          content: {
            summary: "authorization: Bearer abcdefghijklmnop",
            facts: [],
          },
          applicability: record.applicability,
          provenance: record.provenance,
          confidence: 0.5,
          expiresAt: null,
          retentionUntil: null,
        },
        { actorId: "10000000-0000-4000-8000-000000000001" }
      )
    ).rejects.toThrow("content is not allowed")
    expect(rpc).not.toHaveBeenCalled()
  })
})

function candidate(): MemoryCandidate {
  return {
    id: "40000000-0000-4000-8000-000000000001",
    companyId,
    type: "preference",
    content: { summary: "Prefer the verified source.", facts: [] },
    applicability: {
      workspaceId: null,
      agentId: null,
      itemId: null,
      vendorId: null,
      productId: null,
      userId: null,
    },
    provenance: {
      sourceFeedbackId: "50000000-0000-4000-8000-000000000001",
      sourceOutcomeId: null,
      sourceItemId: "30000000-0000-4000-8000-000000000001",
      recommendationId: "60000000-0000-4000-8000-000000000001",
      recommendationVersion: "rec-v1",
    },
    confidence: 0.8,
    status: "approved",
    reviewerId: "10000000-0000-4000-8000-000000000001",
    reviewedAt: "2026-07-14T00:00:00.000Z",
    approvedAt: "2026-07-14T00:00:00.000Z",
    expiresAt: null,
    retentionUntil: null,
    supersededById: null,
    forgottenAt: null,
    revokedAt: null,
    createdAt: "2026-07-14T00:00:00.000Z",
    updatedAt: "2026-07-14T00:00:00.000Z",
  }
}
