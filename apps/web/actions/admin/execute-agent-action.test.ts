import { describe, expect, it, vi } from "vitest"
import { createAdminClient } from "@/lib/supabase/admin"
import { executeWorkflowActionRpc } from "@/lib/mandala/workflows"
import { executeAgentActionFromServer } from "./execute-agent-action"

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }))
vi.mock("@/lib/mandala/workflows", () => ({
  executeWorkflowActionRpc: vi.fn(),
}))

describe("server-owned agent action execution", () => {
  it("keeps the service-role completion client inside the admin boundary", async () => {
    const completionSupabase = { role: "service-role" }
    vi.mocked(createAdminClient).mockReturnValue(completionSupabase as never)
    vi.mocked(executeWorkflowActionRpc).mockResolvedValue({} as never)

    const input = { companyId: "company" }
    await executeAgentActionFromServer(input as never)

    expect(executeWorkflowActionRpc).toHaveBeenCalledWith({
      ...input,
      completionSupabase,
    })
  })
})
