import { beforeEach, describe, expect, it, vi } from "vitest"
import { loadWorkItemQuestionModelContext } from "@/lib/mandala/control-plane/work-item-model-context"
import { createAdminClient } from "@/lib/supabase/admin"
import { loadServerWorkItemQuestionModelContext } from "./work-item-question"

vi.mock("@/lib/mandala/control-plane/work-item-model-context", () => ({
  loadWorkItemQuestionModelContext: vi.fn(),
}))
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}))

describe("server work-item question context", () => {
  beforeEach(() => vi.clearAllMocks())

  it("loads server-owned workflow metadata with the admin client", async () => {
    const admin = { kind: "admin" }
    const detail = { item: { id: "item-1" } }
    vi.mocked(createAdminClient).mockReturnValue(admin as never)
    vi.mocked(loadWorkItemQuestionModelContext).mockResolvedValue({
      projectedData: {},
      capabilityAliases: [],
    })

    await loadServerWorkItemQuestionModelContext({
      companyId: "10000000-0000-4000-8000-000000000001",
      itemId: "20000000-0000-4000-8000-000000000001",
      detail: detail as never,
    })

    expect(loadWorkItemQuestionModelContext).toHaveBeenCalledWith({
      supabase: admin,
      companyId: "10000000-0000-4000-8000-000000000001",
      itemId: "20000000-0000-4000-8000-000000000001",
      detail,
    })
  })
})
