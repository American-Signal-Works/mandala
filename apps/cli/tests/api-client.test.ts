import { describe, expect, it, vi } from "vitest"
import { ApiClient } from "../src/api-client.js"

describe("API client", () => {
  it("classifies a refused connection as definitely unavailable", async () => {
    const refusal = Object.assign(new Error("connect refused"), {
      code: "ECONNREFUSED",
    })
    const client = new ApiClient(
      "http://127.0.0.1:3000",
      { getAccessToken: vi.fn().mockResolvedValue("access") },
      vi
        .fn<typeof fetch>()
        .mockRejectedValue(new TypeError("fetch failed", { cause: refusal }))
    )

    await expect(client.listCompanies()).rejects.toMatchObject({
      code: "api_unavailable",
    })
  })

  it("keeps an unclassified transport failure ambiguous", async () => {
    const client = new ApiClient(
      "http://127.0.0.1:3000",
      { getAccessToken: vi.fn().mockResolvedValue("access") },
      vi.fn<typeof fetch>().mockRejectedValue(new TypeError("fetch failed"))
    )

    await expect(client.listCompanies()).rejects.toMatchObject({
      code: "network_error",
    })
  })

  it("retries one unauthorized response with a forced session refresh", async () => {
    const getAccessToken = vi
      .fn()
      .mockResolvedValueOnce("expired-access")
      .mockResolvedValueOnce("fresh-access")
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ error: "unauthorized" }, { status: 401 })
      )
      .mockResolvedValueOnce(
        Response.json({
          companies: [
            {
              id: "20000000-0000-4000-8000-000000000001",
              name: "Example",
              role: "owner",
              updatedAt: "2026-07-09T12:00:00.000Z",
            },
          ],
        })
      )
    const client = new ApiClient(
      "http://127.0.0.1:3000",
      { getAccessToken },
      request
    )

    const result = await client.listCompanies()

    expect(result.companies).toHaveLength(1)
    expect(getAccessToken).toHaveBeenNthCalledWith(1, false)
    expect(getAccessToken).toHaveBeenNthCalledWith(2, true)
    expect(request.mock.calls[0]?.[1]?.headers).toMatchObject({
      authorization: "Bearer expired-access",
    })
    expect(request.mock.calls[1]?.[1]?.headers).toMatchObject({
      authorization: "Bearer fresh-access",
    })
  })

  it("does not include incompatible response bodies in errors", async () => {
    const client = new ApiClient(
      "http://127.0.0.1:3000",
      { getAccessToken: vi.fn().mockResolvedValue("access-secret") },
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          Response.json({ rawToken: "action-secret", unexpected: true })
        )
    )

    await expect(client.listCompanies()).rejects.toMatchObject({
      code: "invalid_api_response",
    })
    await expect(client.listCompanies()).rejects.not.toThrow(/action-secret/)
  })

  it("posts direct execution-token and execution contracts", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          decisionId: "50000000-0000-4000-8000-000000000001",
          executionToken: {
            id: "60000000-0000-4000-8000-000000000001",
            rawToken: "x".repeat(64),
            expiresAt: "2026-07-09T12:15:00.000Z",
          },
        })
      )
      .mockResolvedValueOnce(
        Response.json({
          attempt: {
            id: "70000000-0000-4000-8000-000000000001",
            status: "succeeded",
          },
          draft: {
            id: "40000000-0000-4000-8000-000000000001",
            status: "executed",
          },
          item: {
            id: "30000000-0000-4000-8000-000000000001",
            status: "executed",
          },
          duplicate: false,
        })
      )
    const client = new ApiClient(
      "http://127.0.0.1:3000",
      { getAccessToken: vi.fn().mockResolvedValue("access") },
      request
    )
    const companyId = "20000000-0000-4000-8000-000000000001"
    const actionDraftId = "40000000-0000-4000-8000-000000000001"

    const capability = await client.issueExecutionToken({
      companyId,
      actionDraftId,
    })
    await client.execute({
      companyId,
      actionDraftId,
      decisionId: capability.decisionId,
      rawToken: capability.executionToken.rawToken,
      idempotencyKey: "cli:00000000-0000-4000-8000-000000000001",
      payload: { mode: "mock" },
    })

    expect(request.mock.calls[0]?.[0]).toBe(
      "http://127.0.0.1:3000/api/mandala/workflows/execution-tokens"
    )
    expect(JSON.parse(String(request.mock.calls[1]?.[1]?.body))).toMatchObject({
      rawToken: "x".repeat(64),
      decisionId: "50000000-0000-4000-8000-000000000001",
    })
  })

  it("posts the exact control-audit request without raw input or server-derived fields", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        request: {
          id: "90000000-0000-4000-8000-000000000001",
          company_id: "20000000-0000-4000-8000-000000000001",
        },
      })
    )
    const client = new ApiClient(
      "http://127.0.0.1:3000",
      { getAccessToken: vi.fn().mockResolvedValue("access") },
      request
    )

    await client.recordControlRequest({
      companyId: "20000000-0000-4000-8000-000000000001",
      inputHash: "a".repeat(64),
      normalizedIntent: { kind: "unresolved", outcome: "blocked" },
      parserKind: "explicit",
      resolutionStatus: "blocked",
      riskClass: "read",
    })

    const body = JSON.parse(String(request.mock.calls[0]?.[1]?.body))
    expect(body).toEqual({
      companyId: "20000000-0000-4000-8000-000000000001",
      inputHash: "a".repeat(64),
      normalizedIntent: { kind: "unresolved", outcome: "blocked" },
      parserKind: "explicit",
      resolutionStatus: "blocked",
      riskClass: "read",
    })
    expect(JSON.stringify(body)).not.toContain("raw command")
    expect(body).not.toHaveProperty("clientSurface")
    expect(body).not.toHaveProperty("workflowRunId")
  })

  it("posts bounded phrases to the audited control parser route", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        outcome: {
          status: "blocked",
          reasonCode: "unsupported_command",
          reasons: ["The request is outside the supported command boundary."],
          confirmationRequired: false,
        },
        parserKind: "langchain",
        model: "openai/gpt-5.4-mini",
        durationMs: 12,
        trace: null,
        controlRequestId: "90000000-0000-4000-8000-000000000001",
      })
    )
    const client = new ApiClient(
      "http://127.0.0.1:3000",
      { getAccessToken: vi.fn().mockResolvedValue("access") },
      request
    )

    await client.parseControlIntent({
      companyId: "20000000-0000-4000-8000-000000000001",
      input: "What needs attention?",
    })

    expect(request.mock.calls[0]?.[0]).toBe(
      "http://127.0.0.1:3000/api/mandala/control/intents/parse"
    )
    expect(JSON.parse(String(request.mock.calls[0]?.[1]?.body))).toEqual({
      companyId: "20000000-0000-4000-8000-000000000001",
      input: "What needs attention?",
    })
  })

  it("posts selected-item questions to the read-only question route", async () => {
    const itemId = "40000000-0000-4000-8000-000000000001"
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        answer: "The quantity covers roughly 40 days of recent demand.",
        model: "openai/gpt-5.4-mini",
        durationMs: 25,
        trace: null,
      })
    )
    const client = new ApiClient(
      "http://127.0.0.1:3000",
      { getAccessToken: vi.fn().mockResolvedValue("access") },
      request
    )

    await client.askWorkItem(itemId, {
      companyId: "20000000-0000-4000-8000-000000000001",
      question: "Is 648 a good quantity?",
    })

    expect(request.mock.calls[0]?.[0]).toBe(
      `http://127.0.0.1:3000/api/mandala/workflows/items/${itemId}/questions`
    )
    expect(JSON.parse(String(request.mock.calls[0]?.[1]?.body))).toEqual({
      companyId: "20000000-0000-4000-8000-000000000001",
      question: "Is 648 a good quantity?",
    })
  })

  it("reads a coherent review version and posts a guarded decision", async () => {
    const companyId = "20000000-0000-4000-8000-000000000001"
    const itemId = "30000000-0000-4000-8000-000000000001"
    const draftId = "40000000-0000-4000-8000-000000000001"
    const version = "a".repeat(64)
    const idempotencyKey = "cli:00000000-0000-4000-8000-000000000001"
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(reviewResponse(itemId, draftId, version)))
      .mockResolvedValueOnce(
        Response.json({
          decision: {
            id: "50000000-0000-4000-8000-000000000001",
            decision: "approve",
          },
          draft: { id: draftId, status: "approved" },
          item: { id: itemId, status: "approved" },
          executionToken: null,
          duplicate: false,
          needsTokenReissue: false,
          priorState: {
            itemStatus: "active",
            draftStatus: "pending_review",
          },
          resultState: {
            itemStatus: "approved",
            draftStatus: "approved",
          },
          version: "b".repeat(64),
        })
      )
    const client = new ApiClient(
      "http://127.0.0.1:3000",
      { getAccessToken: vi.fn().mockResolvedValue("access") },
      request
    )

    const review = await client.getWorkItemReview(companyId, itemId)
    await client.recordDecision({
      companyId,
      workItemId: itemId,
      actionDraftId: draftId,
      decision: "approve",
      expectedVersion: review.version,
      idempotencyKey,
    })

    expect(request.mock.calls[0]?.[0]).toBe(
      `http://127.0.0.1:3000/api/mandala/workflows/items/${itemId}/review?companyId=${companyId}`
    )
    expect(JSON.parse(String(request.mock.calls[1]?.[1]?.body))).toEqual({
      companyId,
      workItemId: itemId,
      actionDraftId: draftId,
      decision: "approve",
      expectedVersion: version,
      idempotencyKey,
    })
  })

  it("posts terminal transitions for an existing control request", async () => {
    const controlRequestId = "90000000-0000-4000-8000-000000000001"
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ request: { id: controlRequestId } }))
    const client = new ApiClient(
      "http://127.0.0.1:3000",
      { getAccessToken: vi.fn().mockResolvedValue("access") },
      request
    )

    await client.transitionControlRequest({
      companyId: "20000000-0000-4000-8000-000000000001",
      controlRequestId,
      resolutionStatus: "blocked",
    })

    expect(request.mock.calls[0]?.[0]).toBe(
      "http://127.0.0.1:3000/api/mandala/control/requests/transition"
    )
    expect(JSON.parse(String(request.mock.calls[0]?.[1]?.body))).toEqual({
      companyId: "20000000-0000-4000-8000-000000000001",
      controlRequestId,
      resolutionStatus: "blocked",
    })
  })

  it("uses the bounded agent management routes and request contracts", async () => {
    const companyId = "20000000-0000-4000-8000-000000000001"
    const agentId = "a0000000-0000-4000-8000-000000000001"
    const agent = agentResponse(agentId, companyId)
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ agents: [agent] }))
      .mockResolvedValueOnce(Response.json({ agent, created: true }))
      .mockResolvedValueOnce(
        Response.json({ valid: false, diagnostics: [], preview: null })
      )
      .mockResolvedValueOnce(
        Response.json({
          agentId,
          workflowRunId: "30000000-0000-4000-8000-000000000001",
          status: "completed",
          itemId: null,
        })
      )
      .mockImplementation(async () =>
        Response.json({ agent, action: "lifecycle_changed" })
      )
    const client = new ApiClient(
      "http://127.0.0.1:3000",
      { getAccessToken: vi.fn().mockResolvedValue("access") },
      request
    )

    await client.listAgents(companyId)
    await client.installAgent({
      companyId,
      skillMarkdown: "# Inventory agent",
      activate: false,
    })
    await client.validateAgent({
      companyId,
      skillMarkdown: "# Inventory agent",
    })
    await client.testAgent(agentId, { companyId, seed: "coffee-shop" })
    await client.activateAgent(agentId, { companyId, reason: "Ready" })
    await client.deactivateAgent(agentId, { companyId, reason: "Pause" })
    await client.rollbackAgent(agentId, { companyId, version: "0.9.0" })

    expect(request.mock.calls.map(([url]) => url)).toEqual([
      `http://127.0.0.1:3000/api/mandala/agents?companyId=${companyId}`,
      "http://127.0.0.1:3000/api/mandala/agents",
      "http://127.0.0.1:3000/api/mandala/agents/validate",
      `http://127.0.0.1:3000/api/mandala/agents/${agentId}/test-runs`,
      `http://127.0.0.1:3000/api/mandala/agents/${agentId}/activate`,
      `http://127.0.0.1:3000/api/mandala/agents/${agentId}/deactivate`,
      `http://127.0.0.1:3000/api/mandala/agents/${agentId}/rollback`,
    ])
    expect(JSON.parse(String(request.mock.calls[6]?.[1]?.body))).toEqual({
      companyId,
      version: "0.9.0",
    })
  })
})

function agentResponse(agentId: string, companyId: string) {
  return {
    id: agentId,
    companyId,
    workflowKey: "inventory-replenishment",
    workflowType: "procurement_reorder_review",
    name: "Inventory replenishment",
    version: "1.0.0",
    status: "active",
    skillSchemaVersion: "1",
    compilerVersion: "1",
    skillDigest: "a".repeat(64),
    manifestDigest: "b".repeat(64),
    active: true,
    capabilities: [],
    diagnostics: [],
    createdAt: "2026-07-13T12:00:00.000Z",
    updatedAt: "2026-07-13T12:00:00.000Z",
  }
}

function reviewResponse(itemId: string, draftId: string, version: string) {
  return {
    item: {
      id: itemId,
      workflowRunId: "60000000-0000-4000-8000-000000000001",
      itemKey: "reorder:coffee-beans",
      itemType: "procurement_reorder_review",
      title: "Review coffee bean reorder",
      status: "active",
      priority: 50,
      sourceType: "inventory",
      ownerRole: "approver",
      assigneeId: null,
      dueAt: null,
      draft: {
        id: draftId,
        actionType: "mock_purchase_order",
        status: "pending_review",
        updatedAt: "2026-07-09T12:00:00.000Z",
      },
      nextActions: ["approve", "edit", "reject", "request_rework"],
      createdAt: "2026-07-09T12:00:00.000Z",
      updatedAt: "2026-07-09T12:00:00.000Z",
    },
    recordSnapshot: null,
    recommendation: null,
    evidence: null,
    draft: {
      id: draftId,
      actionType: "mock_purchase_order",
      status: "pending_review",
      payload: {},
      editPolicy: {},
      updatedAt: "2026-07-09T12:00:00.000Z",
    },
    policy: {
      minimumRole: "approver",
      requireHumanApproval: true,
      requireWarningAcknowledgement: false,
    },
    reviewState: "ready",
    version,
    availableActions: ["approve", "edit", "reject", "request_rework"],
    activity: { items: [], nextCursor: null },
  }
}
