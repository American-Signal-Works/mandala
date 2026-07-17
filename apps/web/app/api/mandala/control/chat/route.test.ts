import { beforeEach, describe, expect, it, vi } from "vitest"
import { routeContextualChat } from "@/lib/mandala/control-plane/contextual-chat"
import {
  getWorkflowItemDetail,
  getWorkflowReview,
} from "@/lib/mandala/control-plane/queries"
import { streamWorkItemQuestion } from "@/lib/mandala/control-plane/work-item-question"
import { loadWorkItemQuestionModelContext } from "@/lib/mandala/control-plane/work-item-model-context"
import { getCompanyMembership } from "@/lib/mandala/workflows"
import { authenticateRequest } from "@/lib/supabase/request"
import { POST } from "./route"

vi.mock("@/lib/supabase/request", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase/request")>()),
  authenticateRequest: vi.fn(),
}))
vi.mock("@/actions/admin/provider-usage", () => ({
  createServerModelUsageRecorder: vi.fn(() => vi.fn()),
}))
vi.mock("@/lib/mandala/workflows", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/lib/mandala/workflows")>()
  return { ...original, getCompanyMembership: vi.fn() }
})
vi.mock(
  "@/lib/mandala/control-plane/contextual-chat",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("@/lib/mandala/control-plane/contextual-chat")
    >()),
    routeContextualChat: vi.fn(),
  })
)
vi.mock(
  "@/lib/mandala/control-plane/work-item-question",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("@/lib/mandala/control-plane/work-item-question")
    >()),
    streamWorkItemQuestion: vi.fn(),
  })
)
vi.mock("@/lib/mandala/control-plane/work-item-model-context", () => ({
  loadWorkItemQuestionModelContext: vi.fn(),
}))
vi.mock("@/lib/mandala/control-plane/queries", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/lib/mandala/control-plane/queries")>()
  return {
    ...original,
    getWorkflowItemDetail: vi.fn(),
    getWorkflowReview: vi.fn(),
  }
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
    vi.mocked(loadWorkItemQuestionModelContext).mockResolvedValue({
      projectedData: {},
      capabilityAliases: [],
    })
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
    const response = await POST(chatRequest({}, "application/x-ndjson"))

    expect(response.status).toBe(401)
    expect(getCompanyMembership).not.toHaveBeenCalled()
    expect(streamWorkItemQuestion).not.toHaveBeenCalled()
  })

  it("rejects users outside the explicit company context", async () => {
    vi.mocked(getCompanyMembership).mockResolvedValue(null)
    const response = await POST(chatRequest({}, "application/x-ndjson"))

    expect(response.status).toBe(403)
    expect(routeContextualChat).not.toHaveBeenCalled()
    expect(streamWorkItemQuestion).not.toHaveBeenCalled()
  })

  it("rejects a managed CLI session outside its approved workspace scope", async () => {
    vi.mocked(authenticateRequest).mockResolvedValue({
      ...auth,
      cliSession: {
        managed: true,
        sessionId: "50000000-0000-4000-8000-000000000001",
        selectedCompanyId: "10000000-0000-4000-8000-000000000002",
        scopes: ["workspace:control"],
      },
    } as never)
    const response = await POST(chatRequest({}, "application/x-ndjson"))

    expect(response.status).toBe(403)
    expect(getCompanyMembership).not.toHaveBeenCalled()
    expect(streamWorkItemQuestion).not.toHaveBeenCalled()
  })

  it("rejects a managed CLI session missing the control scope", async () => {
    vi.mocked(authenticateRequest).mockResolvedValue({
      ...auth,
      cliSession: {
        managed: true,
        sessionId: "50000000-0000-4000-8000-000000000001",
        selectedCompanyId: companyId,
        scopes: [],
      },
    } as never)

    const response = await POST(chatRequest({}, "application/x-ndjson"))

    expect(response.status).toBe(403)
    expect(getCompanyMembership).not.toHaveBeenCalled()
    expect(streamWorkItemQuestion).not.toHaveBeenCalled()
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

  it("streams an authorized current selected-item question as ordered NDJSON", async () => {
    vi.mocked(getWorkflowReview).mockResolvedValue({
      version: "review-v2",
    } as never)
    vi.mocked(getWorkflowItemDetail).mockResolvedValue(
      workItemDetail() as never
    )
    vi.mocked(streamWorkItemQuestion).mockImplementationOnce(
      async (_input, onDelta) => {
        onDelta("Current stock is ")
        onDelta("below the reorder point.")
        return {
          answer: "Current stock is below the reorder point.",
          model: "openai/gpt-5.4-mini",
          durationMs: 25,
          trace: null,
        }
      }
    )

    const response = await POST(
      chatRequest(
        {
          input: "Why this quantity?",
          selectedItemId: "40000000-0000-4000-8000-000000000001",
          expectedReviewVersion: "review-v2",
        },
        "application/x-ndjson"
      )
    )

    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toContain(
      "application/x-ndjson"
    )
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    const events = (await response.text())
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line))
    expect(events.map(({ type }) => type)).toEqual([
      "start",
      "delta",
      "delta",
      "done",
    ])
    expect(streamWorkItemQuestion).toHaveBeenCalledTimes(1)
    expect(getWorkflowItemDetail).toHaveBeenCalledWith(
      expect.objectContaining({ companyId })
    )
  })

  it("returns stale questions as JSON before starting model work", async () => {
    vi.mocked(getWorkflowReview).mockResolvedValue({
      version: "review-v3",
    } as never)

    const response = await POST(
      chatRequest(
        {
          input: "Why this quantity?",
          selectedItemId: "40000000-0000-4000-8000-000000000001",
          expectedReviewVersion: "review-v2",
        },
        "application/x-ndjson"
      )
    )

    expect(response.headers.get("content-type")).toContain("application/json")
    await expect(response.json()).resolves.toMatchObject({
      route: "blocked",
      reviewVersion: "review-v3",
    })
    expect(streamWorkItemQuestion).not.toHaveBeenCalled()
    expect(getWorkflowItemDetail).not.toHaveBeenCalled()
  })

  it("keeps explicit action language on the typed JSON command path", async () => {
    vi.mocked(routeContextualChat).mockResolvedValueOnce({
      route: "command",
      message: "Review and confirm this action.",
      companyId,
      selectedItemId: "40000000-0000-4000-8000-000000000001",
      reviewVersion: "review-v2",
      command: { kind: "record_decision", decision: "approve" },
      confirmationRequired: true,
      mutated: false,
    })

    const response = await POST(
      chatRequest(
        {
          input: "Can you approve it?",
          selectedItemId: "40000000-0000-4000-8000-000000000001",
          expectedReviewVersion: "review-v2",
        },
        "application/x-ndjson"
      )
    )

    expect(response.headers.get("content-type")).toContain("application/json")
    await expect(response.json()).resolves.toMatchObject({ route: "command" })
    expect(streamWorkItemQuestion).not.toHaveBeenCalled()
  })

  it("does not start the model when the request aborts during context loading", async () => {
    vi.mocked(getWorkflowReview).mockResolvedValue({
      version: "review-v2",
    } as never)
    vi.mocked(getWorkflowItemDetail).mockResolvedValue(
      workItemDetail() as never
    )
    let releaseContext: (() => void) | undefined
    vi.mocked(loadWorkItemQuestionModelContext).mockImplementationOnce(
      async () => {
        await new Promise<void>((resolve) => {
          releaseContext = resolve
        })
        return { projectedData: {}, capabilityAliases: [] }
      }
    )
    const abort = new AbortController()
    const pending = POST(
      chatRequest(
        {
          input: "Why this quantity?",
          selectedItemId: "40000000-0000-4000-8000-000000000001",
          expectedReviewVersion: "review-v2",
        },
        "application/x-ndjson",
        abort.signal
      )
    )
    await vi.waitFor(() =>
      expect(loadWorkItemQuestionModelContext).toHaveBeenCalledTimes(1)
    )

    abort.abort()
    releaseContext?.()
    const response = await pending

    expect(response.status).toBe(499)
    expect(streamWorkItemQuestion).not.toHaveBeenCalled()
  })
})

function chatRequest(
  overrides: Partial<{
    input: string
    selectedItemId: string | null
    expectedReviewVersion: string | null
  }> = {},
  accept = "application/json",
  signal?: AbortSignal
) {
  return new Request("http://localhost/api/mandala/control/chat", {
    method: "POST",
    headers: { accept, "content-type": "application/json" },
    signal,
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

function workItemDetail() {
  const createdAt = "2026-07-13T00:42:30.675Z"
  const itemId = "40000000-0000-4000-8000-000000000001"
  const runId = "30000000-0000-4000-8000-000000000001"
  return {
    item: {
      id: itemId,
      workflowRunId: runId,
      itemType: "procurement_reorder_review",
      title: "Review reorder",
      status: "active",
      priority: 50,
      resolutionState: {},
      createdAt,
      updatedAt: createdAt,
    },
    contextPacket: {
      id: "60000000-0000-4000-8000-000000000001",
      sources: [],
      facts: {},
      memoryRefs: [],
      freshnessState: "fresh",
      warnings: [],
      createdAt,
    },
    recommendation: {
      id: "90000000-0000-4000-8000-000000000001",
      status: "ready_for_review",
      rationaleSummary: "Order 24 units.",
      warningState: "pass",
      warnings: [],
      confidence: 0.82,
      confidenceMarker: {
        version: "1.0.0",
        score: 0.82,
        sourceCoverage: "partial",
        freshness: "fresh",
        agreement: "consistent",
        policyChecks: "passed",
        missingInputs: [],
        explanation: "Source coverage is partial.",
      },
      freshnessState: "fresh",
      output: { recommendedQuantity: 24 },
      createdAt,
    },
    evidence: null,
    draft: null,
    decision: null,
    attempt: null,
    auditEvents: [],
  }
}
