// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  createWorkspaceWithOwner,
  getWorkspaceIdentity,
  updateWorkspaceIdentity,
  WorkspaceServiceError,
} from "@/lib/mandala/workspace-service"
import {
  CompanyInvitationError,
  issueCompanyInvitation,
} from "@/lib/mandala/invitations"
import { authenticateRequest } from "@/lib/supabase/request"
import { POST as createWorkspace } from "./route"
import { GET, PATCH } from "./[companyId]/route"

vi.mock("@/lib/supabase/request", () => ({ authenticateRequest: vi.fn() }))
vi.mock("@/lib/mandala/invitations", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/lib/mandala/invitations")>()
  return { ...original, issueCompanyInvitation: vi.fn() }
})
vi.mock("@/lib/mandala/workspace-service", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/lib/mandala/workspace-service")>()
  return {
    ...original,
    createWorkspaceWithOwner: vi.fn(),
    getWorkspaceIdentity: vi.fn(),
    updateWorkspaceIdentity: vi.fn(),
  }
})

const companyId = "20000000-0000-4000-8000-000000000001"
const auth = {
  authMode: "cookie",
  supabase: {},
  user: { id: "10000000-0000-4000-8000-000000000001" },
}
const workspace = {
  id: companyId,
  name: "Alumicraft",
  logoPath: null,
  role: "owner" as const,
  version: 1,
  updatedAt: "2026-07-15T12:00:00.000Z",
}

describe("workspace identity routes", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateRequest).mockResolvedValue(auth as never)
    vi.mocked(createWorkspaceWithOwner).mockResolvedValue(workspace)
    vi.mocked(getWorkspaceIdentity).mockResolvedValue(workspace)
    vi.mocked(updateWorkspaceIdentity).mockResolvedValue({
      ...workspace,
      name: "Alumicraft Manufacturing",
      version: 2,
    })
    vi.mocked(issueCompanyInvitation).mockResolvedValue({
      invitationId: "30000000-0000-4000-8000-000000000001",
      companyId,
      recipientEmail: "owner@example.test",
      state: "pending",
      version: 1,
      issuedAt: "2026-07-15T12:00:00.000Z",
      expiresAt: "2026-07-18T12:00:00.000Z",
      deliveryId: null,
    })
  })

  it("creates the workspace and initial Owner through one checked service call", async () => {
    const response = await createWorkspace(
      new Request("http://localhost/api/mandala/companies", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: " Alumicraft " }),
      })
    )

    expect(response.status).toBe(201)
    expect(createWorkspaceWithOwner).toHaveBeenCalledWith(
      auth.supabase,
      "Alumicraft"
    )
    await expect(response.json()).resolves.toEqual({
      workspace,
      invitations: [],
    })
  })

  it("reports a committed invitation as issued while an existing Owner fails safely", async () => {
    vi.mocked(issueCompanyInvitation)
      .mockResolvedValueOnce({
        invitationId: "30000000-0000-4000-8000-000000000001",
        companyId,
        recipientEmail: "new-owner@example.test",
        state: "pending",
        version: 1,
        issuedAt: "2026-07-24T18:15:48.42729+00:00",
        expiresAt: "2026-07-27T18:15:48.372+00:00",
        deliveryId: "40000000-0000-4000-8000-000000000001",
      })
      .mockRejectedValueOnce(
        new CompanyInvitationError("already_active_member", "23505")
      )

    const response = await createWorkspace(
      new Request("http://localhost/api/mandala/companies", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Alumicraft",
          initialInvitations: [
            "New-Owner@example.test",
            "owner@example.test",
          ],
        }),
      })
    )

    expect(response.status).toBe(201)
    expect(issueCompanyInvitation).toHaveBeenCalledTimes(2)
    await expect(response.json()).resolves.toMatchObject({
      workspace,
      invitations: [
        {
          recipientEmail: "new-owner@example.test",
          status: "issued",
          invitation: {
            state: "pending",
            deliveryId: "40000000-0000-4000-8000-000000000001",
          },
        },
        {
          recipientEmail: "owner@example.test",
          status: "failed",
          error: "already_active_member",
        },
      ],
    })
  })

  it("rejects normalized duplicate recipients before creating a workspace", async () => {
    const response = await createWorkspace(
      new Request("http://localhost/api/mandala/companies", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Alumicraft",
          initialInvitations: [
            "Duplicate@example.test",
            "duplicate@example.test",
          ],
        }),
      })
    )

    expect(response.status).toBe(400)
    expect(createWorkspaceWithOwner).not.toHaveBeenCalled()
    expect(issueCompanyInvitation).not.toHaveBeenCalled()
  })

  it("requires authentication and rejects invalid workspace names", async () => {
    const invalid = await createWorkspace(
      new Request("http://localhost/api/mandala/companies", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "" }),
      })
    )
    expect(invalid.status).toBe(400)

    vi.mocked(authenticateRequest).mockResolvedValueOnce(null)
    const unauthorized = await createWorkspace(
      new Request("http://localhost/api/mandala/companies", {
        method: "POST",
      })
    )
    expect(unauthorized.status).toBe(401)
  })

  it("reads and updates only through the membership-checked workspace service", async () => {
    const context = { params: Promise.resolve({ companyId }) }
    const read = await GET(
      new Request(`http://localhost/api/mandala/companies/${companyId}`),
      context
    )
    expect(read.status).toBe(200)
    expect(getWorkspaceIdentity).toHaveBeenCalledWith(auth.supabase, companyId)

    const update = await PATCH(
      new Request(`http://localhost/api/mandala/companies/${companyId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Alumicraft Manufacturing",
          expectedVersion: 1,
        }),
      }),
      context
    )
    expect(update.status).toBe(200)
    expect(updateWorkspaceIdentity).toHaveBeenCalledWith(auth.supabase, {
      companyId,
      name: "Alumicraft Manufacturing",
      logoPath: null,
      expectedVersion: 1,
    })
  })

  it("returns a conflict instead of silently overwriting a newer workspace", async () => {
    vi.mocked(updateWorkspaceIdentity).mockRejectedValue(
      new WorkspaceServiceError("company_version_conflict")
    )
    const response = await PATCH(
      new Request(`http://localhost/api/mandala/companies/${companyId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "New name", expectedVersion: 1 }),
      }),
      { params: Promise.resolve({ companyId }) }
    )
    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: "company_version_conflict",
    })
  })
})
