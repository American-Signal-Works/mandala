import { beforeEach, describe, expect, it, vi } from "vitest"
import type { AgentSummary } from "@workspace/control-plane"
import { resolveCompanyCompilerCapabilities } from "@/lib/mandala/skills/capabilities"
import { refreshReadinessAndResumeAgent } from "@/lib/mandala/agents/resume"
import { compileAgentSkill } from "@/lib/mandala/skills/compiler"
import {
  activateAgentWorkflow,
  deactivateAgentWorkflow,
  installAgentWorkflowVersion,
  listAgentSummaries,
  rollbackAgentWorkflow,
  transitionAgentWorkflowLifecycle,
} from "@/lib/mandala/skills/lifecycle"
import { getCompanyMembership } from "@/lib/mandala/workflows"
import { authenticateRequest } from "@/lib/supabase/request"
import { POST as activateAgent } from "./[agentId]/activate/route"
import { POST as deactivateAgent } from "./[agentId]/deactivate/route"
import { POST as disableAgent } from "./[agentId]/disable/route"
import { POST as pauseAgent } from "./[agentId]/pause/route"
import { POST as resumeAgent } from "./[agentId]/resume/route"
import { POST as rollbackAgent } from "./[agentId]/rollback/route"
import { GET as listAgents, POST as installAgent } from "./route"
import { POST as validateAgent } from "./validate/route"

vi.mock("@/lib/supabase/request", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase/request")>()),
  authenticateRequest: vi.fn(),
}))
vi.mock("@/lib/mandala/workflows", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/lib/mandala/workflows")>()
  return { ...original, getCompanyMembership: vi.fn() }
})
vi.mock("@/lib/mandala/skills/capabilities", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/lib/mandala/skills/capabilities")>()
  return { ...original, resolveCompanyCompilerCapabilities: vi.fn() }
})
vi.mock("@/lib/mandala/skills/compiler", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/lib/mandala/skills/compiler")>()
  return { ...original, compileAgentSkill: vi.fn() }
})
vi.mock("@/lib/mandala/skills/lifecycle", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/lib/mandala/skills/lifecycle")>()
  return {
    ...original,
    activateAgentWorkflow: vi.fn(),
    deactivateAgentWorkflow: vi.fn(),
    installAgentWorkflowVersion: vi.fn(),
    listAgentSummaries: vi.fn(),
    rollbackAgentWorkflow: vi.fn(),
    transitionAgentWorkflowLifecycle: vi.fn(),
  }
})
vi.mock("@/lib/mandala/agents/resume", () => ({
  refreshReadinessAndResumeAgent: vi.fn(),
}))

const companyId = "20000000-0000-4000-8000-000000000001"
const agentId = "a0000000-0000-4000-8000-000000000001"
const userId = "10000000-0000-4000-8000-000000000001"
const auth = { authMode: "bearer", supabase: {}, user: { id: userId } }

describe("Mandala agent lifecycle routes", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateRequest).mockResolvedValue(auth as never)
    vi.mocked(getCompanyMembership).mockResolvedValue({ role: "admin" })
    vi.mocked(resolveCompanyCompilerCapabilities).mockResolvedValue([])
    vi.mocked(compileAgentSkill).mockReturnValue(compiledSkill() as never)
    vi.mocked(listAgentSummaries).mockResolvedValue([agentSummary()])
    vi.mocked(installAgentWorkflowVersion).mockResolvedValue(agentSummary())
    vi.mocked(activateAgentWorkflow).mockResolvedValue(
      agentSummary({ active: true, status: "active" })
    )
    vi.mocked(deactivateAgentWorkflow).mockResolvedValue(agentSummary())
    vi.mocked(rollbackAgentWorkflow).mockResolvedValue(
      agentSummary({ version: "0.9.0" })
    )
    vi.mocked(transitionAgentWorkflowLifecycle).mockImplementation(
      async ({ transition }) =>
        agentSummary({
          active: transition === "activate" || transition === "resume",
          status:
            transition === "activate" || transition === "resume"
              ? "active"
              : transition === "pause"
                ? "paused"
                : "disabled",
        })
    )
    vi.mocked(refreshReadinessAndResumeAgent).mockResolvedValue(
      agentSummary({ active: true, status: "active", stateVersion: 2 })
    )
  })

  it("authenticates agent reads and returns private no-store data", async () => {
    const response = await listAgents(
      new Request(`http://localhost/api/mandala/agents?companyId=${companyId}`)
    )
    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    await expect(response.json()).resolves.toEqual({ agents: [agentSummary()] })
    expect(listAgentSummaries).toHaveBeenCalledWith({
      supabase: auth.supabase,
      companyId,
    })

    vi.mocked(authenticateRequest).mockResolvedValueOnce(null)
    const unauthorized = await listAgents(
      new Request(`http://localhost/api/mandala/agents?companyId=${companyId}`)
    )
    expect(unauthorized.status).toBe(401)
    expect(unauthorized.headers.get("cache-control")).toBe("private, no-store")
  })

  it("requires owner or admin before installing an agent", async () => {
    vi.mocked(getCompanyMembership).mockResolvedValue({ role: "member" })
    const response = await installAgent(
      jsonRequest("/agents", {
        companyId,
        skillMarkdown: "# Agent skill",
        activate: false,
      })
    )
    expect(response.status).toBe(403)
    expect(resolveCompanyCompilerCapabilities).not.toHaveBeenCalled()
    expect(installAgentWorkflowVersion).not.toHaveBeenCalled()
  })

  it("compiles installation against current database capabilities", async () => {
    const capabilities = [
      {
        id: "commerce.inventory.read",
        version: "1.0.0",
        access: "read" as const,
        connectorId: "b0000000-0000-4000-8000-000000000001",
        installationId: "b0000000-0000-4000-8000-000000000001",
        capabilityVersionId: "c0000000-0000-4000-8000-000000000001",
        grantId: "d0000000-0000-4000-8000-000000000001",
        schemaDigest: "a".repeat(64),
        schemaCompatible: true,
        toolName: "read_inventory",
        healthy: true,
        granted: true,
        modelAllowedPaths: ["sku"],
      },
    ]
    vi.mocked(resolveCompanyCompilerCapabilities).mockResolvedValue(
      capabilities
    )
    const response = await installAgent(
      jsonRequest("/agents", {
        companyId,
        skillMarkdown: "# Agent skill",
        activate: false,
      })
    )
    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    expect(compileAgentSkill).toHaveBeenCalledWith({
      source: "# Agent skill",
      capabilities,
    })
    expect(installAgentWorkflowVersion).toHaveBeenCalled()
    expect(activateAgentWorkflow).not.toHaveBeenCalled()
    await expect(response.json()).resolves.toMatchObject({
      created: true,
      agent: { id: agentId, active: false },
    })
  })

  it("returns compiler diagnostics without installing an invalid skill", async () => {
    vi.mocked(compileAgentSkill).mockReturnValue({
      ok: false,
      diagnostics: [
        {
          severity: "error",
          code: "capability.missing",
          path: "capabilities.inventory",
          message: "Inventory is not connected.",
          resolution: "Connect inventory and try again.",
        },
      ],
    })
    const response = await installAgent(
      jsonRequest("/agents", {
        companyId,
        skillMarkdown: "# Agent skill",
        activate: false,
      })
    )
    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({
      error: "agent_validation_failed",
    })
    expect(installAgentWorkflowVersion).not.toHaveBeenCalled()
  })

  it("uses the same database capability projection for validation", async () => {
    const response = await validateAgent(
      jsonRequest("/agents/validate", {
        companyId,
        skillMarkdown: "# Agent skill",
      })
    )
    expect(response.status).toBe(200)
    expect(resolveCompanyCompilerCapabilities).toHaveBeenCalledWith({
      supabase: auth.supabase,
      companyId,
    })
    expect(await response.json()).toMatchObject({
      valid: true,
      preview: { workflowKey: "inventory-agent" },
    })
  })

  it("checks admin membership for activate, deactivate, and rollback", async () => {
    const context = { params: Promise.resolve({ agentId }) }
    const activated = await activateAgent(
      jsonRequest(`/agents/${agentId}/activate`, {
        companyId,
        expectedVersion: 1,
        reason: "Activate after Sandbox review",
      }),
      context
    )
    const deactivated = await deactivateAgent(
      jsonRequest(`/agents/${agentId}/deactivate`, {
        companyId,
        expectedVersion: 1,
        reason: "Pause for operations review",
      }),
      context
    )
    const rolledBack = await rollbackAgent(
      jsonRequest(`/agents/${agentId}/rollback`, {
        companyId,
        expectedVersion: 1,
        reason: "Rollback after regression review",
        version: "0.9.0",
      }),
      context
    )
    expect([activated.status, deactivated.status, rolledBack.status]).toEqual([
      200, 200, 200,
    ])
    expect(transitionAgentWorkflowLifecycle).toHaveBeenCalledWith({
      supabase: auth.supabase,
      companyId,
      agentId,
      transition: "activate",
      expectedVersion: 1,
      reason: "Activate after Sandbox review",
    })
    expect(rollbackAgentWorkflow).toHaveBeenCalledWith({
      supabase: auth.supabase,
      companyId,
      agentId,
      version: "0.9.0",
      expectedVersion: 1,
      reason: "Rollback after regression review",
    })

    vi.mocked(getCompanyMembership).mockResolvedValue({ role: "viewer" })
    const forbidden = await activateAgent(
      jsonRequest(`/agents/${agentId}/activate`, {
        companyId,
        expectedVersion: 1,
        reason: "Activate after Sandbox review",
      }),
      context
    )
    expect(forbidden.status).toBe(403)
  })

  it("routes pause and disable through the version-checked lifecycle", async () => {
    const context = { params: Promise.resolve({ agentId }) }
    for (const [action, handler] of [
      ["pause", pauseAgent],
      ["disable", disableAgent],
    ] as const) {
      const response = await handler(
        jsonRequest(`/agents/${agentId}/${action}`, {
          companyId,
          expectedVersion: 1,
          reason: `${action} for operations review`,
        }),
        context
      )
      expect(response.status).toBe(200)
      expect(transitionAgentWorkflowLifecycle).toHaveBeenCalledWith({
        supabase: auth.supabase,
        companyId,
        agentId,
        transition: action,
        expectedVersion: 1,
        reason: `${action} for operations review`,
      })
    }
  })

  it("refreshes Sandbox readiness before resuming", async () => {
    const response = await resumeAgent(
      jsonRequest(`/agents/${agentId}/resume`, {
        companyId,
        expectedVersion: 4,
        reason: "Resume after current Sandbox review",
      }),
      { params: Promise.resolve({ agentId }) }
    )

    expect(response.status).toBe(200)
    expect(refreshReadinessAndResumeAgent).toHaveBeenCalledWith({
      supabase: auth.supabase,
      companyId,
      agentId,
      expectedVersion: 4,
      reason: "Resume after current Sandbox review",
      actorUserId: userId,
      clientSurface: "cli",
    })
    expect(transitionAgentWorkflowLifecycle).not.toHaveBeenCalledWith(
      expect.objectContaining({ transition: "resume" })
    )
  })

  it("returns a stable conflict when lifecycle readiness is stale", async () => {
    vi.mocked(refreshReadinessAndResumeAgent).mockRejectedValueOnce(
      new Error("agent_readiness_stale")
    )
    const response = await resumeAgent(
      jsonRequest(`/agents/${agentId}/resume`, {
        companyId,
        expectedVersion: 9,
        reason: "Resume after review",
      }),
      { params: Promise.resolve({ agentId }) }
    )

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: "agent_state_conflict",
    })
  })

  it("returns a stable conflict when real-data mappings are not activation-ready", async () => {
    vi.mocked(transitionAgentWorkflowLifecycle).mockRejectedValueOnce(
      new Error("workspace_mapping_snapshot_not_ready")
    )
    const response = await activateAgent(
      jsonRequest(`/agents/${agentId}/activate`, {
        companyId,
        expectedVersion: 2,
        reason: "Activate after real-data Sandbox review",
      }),
      { params: Promise.resolve({ agentId }) }
    )

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: "agent_state_conflict",
    })
  })

  it("requires an explicit rollback version", async () => {
    const response = await rollbackAgent(
      jsonRequest(`/agents/${agentId}/rollback`, {
        companyId,
        expectedVersion: 1,
        reason: "Rollback after regression review",
      }),
      { params: Promise.resolve({ agentId }) }
    )
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: "rollback_version_required",
    })
    expect(rollbackAgentWorkflow).not.toHaveBeenCalled()
  })
})

function jsonRequest(path: string, body: unknown): Request {
  return new Request(`http://localhost/api/mandala${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

function agentSummary(overrides: Partial<AgentSummary> = {}): AgentSummary {
  return {
    id: agentId,
    companyId,
    workflowKey: "inventory-agent",
    workflowType: "procurement_reorder_review",
    name: "Inventory Agent",
    version: "1.0.0",
    status: "draft",
    skillSchemaVersion: "mandala.ai/v1",
    compilerVersion: "1.0.0",
    skillDigest: "a".repeat(64),
    manifestDigest: "b".repeat(64),
    stateVersion: 1,
    active: false,
    capabilities: [],
    diagnostics: [],
    createdAt: "2026-07-13T12:00:00.000Z",
    updatedAt: "2026-07-13T12:00:00.000Z",
    ...overrides,
  }
}

function compiledSkill() {
  return {
    ok: true as const,
    diagnostics: [],
    manifest: {
      schemaVersion: "mandala.ai/v1",
      compilerVersion: "1.0.0",
      sourceDigest: "a".repeat(64),
      manifestDigest: "b".repeat(64),
      identity: {
        id: "inventory-agent",
        name: "Inventory Agent",
        version: "1.0.0",
        description: "Test agent",
      },
      workflow: {
        type: "procurement_reorder_review",
        status: "draft",
        default_mode: "mock",
        triggers: [],
      },
      capabilityBindings: [],
      graph: [],
      rules: [],
      records: [],
      evidence: [],
      approvals: [],
      actions: [],
      tests: [],
      guidance: {
        purpose: "Purpose",
        investigation: "Investigate",
        decision: "Decide",
        exceptions: "Exceptions",
        outputQuality: "Quality",
      },
    },
  }
}
