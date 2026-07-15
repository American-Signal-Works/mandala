import { beforeEach, describe, expect, it, vi } from "vitest"
import { routeContextualChat } from "@/lib/mandala/control-plane/contextual-chat"
import { getWorkflowReview } from "@/lib/mandala/control-plane/queries"
import { getCompanyMembership } from "@/lib/mandala/workflows"
import { authenticateRequest } from "@/lib/supabase/request"
import { POST } from "./route"

vi.mock("@/lib/supabase/request", () => ({ authenticateRequest: vi.fn() }))
vi.mock("@/actions/admin/provider-usage", () => ({
  createServerModelUsageRecorder: vi.fn(() => vi.fn()),
}))
vi.mock("@/lib/mandala/workflows", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/lib/mandala/workflows")>()
  return { ...original, getCompanyMembership: vi.fn() }
})
vi.mock("@/lib/mandala/control-plane/contextual-chat", () => ({
  routeContextualChat: vi.fn(),
}))
vi.mock("@/lib/mandala/control-plane/queries", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/lib/mandala/control-plane/queries")>()
  return { ...original, getWorkflowReview: vi.fn() }
})

const companyId = "10000000-0000-4000-8000-000000000001"
const conversationId = "20000000-0000-4000-8000-000000000001"
const auth = {
  authMode: "bearer",
  supabase: {},
  user: { id: "30000000-0000-4000-8000-000000000001" },
}

describe("contextual chat route", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateRequest).mockResolvedValue(auth as never)
    vi.mocked(getCompanyMembership).mockResolvedValue({ role: "member" })
    vi.mocked(routeContextualChat).mockResolvedValue({
      route: "clarification",
      message: "Which item do you mean?",
      companyId,
      selectedItemId: null,
      reviewVersion: null,
      command: null,
      confirmationRequired: false,
      mutated: false,
    })
  })

  it("requires authentication", async () => {
    vi.mocked(authenticateRequest).mockResolvedValue(null)
    const response = await POST(chatRequest())

    expect(response.status).toBe(401)
    expect(getCompanyMembership).not.toHaveBeenCalled()
  })

  it("rejects users outside the explicit company context", async () => {
    vi.mocked(getCompanyMembership).mockResolvedValue(null)
    const response = await POST(chatRequest())

    expect(response.status).toBe(403)
    expect(routeContextualChat).not.toHaveBeenCalled()
  })

  it("returns a no-store, non-mutating chat result", async () => {
    const response = await POST(chatRequest())

    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    await expect(response.json()).resolves.toMatchObject({
      route: "clarification",
      mutated: false,
    })
    expect(getCompanyMembership).toHaveBeenCalledWith({
      supabase: auth.supabase,
      companyId,
      userId: auth.user.id,
    })
  })

  it("reads a selected review version without confusing its database activity page for a public cursor", async () => {
    vi.mocked(getWorkflowReview).mockResolvedValue({
      version: "review-v2",
      activity: { items: [], nextPage: null },
    } as never)
    vi.mocked(routeContextualChat).mockImplementationOnce(
      async (request, dependencies) => ({
        route: "question",
        message: "The selected item is current.",
        companyId: request.companyId,
        selectedItemId: request.selectedItemId,
        reviewVersion: await dependencies.getReviewVersion(
          request.selectedItemId!
        ),
        command: null,
        confirmationRequired: false,
        mutated: false,
      })
    )

    const response = await POST(
      chatRequest({
        input: "What changed?",
        selectedItemId: "40000000-0000-4000-8000-000000000001",
        expectedReviewVersion: "review-v2",
      })
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      route: "question",
      reviewVersion: "review-v2",
    })
  })
})

function chatRequest(
  overrides: Partial<{
    input: string
    selectedItemId: string | null
    expectedReviewVersion: string | null
  }> = {}
) {
  return new Request("http://localhost/api/mandala/control/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      companyId,
      input: "What needs attention?",
      selectedItemId: null,
      expectedReviewVersion: null,
      conversationId,
      ...overrides,
    }),
  })
}
