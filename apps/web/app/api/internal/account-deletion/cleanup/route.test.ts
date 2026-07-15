import { beforeEach, describe, expect, it, vi } from "vitest"
import { retryPendingAccountDeletionCleanup } from "@/actions/admin/account-deletion-cleanup"
import { POST } from "./route"

vi.mock("@/actions/admin/account-deletion-cleanup", () => ({
  retryPendingAccountDeletionCleanup: vi.fn(),
}))

describe("account deletion cleanup worker", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv(
      "ACCOUNT_DELETION_WORKER_SECRET",
      "account-deletion-cleanup-worker-secret"
    )
  })

  it("rejects requests without the private worker credential", async () => {
    const response = await POST(
      new Request("http://localhost/api/internal/account-deletion/cleanup", {
        method: "POST",
      })
    )

    expect(response.status).toBe(401)
    expect(retryPendingAccountDeletionCleanup).not.toHaveBeenCalled()
  })

  it("retries only server-selected pending cleanup requests", async () => {
    vi.mocked(retryPendingAccountDeletionCleanup).mockResolvedValue({
      attempted: 2,
      completed: 2,
      failed: 0,
    })
    const response = await POST(
      new Request("http://localhost/api/internal/account-deletion/cleanup", {
        method: "POST",
        headers: {
          authorization: "Bearer account-deletion-cleanup-worker-secret",
        },
      })
    )

    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    await expect(response.json()).resolves.toEqual({
      attempted: 2,
      completed: 2,
      failed: 0,
    })
  })
})
