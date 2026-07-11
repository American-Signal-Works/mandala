import { beforeEach, describe, expect, it, vi } from "vitest"
import { authenticateRequest } from "@/lib/supabase/request"
import { authorizeCompanyPermission } from "@/lib/mandala/authorization"
import {
  WorkflowRpcError,
  recordWorkflowControlRequestRpc,
  reissueWorkflowExecutionTokenRpc,
} from "@/lib/mandala/workflows"
import { POST as recordControlRequest } from "./control/requests/route"
import { POST as reissueExecutionToken } from "./workflows/execution-tokens/route"

vi.mock("@/lib/supabase/request", () => ({ authenticateRequest: vi.fn() }))
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
    recordWorkflowControlRequestRpc: vi.fn(),
    reissueWorkflowExecutionTokenRpc: vi.fn(),
  }
})

const companyId = "20000000-0000-0000-0000-000000000001"
const runId = "31000000-0000-0000-0000-000000000001"
const itemId = "33000000-0000-0000-0000-000000000001"
const draftId = "37000000-0000-0000-0000-000000000001"
const decisionId = "38000000-0000-0000-0000-000000000001"
const tokenId = "39000000-0000-0000-0000-000000000001"
const auth = {
  authMode: "bearer",
  supabase: {},
  user: { id: "10000000-0000-0000-0000-000000000001" },
}

describe("Mandala control-plane mutation support routes", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateRequest).mockResolvedValue(auth as never)
    vi.mocked(authorizeCompanyPermission).mockResolvedValue({
      effect: "allow",
      reason: "role_permission_granted",
      role: "owner",
      permission: "workflow.read",
    })
  })

  it("derives CLI attribution from bearer auth and records no raw input", async () => {
    const stored = {
      id: "3b000000-0000-0000-0000-000000000001",
      company_id: companyId,
      actor_id: auth.user.id,
      client_surface: "cli" as const,
      input_hash: "a".repeat(64),
      normalized_intent: {
        kind: "inspect_work_item",
        companyId,
        itemId,
        risk: "read",
      },
      parser_kind: "explicit" as const,
      resolution_status: "executed" as const,
      risk_class: "read" as const,
      workflow_run_id: runId,
      workflow_item_id: itemId,
      langsmith_trace_id: null,
      langsmith_run_id: null,
      created_at: "2026-07-09T12:00:00Z",
      updated_at: "2026-07-09T12:00:00Z",
    }
    vi.mocked(recordWorkflowControlRequestRpc).mockResolvedValue(stored)

    const response = await recordControlRequest(
      jsonRequest("/control/requests", {
        companyId,
        inputHash: "a".repeat(64),
        normalizedIntent: {
          kind: "inspect_work_item",
          companyId,
          itemId,
          risk: "read",
        },
        parserKind: "explicit",
        resolutionStatus: "executed",
        riskClass: "read",
        workflowRunId: runId,
        workflowItemId: itemId,
      })
    )

    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    await expect(response.json()).resolves.toEqual({ request: stored })
    expect(recordWorkflowControlRequestRpc).toHaveBeenCalledWith({
      supabase: auth.supabase,
      companyId,
      clientSurface: "cli",
      inputHash: "a".repeat(64),
      normalizedIntent: {
        kind: "inspect_work_item",
        companyId,
        itemId,
        risk: "read",
      },
      parserKind: "explicit",
      resolutionStatus: "executed",
      riskClass: "read",
      workflowRunId: runId,
      workflowItemId: itemId,
    })
  })

  it("rejects raw-command fields and invalid hashes before the audit RPC", async () => {
    const response = await recordControlRequest(
      jsonRequest("/control/requests", {
        companyId,
        inputHash: "b".repeat(64),
        rawCommand: "approve everything",
        normalizedIntent: {
          kind: "record_decision",
          companyId,
          itemId,
          decision: "approve",
          warningsAcknowledged: false,
          risk: "state_change",
        },
        parserKind: "explicit",
        resolutionStatus: "executed",
        riskClass: "state_change",
      })
    )

    expect(response.status).toBe(400)
    expect(recordWorkflowControlRequestRpc).not.toHaveBeenCalled()
  })

  it("requires successful state changes to use the atomic mutation RPC", async () => {
    const response = await recordControlRequest(
      jsonRequest("/control/requests", {
        companyId,
        inputHash: "b".repeat(64),
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
        parserKind: "explicit",
        resolutionStatus: "executed",
        riskClass: "state_change",
      })
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: "controlled_mutation_required",
    })
    expect(recordWorkflowControlRequestRpc).not.toHaveBeenCalled()
  })

  it("returns a fresh one-time execution capability without caching it", async () => {
    vi.mocked(authorizeCompanyPermission).mockResolvedValue({
      effect: "allow",
      reason: "role_permission_granted",
      role: "approver",
      permission: "workflow.execution_token.issue",
    })
    vi.mocked(reissueWorkflowExecutionTokenRpc).mockResolvedValue({
      decisionId,
      executionToken: {
        id: tokenId,
        rawToken: "f".repeat(64),
        expiresAt: "2026-07-09T12:15:00Z",
      },
    })

    const response = await reissueExecutionToken(
      jsonRequest("/workflows/execution-tokens", {
        companyId,
        actionDraftId: draftId,
      })
    )

    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    await expect(response.json()).resolves.toMatchObject({
      decisionId,
      executionToken: { id: tokenId },
    })
  })

  it("maps attempted-action conflicts and requires authentication", async () => {
    vi.mocked(authorizeCompanyPermission).mockResolvedValue({
      effect: "allow",
      reason: "role_permission_granted",
      role: "approver",
      permission: "workflow.execution_token.issue",
    })
    vi.mocked(reissueWorkflowExecutionTokenRpc).mockRejectedValue(
      new WorkflowRpcError("action_already_attempted", "55000")
    )
    const conflict = await reissueExecutionToken(
      jsonRequest("/workflows/execution-tokens", {
        companyId,
        actionDraftId: draftId,
      })
    )
    expect(conflict.status).toBe(409)
    await expect(conflict.json()).resolves.toEqual({
      error: "action_already_attempted",
    })

    vi.mocked(authenticateRequest).mockResolvedValue(null)
    const unauthorized = await recordControlRequest(
      jsonRequest("/control/requests", {})
    )
    expect(unauthorized.status).toBe(401)
  })

  it("maps named permission denials before calling support RPCs", async () => {
    vi.mocked(authorizeCompanyPermission).mockResolvedValue({
      effect: "deny",
      reason: "forbidden",
      permission: "workflow.read",
    })

    const forbidden = await recordControlRequest(
      jsonRequest("/control/requests", {
        companyId,
        inputHash: "a".repeat(64),
        normalizedIntent: {
          kind: "inspect_work_item",
          companyId,
          itemId,
          risk: "read",
        },
        parserKind: "explicit",
        resolutionStatus: "executed",
        riskClass: "read",
      })
    )

    expect(forbidden.status).toBe(403)
    await expect(forbidden.json()).resolves.toEqual({ error: "forbidden" })
    expect(recordWorkflowControlRequestRpc).not.toHaveBeenCalled()

    vi.mocked(authorizeCompanyPermission).mockResolvedValue({
      effect: "deny",
      reason: "membership_lookup_failed",
      permission: "workflow.execution_token.issue",
    })
    const failed = await reissueExecutionToken(
      jsonRequest("/workflows/execution-tokens", {
        companyId,
        actionDraftId: draftId,
      })
    )
    expect(failed.status).toBe(500)
    await expect(failed.json()).resolves.toEqual({
      error: "membership_lookup_failed",
    })
    expect(reissueWorkflowExecutionTokenRpc).not.toHaveBeenCalled()
  })
})

function jsonRequest(path: string, body: unknown): Request {
  return new Request(`http://localhost/api/mandala${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}
