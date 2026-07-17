import { beforeEach, describe, expect, it, vi } from "vitest"
import { createPersistenceVerificationAdminClient } from "@/actions/admin/persistence-verification"
import { getCompanyMembership } from "@/lib/mandala/workflows"
import { runWorkspaceSandboxGoldenPath } from "@/lib/mandala/workspace-data/sandbox-runner"
import { WorkspaceSetupError } from "@/lib/mandala/workspace-data/setup"
import { authenticateRequest } from "@/lib/supabase/request"
import { POST } from "./route"

vi.mock("@/lib/supabase/request", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase/request")>()),
  authenticateRequest: vi.fn(),
}))
vi.mock("@/lib/mandala/workflows", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/mandala/workflows")>()),
  getCompanyMembership: vi.fn(),
}))
vi.mock("@/lib/mandala/workspace-data/sandbox-runner", () => ({
  runWorkspaceSandboxGoldenPath: vi.fn(),
}))
vi.mock("@/actions/admin/persistence-verification", () => ({
  createPersistenceVerificationAdminClient: vi.fn(),
}))

const companyId = "a2000000-0000-4000-8000-000000000001"
const userId = "a1000000-0000-4000-8000-000000000001"
const auth = {
  authMode: "bearer",
  cliSession: {
    managed: true,
    sessionId: "a3000000-0000-4000-8000-000000000001",
    selectedCompanyId: companyId,
    scopes: ["workspace:control"],
  },
  supabase: {},
  user: { id: userId },
}

describe("workspace Sandbox golden-path route", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateRequest).mockResolvedValue(auth as never)
    vi.mocked(createPersistenceVerificationAdminClient).mockReturnValue(
      {} as never
    )
    vi.mocked(getCompanyMembership).mockResolvedValue({ role: "admin" })
    vi.mocked(runWorkspaceSandboxGoldenPath).mockResolvedValue(
      response() as never
    )
  })

  it("runs only for the CLI-selected workspace and returns no-store proof", async () => {
    const request = jsonRequest({
      companyId,
      skillMarkdown: "---\nvalid: true\n---\n# Skill",
      confirmMappings: true,
    })
    const result = await POST(request)
    expect(result.status).toBe(200)
    expect(result.headers.get("cache-control")).toBe("private, no-store")
    expect(runWorkspaceSandboxGoldenPath).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId,
        actorUserId: userId,
        confirmMappings: true,
      })
    )
    expect(await result.json()).toMatchObject({
      mode: "sandbox",
      proof: {
        unchanged: true,
        persistenceWrites: 0,
        externalWriteAttempts: 0,
      },
    })
  })

  it("fails closed for workspace mismatch, insufficient role, and missing confirmation", async () => {
    vi.mocked(authenticateRequest).mockResolvedValueOnce({
      ...auth,
      cliSession: {
        ...auth.cliSession,
        selectedCompanyId: "a2000000-0000-4000-8000-000000000099",
      },
    } as never)
    expect((await POST(jsonRequest(validBody()))).status).toBe(403)

    vi.mocked(getCompanyMembership).mockResolvedValueOnce({ role: "viewer" })
    expect((await POST(jsonRequest(validBody()))).status).toBe(403)

    vi.mocked(runWorkspaceSandboxGoldenPath).mockRejectedValueOnce(
      new WorkspaceSetupError(
        "mapping_confirmation_required",
        "Mappings require confirmation."
      )
    )
    expect(
      (await POST(jsonRequest({ ...validBody(), confirmMappings: false })))
        .status
    ).toBe(409)
  })
})

function validBody() {
  return {
    companyId,
    skillMarkdown: "---\nvalid: true\n---\n# Skill",
    confirmMappings: true,
  }
}

function jsonRequest(body: unknown) {
  return new Request("http://localhost/api/mandala/sandbox/runs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

function response() {
  return {
    schemaVersion: 1,
    mode: "sandbox",
    ephemeral: true,
    companyId,
    sessionId: "a4000000-0000-4000-8000-000000000001",
    catalog: {
      datasets: 2,
      records: 10,
      freshestObservedAt: "2026-07-16T20:00:00.000Z",
    },
    mappings: [],
    agent: {
      id: "a5000000-0000-4000-8000-000000000001",
      name: "Example",
      version: "1.0.0",
      active: false,
      manifestDigest: "a".repeat(64),
      bindingSnapshotId: "a6000000-0000-4000-8000-000000000001",
    },
    signal: {
      id: "example-signal",
      entityKey: "id",
      entityValue: "E-1",
      detectedAt: "2026-07-16T20:00:00.000Z",
      evidence: {},
    },
    harness: {
      workflowRunId: "a7000000-0000-4000-8000-000000000001",
      status: "waiting_for_approval",
      graphNodes: [],
    },
    deliverable: null,
    proof: {
      scope: "sandbox_execution",
      beforeDigest: "b".repeat(64),
      afterDigest: "b".repeat(64),
      unchanged: true,
      persistenceWrites: 0,
      externalWriteAttempts: 0,
      monitoredTables: [],
      setupCompletedBeforeBaseline: true,
    },
  }
}
