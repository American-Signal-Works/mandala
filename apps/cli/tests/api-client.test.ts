import { describe, expect, it, vi } from "vitest"
import { ApiClient } from "../src/api-client.js"

describe("API client", () => {
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
})
