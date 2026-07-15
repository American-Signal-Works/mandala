// @vitest-environment node

import { describe, expect, it, vi } from "vitest"
import { retryPendingAccountDeletionCleanup } from "./account-deletion-cleanup"

const userId = "10000000-0000-4000-8000-000000000001"

function deleteQuery(requiredEqualities = 2) {
  let equalityCount = 0
  const query = {
    delete: vi.fn(() => query),
    eq: vi.fn(() => {
      equalityCount += 1
      return equalityCount < requiredEqualities
        ? query
        : Promise.resolve({ error: null })
    }),
  }
  return query
}

describe("retryable account deletion cleanup", () => {
  it("selects only post-Auth cleanup records and completes them idempotently", async () => {
    const pendingQuery = {
      select: vi.fn(),
      in: vi.fn(),
      not: vi.fn(),
      order: vi.fn(),
      limit: vi.fn().mockResolvedValue({
        data: [{ user_id: userId }],
        error: null,
      }),
    }
    pendingQuery.select.mockReturnValue(pendingQuery)
    pendingQuery.in.mockReturnValue(pendingQuery)
    pendingQuery.not.mockReturnValue(pendingQuery)
    pendingQuery.order.mockReturnValue(pendingQuery)

    const rpc = vi.fn().mockResolvedValue({ data: true, error: null })
    const admin = {
      auth: { admin: {} },
      from: vi.fn((table: string) => {
        if (table === "account_deletion_requests") return pendingQuery
        return deleteQuery(table === "profiles" ? 1 : 2)
      }),
      rpc,
      storage: {
        from: vi.fn(() => ({
          list: vi.fn().mockResolvedValue({ data: [], error: null }),
          remove: vi.fn(),
        })),
      },
    }

    await expect(
      retryPendingAccountDeletionCleanup({ admin: admin as never })
    ).resolves.toEqual({ attempted: 1, completed: 1, failed: 0 })
    expect(pendingQuery.in).toHaveBeenCalledWith("status", [
      "auth_deleted",
      "cleanup_failed",
    ])
    expect(pendingQuery.not).toHaveBeenCalledWith("auth_deleted_at", "is", null)
    expect(rpc).toHaveBeenCalledWith(
      "record_account_deletion_progress",
      expect.objectContaining({ p_status: "completed", p_user_id: userId })
    )
  })
})
