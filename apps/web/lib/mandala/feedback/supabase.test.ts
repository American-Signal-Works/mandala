import { describe, expect, it, vi } from "vitest"
import { SupabaseFeedbackRepository } from "./supabase"

const companyId = "20000000-0000-4000-8000-000000000001"
const actorId = "10000000-0000-4000-8000-000000000001"

describe("Supabase feedback repository", () => {
  it("records feedback through the controlled RPC", async () => {
    const record = feedbackRecord()
    const rpc = vi.fn().mockResolvedValue({ data: record, error: null })
    const repository = new SupabaseFeedbackRepository({ rpc } as never)
    await expect(
      repository.capture({ request: feedbackRequest(), actorId })
    ).resolves.toEqual(record)
    expect(rpc).toHaveBeenCalledWith("record_agent_feedback_v1", {
      p_company_id: companyId,
      p_actor_id: actorId,
      p_payload: feedbackRequest(),
    })
  })

  it("maps recommendation conflicts without leaking database errors", async () => {
    const repository = new SupabaseFeedbackRepository({
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: { code: "P0001", message: "recommendation_version_mismatch" },
      }),
    } as never)
    await expect(
      repository.capture({ request: feedbackRequest(), actorId })
    ).rejects.toMatchObject({
      code: "recommendation_version_mismatch",
    })
  })
})

function feedbackRequest() {
  return {
    companyId,
    sourceItemId: "30000000-0000-4000-8000-000000000001",
    recommendationId: "60000000-0000-4000-8000-000000000001",
    recommendationVersion: "rec-v1",
    decision: "accepted" as const,
    correction: null,
    reason: "The recommendation matched the source evidence.",
    outcome: null,
    clientSurface: "cli" as const,
  }
}

function feedbackRecord() {
  return {
    ...feedbackRequest(),
    id: "50000000-0000-4000-8000-000000000001",
    actorId,
    createdAt: "2026-07-14T00:00:00.000Z",
  }
}
