import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  getCompanyMembership,
  type WorkflowSupabaseClient,
} from "@/lib/mandala/workflows"
import {
  authorizeCompanyPermission,
  companyPermissionFailure,
} from "./authorization"

vi.mock("@/lib/mandala/workflows", () => ({
  getCompanyMembership: vi.fn(),
}))

const supabase = {} as WorkflowSupabaseClient
const companyId = "20000000-0000-4000-8000-000000000001"
const userId = "10000000-0000-4000-8000-000000000001"

describe("company permission authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("allows a membership role with the requested permission", async () => {
    vi.mocked(getCompanyMembership).mockResolvedValue({ role: "owner" })

    await expect(
      authorizeCompanyPermission({
        supabase,
        companyId,
        userId,
        permission: "workflow.execution.mock",
      })
    ).resolves.toEqual({
      effect: "allow",
      reason: "role_permission_granted",
      role: "owner",
      permission: "workflow.execution.mock",
    })

    expect(getCompanyMembership).toHaveBeenCalledWith({
      supabase,
      companyId,
      userId,
    })
  })

  it("denies a missing membership without exposing company existence", async () => {
    vi.mocked(getCompanyMembership).mockResolvedValue(null)

    await expect(authorize("workflow.read")).resolves.toEqual({
      effect: "deny",
      reason: "forbidden",
      permission: "workflow.read",
    })
  })

  it("denies a role without the requested permission", async () => {
    vi.mocked(getCompanyMembership).mockResolvedValue({ role: "viewer" })

    await expect(authorize("workflow.run")).resolves.toEqual({
      effect: "deny",
      reason: "forbidden",
      permission: "workflow.run",
    })
  })

  it("denies a malformed membership role", async () => {
    vi.mocked(getCompanyMembership).mockResolvedValue({ role: "superadmin" })

    await expect(authorize("workflow.read")).resolves.toEqual({
      effect: "deny",
      reason: "forbidden",
      permission: "workflow.read",
    })
  })

  it("separates membership lookup failures from authorization denials", async () => {
    vi.mocked(getCompanyMembership).mockRejectedValue(
      new Error("private provider failure")
    )

    const result = await authorize("workflow.read")

    expect(result).toEqual({
      effect: "deny",
      reason: "membership_lookup_failed",
      permission: "workflow.read",
    })
    expect(JSON.stringify(result)).not.toContain("private provider failure")
  })

  it("maps authorization results to stable route failures", () => {
    expect(
      companyPermissionFailure({
        effect: "allow",
        reason: "role_permission_granted",
        role: "viewer",
        permission: "workflow.read",
      })
    ).toBeNull()
    expect(
      companyPermissionFailure({
        effect: "deny",
        reason: "forbidden",
        permission: "workflow.read",
      })
    ).toEqual({ code: "forbidden", status: 403 })
    expect(
      companyPermissionFailure({
        effect: "deny",
        reason: "membership_lookup_failed",
        permission: "workflow.read",
      })
    ).toEqual({ code: "membership_lookup_failed", status: 500 })
  })
})

function authorize(
  permission: Parameters<typeof authorizeCompanyPermission>[0]["permission"]
) {
  return authorizeCompanyPermission({
    supabase,
    companyId,
    userId,
    permission,
  })
}
