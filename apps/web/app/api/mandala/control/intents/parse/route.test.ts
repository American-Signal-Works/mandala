import { createHash } from "node:crypto"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import { authorizeCompanyPermission } from "@/lib/mandala/authorization"
import { parseConversationalControlInput } from "@/lib/mandala/control-plane/conversational-parser"
import {
  acquireWorkflowControlParserLeaseRpc,
  classifyWorkflowRpcError,
  recordWorkflowControlRequestRpc,
  recordWorkflowControlRequestWithBindingRpc,
  releaseWorkflowControlParserLeaseRpc,
  WorkflowRpcError,
} from "@/lib/mandala/workflows"
import { authenticateRequest } from "@/lib/supabase/request"
import { POST } from "./route"

vi.mock("@/lib/supabase/request", () => ({ authenticateRequest: vi.fn() }))
vi.mock("@/actions/admin/provider-usage", () => ({
  createServerModelUsageRecorder: vi.fn(() => vi.fn()),
}))
vi.mock("@/lib/mandala/authorization", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/lib/mandala/authorization")>()
  return { ...original, authorizeCompanyPermission: vi.fn() }
})
vi.mock("@/lib/mandala/workflows", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/lib/mandala/workflows")>()
  return {
    ...original,
    acquireWorkflowControlParserLeaseRpc: vi.fn(),
    classifyWorkflowRpcError: vi.fn(),
    recordWorkflowControlRequestRpc: vi.fn(),
    recordWorkflowControlRequestWithBindingRpc: vi.fn(),
    releaseWorkflowControlParserLeaseRpc: vi.fn(),
  }
})
vi.mock("@/lib/mandala/control-plane/conversational-parser", async () => {
  const original = await vi.importActual<
    typeof import("@/lib/mandala/control-plane/conversational-parser")
  >("@/lib/mandala/control-plane/conversational-parser")
  return { ...original, parseConversationalControlInput: vi.fn() }
})

const companyId = "20000000-0000-4000-8000-000000000001"
const itemId = "30000000-0000-4000-8000-000000000001"
const traceId = "40000000-0000-4000-8000-000000000001"
const controlRequestId = "50000000-0000-4000-8000-000000000001"
const leaseId = "60000000-0000-4000-8000-000000000001"
const bindingSecret = "binding-secret-".padEnd(40, "x")
const originalBindingSecret = process.env.MANDALA_CONTROL_BINDING_SECRET
const auth = {
  authMode: "bearer",
  supabase: {},
  user: { id: "10000000-0000-4000-8000-000000000001" },
}

describe("conversational control parse route", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.MANDALA_CONTROL_BINDING_SECRET = bindingSecret
    vi.mocked(authenticateRequest).mockResolvedValue(auth as never)
    vi.mocked(authorizeCompanyPermission).mockResolvedValue({
      effect: "allow",
      reason: "role_permission_granted",
      role: "owner",
      permission: "workflow.read",
    })
    vi.mocked(recordWorkflowControlRequestRpc).mockResolvedValue({
      id: controlRequestId,
    } as never)
    vi.mocked(recordWorkflowControlRequestWithBindingRpc).mockResolvedValue({
      id: controlRequestId,
    } as never)
    vi.mocked(acquireWorkflowControlParserLeaseRpc).mockResolvedValue({
      leaseId,
      expiresAt: "2026-07-09T22:00:15.000Z",
    })
    vi.mocked(releaseWorkflowControlParserLeaseRpc).mockResolvedValue(undefined)
  })

  it("authorizes workflow reads, records a normalized trace link, and omits raw input", async () => {
    const phrase = `Please approve ${itemId}`
    vi.mocked(parseConversationalControlInput).mockResolvedValue({
      parserKind: "langchain",
      model: "openai/gpt-5.4-mini",
      durationMs: 25,
      trace: { traceId, runId: traceId },
      outcome: {
        status: "resolved",
        intent: {
          kind: "record_decision",
          companyId,
          itemId,
          decision: "approve",
          warningsAcknowledged: false,
          risk: "state_change",
        },
        confirmationRequired: true,
      },
    })

    const response = await POST(request({ companyId, input: phrase }))

    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    const body = await response.json()
    expect(body).toMatchObject({
      parserKind: "langchain",
      controlRequestId,
      trace: { traceId, runId: traceId },
      outcome: { status: "resolved" },
    })
    expect(authorizeCompanyPermission).toHaveBeenCalledWith({
      supabase: auth.supabase,
      companyId,
      userId: auth.user.id,
      permission: "workflow.read",
    })
    expect(recordWorkflowControlRequestWithBindingRpc).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId,
        parserKind: "langchain",
        resolutionStatus: "resolved",
        riskClass: "state_change",
        workflowItemId: itemId,
        langsmithTraceId: traceId,
        langsmithRunId: traceId,
        normalizedIntent: {
          kind: "record_decision",
          companyId,
          itemId,
          decision: "approve",
          patchPointers: [],
          patchCount: 0,
          warningsAcknowledged: false,
          risk: "state_change",
        },
        inputHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        bindingIntent: {
          kind: "record_decision",
          companyId,
          itemId,
          decision: "approve",
          patches: [],
          warningsAcknowledged: false,
        },
        serverToken: createHash("sha256").update(bindingSecret).digest("hex"),
      })
    )
    expect(
      JSON.stringify(
        vi.mocked(recordWorkflowControlRequestWithBindingRpc).mock.calls
      )
    ).not.toContain(phrase)
    const recordedInputHash = vi.mocked(
      recordWorkflowControlRequestWithBindingRpc
    ).mock.calls[0]?.[0].inputHash
    expect(recordedInputHash).not.toBe(
      createHash("sha256").update(phrase).digest("hex")
    )
    expect(releaseWorkflowControlParserLeaseRpc).toHaveBeenCalledWith({
      supabase: auth.supabase,
      companyId,
      leaseId,
    })
  })

  it("rejects denied workflow reads before invoking the parser", async () => {
    vi.mocked(authorizeCompanyPermission).mockResolvedValue({
      effect: "deny",
      reason: "forbidden",
      permission: "workflow.read",
    })

    const response = await POST(
      request({ companyId, input: "What needs attention?" })
    )

    expect(response.status).toBe(403)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    await expect(response.json()).resolves.toEqual({ error: "forbidden" })
    expect(parseConversationalControlInput).not.toHaveBeenCalled()
    expect(recordWorkflowControlRequestRpc).not.toHaveBeenCalled()
    expect(recordWorkflowControlRequestWithBindingRpc).not.toHaveBeenCalled()
    expect(acquireWorkflowControlParserLeaseRpc).not.toHaveBeenCalled()
  })

  it("returns a private server error when membership lookup fails", async () => {
    vi.mocked(authorizeCompanyPermission).mockResolvedValue({
      effect: "deny",
      reason: "membership_lookup_failed",
      permission: "workflow.read",
    })

    const response = await POST(
      request({ companyId, input: "What needs attention?" })
    )

    expect(response.status).toBe(500)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    await expect(response.json()).resolves.toEqual({
      error: "membership_lookup_failed",
    })
    expect(parseConversationalControlInput).not.toHaveBeenCalled()
    expect(recordWorkflowControlRequestRpc).not.toHaveBeenCalled()
    expect(recordWorkflowControlRequestWithBindingRpc).not.toHaveBeenCalled()
    expect(acquireWorkflowControlParserLeaseRpc).not.toHaveBeenCalled()
  })

  it("requires authentication", async () => {
    vi.mocked(authenticateRequest).mockResolvedValue(null)

    const response = await POST(
      request({ companyId, input: "What needs attention?" })
    )

    expect(response.status).toBe(401)
    expect(authorizeCompanyPermission).not.toHaveBeenCalled()
    expect(parseConversationalControlInput).not.toHaveBeenCalled()
  })

  it("records a redacted failed outcome and returns parser_unavailable", async () => {
    const parserModule =
      await import("@/lib/mandala/control-plane/conversational-parser")
    vi.mocked(parseConversationalControlInput).mockRejectedValue(
      new parserModule.ConversationalParserUnavailableError(
        "provider_error",
        "openai/gpt-5.4-mini",
        { traceId, runId: traceId }
      )
    )

    const response = await POST(
      request({ companyId, input: "What needs attention?" })
    )

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({
      error: "parser_unavailable",
    })
    expect(recordWorkflowControlRequestRpc).toHaveBeenCalledWith(
      expect.objectContaining({
        normalizedIntent: { kind: "unresolved", outcome: "failed" },
        parserKind: "langchain",
        resolutionStatus: "failed",
        langsmithTraceId: traceId,
        langsmithRunId: traceId,
      })
    )
    expect(releaseWorkflowControlParserLeaseRpc).toHaveBeenCalledWith({
      supabase: auth.supabase,
      companyId,
      leaseId,
    })
  })

  it("returns 429 before invoking the model when parser quota is exhausted", async () => {
    vi.mocked(acquireWorkflowControlParserLeaseRpc).mockRejectedValue(
      new Error("parser_rate_limit_exceeded")
    )
    vi.mocked(classifyWorkflowRpcError).mockReturnValue({
      code: "parser_rate_limit_exceeded",
      status: 429,
    })

    const response = await POST(
      request({ companyId, input: "What needs attention?" })
    )

    expect(response.status).toBe(429)
    await expect(response.json()).resolves.toEqual({
      error: "parser_rate_limit_exceeded",
    })
    expect(parseConversationalControlInput).not.toHaveBeenCalled()
    expect(recordWorkflowControlRequestRpc).not.toHaveBeenCalled()
    expect(recordWorkflowControlRequestWithBindingRpc).not.toHaveBeenCalled()
    expect(releaseWorkflowControlParserLeaseRpc).not.toHaveBeenCalled()
  })

  it("fails before model invocation when server binding trust is not configured", async () => {
    delete process.env.MANDALA_CONTROL_BINDING_SECRET

    const response = await POST(
      request({ companyId, input: "What needs attention?" })
    )

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({
      error: "parser_unavailable",
    })
    expect(parseConversationalControlInput).not.toHaveBeenCalled()
    expect(acquireWorkflowControlParserLeaseRpc).not.toHaveBeenCalled()
    expect(recordWorkflowControlRequestRpc).toHaveBeenCalledWith(
      expect.objectContaining({ resolutionStatus: "failed" })
    )
  })

  it("fails closed when database binding trust rejects the server token", async () => {
    vi.mocked(parseConversationalControlInput).mockResolvedValue({
      parserKind: "langchain",
      model: "openai/gpt-5.4-mini",
      durationMs: 25,
      trace: { traceId, runId: traceId },
      outcome: {
        status: "resolved",
        intent: {
          kind: "record_decision",
          companyId,
          itemId,
          decision: "approve",
          warningsAcknowledged: false,
          risk: "state_change",
        },
        confirmationRequired: true,
      },
    })
    vi.mocked(recordWorkflowControlRequestWithBindingRpc).mockRejectedValue(
      new WorkflowRpcError("parser_binding_forbidden", "42501")
    )

    const response = await POST(
      request({ companyId, input: `Approve ${itemId}` })
    )

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({
      error: "parser_unavailable",
    })
    expect(recordWorkflowControlRequestRpc).toHaveBeenCalledWith(
      expect.objectContaining({ resolutionStatus: "failed" })
    )
    expect(releaseWorkflowControlParserLeaseRpc).toHaveBeenCalled()
  })
})

afterAll(() => {
  if (originalBindingSecret === undefined) {
    delete process.env.MANDALA_CONTROL_BINDING_SECRET
  } else {
    process.env.MANDALA_CONTROL_BINDING_SECRET = originalBindingSecret
  }
})

function request(body: unknown): Request {
  return new Request("http://localhost/api/mandala/control/intents/parse", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost",
      authorization: "Bearer token",
    },
    body: JSON.stringify(body),
  })
}
