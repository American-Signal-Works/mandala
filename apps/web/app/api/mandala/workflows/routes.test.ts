import { beforeEach, describe, expect, it, vi } from "vitest"
import { authenticateRequest } from "@/lib/supabase/request"
import {
  WorkflowRpcError,
  executeMockWorkflowActionRpc,
  getCompanyMembership,
  persistFixtureRun,
  recordWorkflowDecisionRpc,
} from "@/lib/mandala/workflows"
import { POST as runFixture } from "./fixtures/route"
import { POST as recordDecision } from "./decisions/route"
import { POST as executeAction } from "./executions/route"

vi.mock("@/lib/supabase/request", () => ({ authenticateRequest: vi.fn() }))
vi.mock("@/lib/mandala/workflows", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/lib/mandala/workflows")>()
  return {
    ...original,
    getCompanyMembership: vi.fn(),
    persistFixtureRun: vi.fn(),
    recordWorkflowDecisionRpc: vi.fn(),
    executeMockWorkflowActionRpc: vi.fn(),
  }
})

const companyId = "20000000-0000-0000-0000-000000000001"
const draftId = "37000000-0000-0000-0000-000000000001"
const decisionId = "38000000-0000-0000-0000-000000000001"
const controlRequestId = "39000000-0000-4000-8000-000000000001"
const user = { id: "10000000-0000-0000-0000-000000000002" }

describe("Mandala workflow API routes", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateRequest).mockResolvedValue({
      authMode: "cookie",
      supabase: supabaseFor(user),
      user,
    } as never)
  })

  it("returns 401 for unauthenticated fixture requests", async () => {
    vi.mocked(authenticateRequest).mockResolvedValue(null)

    const response = await runFixture(
      jsonRequest("/fixtures", { companyId, scenarioId: "clean_reorder" })
    )

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: "unauthorized" })
  })

  it("returns structured 400 and 403 fixture responses", async () => {
    const invalid = await runFixture(
      jsonRequest("/fixtures", { companyId: "bad", scenarioId: "unknown" })
    )
    expect(invalid.status).toBe(400)
    expect(await invalid.json()).toMatchObject({ error: "invalid_request" })

    vi.mocked(getCompanyMembership).mockResolvedValue({ role: "viewer" })
    const forbidden = await runFixture(
      jsonRequest("/fixtures", { companyId, scenarioId: "clean_reorder" })
    )
    expect(forbidden.status).toBe(403)
    await expect(forbidden.json()).resolves.toEqual({ error: "forbidden" })
  })

  it("returns durable duplicate references without replaying an in-memory draft", async () => {
    vi.mocked(getCompanyMembership).mockResolvedValue({ role: "admin" })
    vi.mocked(persistFixtureRun).mockResolvedValue({
      duplicate: true,
      run: { id: "31000000-0000-0000-0000-000000000010", status: "suppressed" },
      eventId: "32000000-0000-0000-0000-000000000010",
      itemId: null,
    })

    const response = await runFixture(
      jsonRequest("/fixtures", {
        companyId,
        scenarioId: "clean_reorder",
        control: {
          inputHash: "f".repeat(64),
          controlRequestId,
        },
      })
    )

    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    expect(await response.json()).toEqual({
      duplicate: true,
      workflowRun: {
        id: "31000000-0000-0000-0000-000000000010",
        status: "suppressed",
      },
      eventId: "32000000-0000-0000-0000-000000000010",
      itemId: null,
    })
    expect(persistFixtureRun).toHaveBeenCalledWith(
      expect.objectContaining({
        clientSurface: "web",
        inputHash: "f".repeat(64),
        controlRequestId,
      })
    )
  })

  it("validates edit decisions before calling the database", async () => {
    const response = await recordDecision(
      jsonRequest("/decisions", {
        companyId,
        actionDraftId: draftId,
        decision: "edit",
      })
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: "invalid_request" })
    expect(recordWorkflowDecisionRpc).not.toHaveBeenCalled()
  })

  it("maps decision authorization errors without exposing database messages", async () => {
    vi.mocked(recordWorkflowDecisionRpc).mockRejectedValue(
      new WorkflowRpcError("forbidden", "42501")
    )

    const response = await recordDecision(
      jsonRequest("/decisions", {
        companyId,
        actionDraftId: draftId,
        decision: "approve",
      })
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: "forbidden" })
  })

  it("returns a successful atomic decision result", async () => {
    vi.mocked(recordWorkflowDecisionRpc).mockResolvedValue({
      decision: { id: decisionId, decision: "approve" },
      draft: { id: draftId, status: "approved" },
      item: { id: "33000000-0000-0000-0000-000000000001", status: "approved" },
      executionToken: {
        id: "39000000-0000-0000-0000-000000000001",
        rawToken: "a".repeat(64),
        expiresAt: "2026-07-09T12:15:00.000Z",
      },
    })

    const response = await recordDecision(
      jsonRequest("/decisions", {
        companyId,
        actionDraftId: draftId,
        decision: "approve",
        control: { inputHash: "b".repeat(64) },
      })
    )

    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    expect(await response.json()).toMatchObject({
      decision: { id: decisionId },
      executionToken: { rawToken: "a".repeat(64) },
    })
    expect(recordWorkflowDecisionRpc).toHaveBeenCalledWith(
      expect.objectContaining({
        clientSurface: "web",
        inputHash: "b".repeat(64),
      })
    )
  })

  it("returns 401 and structured 400 for invalid execution requests", async () => {
    vi.mocked(authenticateRequest).mockResolvedValueOnce(null)
    const unauthorized = await executeAction(
      jsonRequest("/executions", {
        companyId,
        actionDraftId: draftId,
        decisionId,
        rawToken: "a".repeat(64),
        idempotencyKey: "web:00000000-0000-4000-8000-000000000001",
        payload: {},
      })
    )
    expect(unauthorized.status).toBe(401)

    const invalid = await executeAction(
      jsonRequest("/executions", { companyId })
    )
    expect(invalid.status).toBe(400)
    expect(await invalid.json()).toMatchObject({ error: "invalid_request" })
  })

  it("maps execution conflicts and returns idempotent success responses", async () => {
    vi.mocked(executeMockWorkflowActionRpc).mockRejectedValueOnce(
      new WorkflowRpcError("token_consumed", "55000")
    )
    const conflict = await executeAction(validExecutionRequest())
    expect(conflict.status).toBe(409)
    await expect(conflict.json()).resolves.toEqual({ error: "token_consumed" })
    expect(executeMockWorkflowActionRpc).toHaveBeenCalledWith(
      expect.objectContaining({
        clientSurface: "web",
        inputHash: "c".repeat(64),
      })
    )

    vi.mocked(executeMockWorkflowActionRpc).mockResolvedValueOnce({
      attempt: {
        id: "3a000000-0000-0000-0000-000000000001",
        status: "succeeded",
      },
      draft: { id: draftId, status: "executed" },
      item: { id: "33000000-0000-0000-0000-000000000001", status: "executed" },
      duplicate: true,
    })
    const duplicate = await executeAction(validExecutionRequest())
    expect(duplicate.status).toBe(200)
    expect(duplicate.headers.get("cache-control")).toBe("private, no-store")
    expect(await duplicate.json()).toMatchObject({ duplicate: true })
  })
})

function supabaseFor(authenticatedUser: typeof user | null) {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: authenticatedUser } }),
    },
  }
}

function jsonRequest(path: string, body: unknown): Request {
  return new Request(`http://localhost/api/mandala/workflows${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

function validExecutionRequest(): Request {
  return jsonRequest("/executions", {
    companyId,
    actionDraftId: draftId,
    decisionId,
    rawToken: "a".repeat(64),
    idempotencyKey: "web:00000000-0000-4000-8000-000000000002",
    payload: { mode: "mock" },
    control: { inputHash: "c".repeat(64) },
  })
}
